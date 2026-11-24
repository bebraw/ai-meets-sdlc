import { jsonObject } from "../json-object.mjs";
import * as v from "valibot";
import type { Context, Role, QueryDatabase } from "../contracts.mjs";
import { randomUUID } from "node:crypto";
import {
  choice,
  decode,
  encode,
  fail,
  id,
  invitation,
  newToken,
  obj,
  withOptional,
  operation,
  organizer,
  rev,
  text,
  time,
  tokenField,
  transaction,
  word,
} from "./workflow-helpers.mjs";

interface DeskRow {
  id: string;
  details: string;
  status: "active" | "cancelled";
  revision: number;
  arrived_at: string | null;
}
interface DeskDetails {
  name: string;
  company: string;
  email: string;
  ticketCode: string;
  type: string;
  source: string;
  sourceKey: string;
  assignedAtDesk: boolean;
}
const rosterRev = v.pipe(v.number(), v.integer(), v.minValue(0));
const record = jsonObject(
  v.looseObject({
    id,
    name: text(300),
    company: v.optional(text(300)),
    email: v.optional(text(254)),
    ticketCode: v.optional(text(120)),
    type: v.optional(word(64)),
    status: v.optional(choice("active", "cancelled")),
    source: v.optional(word(64)),
    sourceKey: v.optional(word(340)),
  }),
);

const sample = {
  id: "manual-1",
  name: "Alex Li",
  ticketCode: "F-101",
  company: "Example Studio",
};
const roleAccess: Role[] = ["organizer", "staff", "public"];
const revisionOf = (db: QueryDatabase) =>
  db
    .prepare<{
      revision: number;
    }>("SELECT revision FROM tk_desk_config WHERE singleton=1")
    .get()!.revision;
const bump = (db: QueryDatabase) =>
  db
    .prepare("UPDATE tk_desk_config SET revision=revision+1 WHERE singleton=1")
    .run();
function deskActor(ctx: Context, token: string | undefined) {
  if (ctx.role === "organizer") return String(ctx.actor);
  if (!token) fail("A registration desk grant is required.", 403);
  const grant = ctx.db
    .prepare<{
      id: string;
    }>(
      "SELECT id FROM tk_desk_grants WHERE token_hash=? AND revoked=0 AND expires_at>?",
    )
    .get(ctx.fingerprint(token), time());
  if (!grant) fail("The desk grant is invalid, expired or revoked.", 403);
  return "grant:" + grant.id;
}
function person(ctx: Context, row: DeskRow) {
  const details = decode<DeskDetails>(ctx, row.details);
  return {
    id: row.id,
    name: details.name,
    company: details.company,
    type: details.type,
    status: row.status,
    revision: row.revision,
    arrivedAt: row.arrived_at ?? null,

    ticketCode: details.ticketCode,
    email: details.email,
    source: details.source,
    sourceKey: details.sourceKey,
    assignedAtDesk: details.assignedAtDesk,
  };
}
function canonicalId(db: QueryDatabase, id: string) {
  return (
    db
      .prepare<{
        person_id: string;
      }>("SELECT person_id FROM tk_desk_aliases WHERE alias=?")
      .get(id)?.person_id ?? id
  );
}
function updateArrival(
  input: { id: string; revision: number; token?: string; assignName?: string },
  ctx: Context,
  undo = false,
) {
  return transaction(ctx.db, () => {
    const by = deskActor(ctx, input.token);
    const row = ctx.db
      .prepare<DeskRow>("SELECT * FROM tk_desk_people WHERE id=?")
      .get(canonicalId(ctx.db, input.id));
    if (!row) fail("Registration not found.", 404);
    if (row.revision !== input.revision)
      fail("Registration changed. Look it up again.", 409);
    if (!undo && row.status !== "active")
      fail("A cancelled registration cannot be checked in.", 409);
    if (undo ? !row.arrived_at : row.arrived_at)
      fail(undo ? "No arrival to undo." : "Already checked in.", 409);
    const details = decode<DeskDetails>(ctx, row.details);
    if (!undo && !details.name) {
      if (!input.assignName?.trim())
        fail("Enter the unassigned ticket holder’s name.");
      details.name = input.assignName.trim();
      details.assignedAtDesk = true;
    } else if (input.assignName)
      fail("Only an unassigned ticket can receive a name at check-in.", 409);
    const now = time();
    ctx.db
      .prepare(
        "UPDATE tk_desk_people SET details=?,arrived_at=?,revision=revision+1 WHERE id=?",
      )
      .run(encode(ctx, details), undo ? null : now, row.id);
    ctx.db
      .prepare(
        "INSERT INTO tk_desk_history(person_id,action,actor,at) VALUES(?,?,?,?)",
      )
      .run(row.id, undo ? "undo" : "arrive", by, now);
    bump(ctx.db);
    return {
      id: row.id,
      arrivedAt: undo ? null : now,
      revision: row.revision + 1,
    };
  });
}
export const checkin = {
  id: "check-in",
  title: "Registration desk",
  description:
    "Import or add ticket holders, give staff revocable desk access, and record arrivals atomically.",
  migrate(db: QueryDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS tk_desk_config(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO tk_desk_config VALUES(1,0);
    CREATE TABLE IF NOT EXISTS tk_desk_people(id TEXT PRIMARY KEY,details TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,arrived_at TEXT);
    CREATE TABLE IF NOT EXISTS tk_desk_aliases(alias TEXT PRIMARY KEY,person_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tk_desk_sources(key_hash TEXT PRIMARY KEY,person_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tk_desk_history(seq INTEGER PRIMARY KEY,person_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tk_desk_grants(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);`);
  },
  operations: [
    operation(
      "checkin_roster",
      "Read registrations and the roster revision for an import.",
      obj({}),
      {},
      organizer,
      (_, ctx) => ({
        rosterRevision: revisionOf(ctx.db),
        people: ctx.db
          .prepare<DeskRow>("SELECT * FROM tk_desk_people ORDER BY rowid")
          .all()
          .map((r) => person(ctx, r)),
      }),
    ),
    operation(
      "checkin_register",
      "Add or refresh normalized registrations by stable ID, preserving arrivals. Omitted people remain in the roster.",
      obj({
        people: v.pipe(v.array(record), v.minLength(1), v.maxLength(2000)),
        rosterRevision: rosterRev,
      }),
      { people: [sample], rosterRevision: 0 },
      organizer,
      (input, ctx) =>
        transaction(ctx.db, () => {
          if (revisionOf(ctx.db) !== input.rosterRevision)
            fail("Roster changed. Reload before importing.", 409);
          const seen = new Set(),
            keys = new Set();
          for (const row of input.people) {
            if (seen.has(row.id)) fail("Duplicate registration ID in import.");
            seen.add(row.id);
            // Linked sources can subsequently be refreshed without reviving a separate registration.
            if (canonicalId(ctx.db, row.id) !== row.id) continue;
            const proposedKey =
              row.sourceKey ??
              (row.ticketCode?.trim()
                ? "ticket:" + row.ticketCode.trim().toLowerCase()
                : row.email?.trim()
                  ? "email:" + row.email.trim().toLowerCase()
                  : "id:" + row.id);
            const keyHash = ctx.fingerprint(
              JSON.stringify([row.source ?? "manual", proposedKey]),
            );
            if (keys.has(keyHash))
              fail("Repeated ticket or source identity in this import.");
            keys.add(keyHash);
            const sourceId = ctx.db
              .prepare<{
                person_id: string;
              }>("SELECT person_id FROM tk_desk_sources WHERE key_hash=?")
              .get(keyHash)?.person_id;
            const currentById = ctx.db
              .prepare<DeskRow>("SELECT * FROM tk_desk_people WHERE id=?")
              .get(row.id);
            if (currentById && sourceId && sourceId !== row.id)
              fail(
                "Registration ID and ticket identity refer to different people.",
                409,
              );
            const targetId = sourceId ?? row.id;
            const previous =
              currentById ??
              ctx.db
                .prepare<DeskRow>("SELECT * FROM tk_desk_people WHERE id=?")
                .get(targetId);
            if (!sourceId)
              ctx.db
                .prepare(
                  "INSERT INTO tk_desk_sources(key_hash,person_id) VALUES(?,?)",
                )
                .run(keyHash, targetId);
            const old = previous && decode<DeskDetails>(ctx, previous.details);
            // Once a source has been linked into a ticket it can contribute identity but cannot overwrite that ticket.
            if (
              sourceId !== undefined &&
              old?.source &&
              row.source &&
              old.source !== row.source
            )
              continue;
            if (currentById && row.source && old?.source !== row.source)
              fail("The registration ID belongs to a different source.", 409);
            if (old && old.sourceKey !== proposedKey) {
              ctx.db
                .prepare(
                  "DELETE FROM tk_desk_sources WHERE key_hash=? AND person_id=?",
                )
                .run(
                  ctx.fingerprint(JSON.stringify([old.source, old.sourceKey])),
                  targetId,
                );
            }
            const name = row.name.trim() || old?.name || "";
            if (!name && !row.ticketCode?.trim())
              fail("An unassigned registration needs a ticket code.");
            const details = {
              name,
              company: (row.company ?? old?.company ?? "").trim(),
              email: (row.email ?? old?.email ?? "").trim().toLowerCase(),
              type: row.type ?? old?.type ?? "attendee",
              ticketCode: (row.ticketCode ?? old?.ticketCode ?? "").trim(),
              source: row.source ?? old?.source ?? "manual",
              sourceKey: proposedKey,
              assignedAtDesk: old?.assignedAtDesk ?? false,
            };
            const status = row.status ?? previous?.status ?? "active";
            if (
              previous &&
              status === previous.status &&
              JSON.stringify(old) === JSON.stringify(details)
            )
              continue;
            ctx.db
              .prepare(
                `INSERT INTO tk_desk_people(id,details,status) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET details=excluded.details,status=excluded.status,revision=tk_desk_people.revision+1`,
              )
              .run(targetId, encode(ctx, details), status);
          }
          bump(ctx.db);
          return {
            rosterRevision: revisionOf(ctx.db),
            submitted: input.people.length,
          };
        }),
    ),
    operation(
      "checkin_link",
      "Link a poster/volunteer registration to a ticket and preserve arrival history.",
      obj({ sourceId: id, ticketId: id, rosterRevision: rosterRev }),
      { sourceId: "poster-1", ticketId: "manual-1", rosterRevision: 1 },
      organizer,
      (input, ctx) =>
        transaction(ctx.db, () => {
          if (revisionOf(ctx.db) !== input.rosterRevision)
            fail("Roster changed. Reload first.", 409);
          const source = ctx.db
            .prepare<DeskRow>("SELECT * FROM tk_desk_people WHERE id=?")
            .get(input.sourceId);
          const target = ctx.db
            .prepare<DeskRow>("SELECT * FROM tk_desk_people WHERE id=?")
            .get(input.ticketId);
          if (!source || !target || source.id === target.id)
            fail("Select two distinct current registrations.");
          if (source.arrived_at && target.arrived_at)
            fail("Both identities have arrivals. Undo one first.", 409);
          if (source.arrived_at && target.status === "cancelled")
            fail("An existing arrival cannot move to a cancelled ticket.", 409);
          ctx.db
            .prepare(
              "UPDATE tk_desk_people SET arrived_at=COALESCE(arrived_at,?),revision=revision+1 WHERE id=?",
            )
            .run(source.arrived_at, target.id);
          ctx.db
            .prepare("UPDATE tk_desk_history SET person_id=? WHERE person_id=?")
            .run(target.id, source.id);
          ctx.db
            .prepare("UPDATE tk_desk_aliases SET person_id=? WHERE person_id=?")
            .run(target.id, source.id);
          ctx.db
            .prepare("UPDATE tk_desk_sources SET person_id=? WHERE person_id=?")
            .run(target.id, source.id);
          ctx.db
            .prepare("INSERT INTO tk_desk_aliases VALUES(?,?)")
            .run(source.id, target.id);
          ctx.db
            .prepare("DELETE FROM tk_desk_people WHERE id=?")
            .run(source.id);
          bump(ctx.db);
          return { id: target.id, rosterRevision: revisionOf(ctx.db) };
        }),
    ),
    operation(
      "checkin_issue_grant",
      "Issue a revocable, time-limited registration desk token.",
      withOptional(
        {
          label: word(),
          validDays: v.pipe(
            v.number(),
            v.integer(),
            v.minValue(1),
            v.maxValue(90),
          ),
        },
        ["validDays"],
      ),
      { label: "Entrance desk", validDays: 2 },
      organizer,
      (input, ctx) => {
        const grantId = randomUUID(),
          token = newToken(),
          expiresAt = new Date(
            Date.now() + (input.validDays ?? 2) * 86400000,
          ).toISOString();
        ctx.db
          .prepare(
            "INSERT INTO tk_desk_grants(id,label,token_hash,expires_at) VALUES(?,?,?,?)",
          )
          .run(grantId, input.label.trim(), ctx.fingerprint(token), expiresAt);
        return {
          id: grantId,
          expiresAt,
          ...invitation(ctx, "checkin_lookup", token),
        };
      },
    ),
    operation(
      "checkin_grants",
      "List desk grants and revocation status.",
      obj({}),
      {},
      organizer,
      (_, ctx) => ({
        grants: ctx.db
          .prepare<{
            id: string;
            label: string;
            expiresAt: string;
            revoked: number;
          }>(
            "SELECT id,label,expires_at AS expiresAt,revoked FROM tk_desk_grants ORDER BY rowid",
          )
          .all(),
      }),
    ),
    operation(
      "checkin_revoke_grant",
      "Immediately revoke an issued desk grant.",
      obj({ id }),
      { id: "from-checkin-grants" },
      organizer,
      (input, ctx) => {
        const r = ctx.db
          .prepare("UPDATE tk_desk_grants SET revoked=1 WHERE id=?")
          .run(input.id);
        if (!r.changes) fail("Unknown desk grant.", 404);
        return { revoked: true };
      },
    ),
    operation(
      "checkin_lookup",
      "Find a participant by name, exact ticket code or email. Staff must supply their grant.",
      withOptional({ query: word(254), token: tokenField }, ["token"]),
      { query: "Alex" },
      roleAccess,
      (input, ctx) => {
        deskActor(ctx, input.token);
        const q = input.query.trim().toLowerCase(),
          matches = [];
        for (const row of ctx.db
          .prepare<DeskRow>("SELECT * FROM tk_desk_people ORDER BY rowid")
          .iterate()) {
          const details = person(ctx, row);
          if (
            !(
              details.name.toLowerCase().includes(q) ||
              details.ticketCode.toLowerCase() === q ||
              details.email === q
            )
          )
            continue;
          const {
            email,
            ticketCode,
            source,
            sourceKey,
            assignedAtDesk,
            ...publicFields
          } = details;
          matches.push(publicFields);
          if (matches.length === 50) break;
        }
        return { people: matches };
      },
    ),
    operation(
      "checkin_arrive",
      "Record one arrival, optionally assigning a name to an unassigned ticket in the same transaction.",
      withOptional(
        { id, revision: rev, token: tokenField, assignName: word(300) },
        ["token", "assignName"],
      ),
      { id: "manual-1", revision: 1 },
      roleAccess,
      (input, ctx) => updateArrival(input, ctx),
    ),
    operation(
      "checkin_undo",
      "Undo a selected arrival and record the correction in its history.",
      obj({ id, revision: rev }),
      { id: "manual-1", revision: 2 },
      organizer,
      (input, ctx) => updateArrival(input, ctx, true),
    ),
    operation(
      "checkin_history",
      "Read actions and timestamps for one registration, including its linked sources.",
      obj({ id }),
      { id: "manual-1" },
      organizer,
      (input, ctx) => ({
        history: ctx.db
          .prepare<{
            action: string;
            actor: string;
            at: string;
          }>(
            "SELECT action,actor,at FROM tk_desk_history WHERE person_id=? ORDER BY seq",
          )
          .all(canonicalId(ctx.db, input.id)),
      }),
    ),
  ],
};
