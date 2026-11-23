import * as v from "valibot";
import type { Context, QueryDatabase } from "../contracts.mjs";
import { randomUUID } from "node:crypto";
import {
  atomic,
  clean,
  codeInstructions,
  email,
  fail,
  key,
  list,
  mailer,
  newCode,
  number,
  object,
  operation,
  organizer,
  publicRoles,
  revision,
  text,
} from "./engagement-common.mjs";

const exampleId = "replace-with-preview-id";
function counts(db: QueryDatabase, id: string) {
  const result = {
    pending: 0,
    accepted: 0,
    unknown: 0,
    rejected: 0,
    skipped: 0,
  };
  for (const { status, n } of db
    .prepare<{
      status: keyof typeof result;
      n: number;
    }>(
      "SELECT status,COUNT(*) AS n FROM event_deliveries WHERE campaign=? GROUP BY status",
    )
    .all(id))
    result[status] = n;
  return result;
}
function audienceRevision(db: QueryDatabase) {
  return db
    .prepare<{
      revision: number;
    }>("SELECT revision FROM event_audience_version")
    .get()!.revision;
}
function selection(db: QueryDatabase) {
  return db
    .prepare<{ fingerprint: string; address: string }>(
      `SELECT a.fingerprint,a.address FROM event_audience a
    WHERE NOT EXISTS(SELECT 1 FROM event_suppressions s WHERE s.fingerprint=a.fingerprint) ORDER BY a.rowid`,
    )
    .all();
}

export const messages = {
  id: "attendee-messages",
  title: "Attendee announcements",
  description:
    "Select event recipients, preview an operational message, send individual emails, and review deliveries and event withdrawals.",
  migrate(db: QueryDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_audience_version (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO event_audience_version VALUES(1,0);
    CREATE TABLE IF NOT EXISTS event_audience(fingerprint TEXT PRIMARY KEY,address TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_suppressions(fingerprint TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS event_campaigns(
      id TEXT PRIMARY KEY,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,
      audience_revision INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS event_deliveries(
      campaign TEXT NOT NULL REFERENCES event_campaigns(id),fingerprint TEXT NOT NULL,status TEXT NOT NULL,
      message_id TEXT,withdraw_hash TEXT UNIQUE,PRIMARY KEY(campaign,fingerprint));`);
  },
  cleanup({ db }: Context) {
    // Expired previews never claimed by a sender may be discarded with their snapshots.
    return atomic(db, () => {
      const before = Date.now() - 7 * 86_400_000;
      db.prepare(
        "DELETE FROM event_deliveries WHERE campaign IN(SELECT id FROM event_campaigns WHERE status='preview' AND created_at<?)",
      ).run(before);
      return {
        expired: db
          .prepare(
            "DELETE FROM event_campaigns WHERE status='preview' AND created_at<?",
          )
          .run(before).changes,
      };
    });
  },
  operations: [
    operation(
      "messages_audience",
      "Read the eligible recipients selected for this event. Withdrawals are excluded.",
      object({}),
      {},
      organizer,
      (_, ctx) => ({
        revision: audienceRevision(ctx.db),
        emails: selection(ctx.db).map((r) => ctx.open(r.address)),
      }),
    ),
    operation(
      "messages_set_audience",
      "Replace the event's eligible recipient addresses from your roster. Case-insensitive duplicates collapse and previous withdrawals remain effective.",
      object({ recipients: list(email, 3000), revision }),
      {
        revision: 0,
        recipients: ["speaker@example.test", "attendee@example.test"],
      },
      organizer,
      (input, ctx) =>
        atomic(ctx.db, () => {
          const updated = ctx.db
            .prepare<{
              revision: number;
            }>(
              "UPDATE event_audience_version SET revision=revision+1 WHERE id=1 AND revision=? RETURNING revision",
            )
            .get(input.revision);
          if (!updated)
            fail(
              "The event audience changed. Reload the audience and review your selection.",
              409,
            );
          ctx.db.exec("DELETE FROM event_audience");
          const insert = ctx.db.prepare(
            "INSERT INTO event_audience VALUES(?,?)",
          );
          for (const address of new Set(
            input.recipients.map((v) => v.trim().toLowerCase()),
          ))
            insert.run(
              ctx.fingerprint("event-mail:" + address),
              ctx.seal(address),
            );
          return { ...updated, eligible: selection(ctx.db).length };
        }),
    ),
    operation(
      "messages_preview",
      "Save an event message and snapshot the eligible recipients for review. This does not send any email.",
      object({
        subject: v.pipe(text(160), v.regex(/^[^\r\n\u0000-\u001f\u007f]+$/)),
        body: text(10000),
      }),
      {
        subject: "Arrival details",
        body: "The registration desk opens at 09:00 in the lobby.",
      },
      organizer,
      (input, ctx) =>
        atomic(ctx.db, () => {
          const subject = clean(input.subject, "the subject"),
            body = clean(input.body, "message text");
          const rows = selection(ctx.db);
          if (!rows.length)
            fail("Select at least one eligible event recipient first.");
          const id = randomUUID(),
            created = Date.now();
          ctx.db
            .prepare("INSERT INTO event_campaigns VALUES(?,?,?,'preview',?,?)")
            .run(
              id,
              ctx.seal(subject),
              ctx.seal(body),
              audienceRevision(ctx.db),
              created,
            );
          const insert = ctx.db.prepare(
            "INSERT INTO event_deliveries(campaign,fingerprint,status) VALUES(?,?,'pending')",
          );
          for (const row of rows) insert.run(id, row.fingerprint);
          return {
            previewId: id,
            subject,
            body,
            recipients: rows.map((r) => ctx.open(r.address)),
            expiresAt: new Date(created + 7_200_000).toISOString(),
          };
        }),
    ),
    operation(
      "messages_send",
      "Send the reviewed preview in batches of 20. Reuse its ID to continue. Deliveries whose acceptance is uncertain remain untouched.",
      object({ previewId: key, send: v.literal(true) }),
      { previewId: exampleId, send: true },
      organizer,
      async (input, ctx) => {
        const send = mailer(ctx);
        if (input.send !== true)
          fail("Review the recipients and confirm sending.");
        const db = ctx.db;
        const campaign = atomic(db, () => {
          const row = db
            .prepare<{
              id: string;
              status: string;
              created_at: number;
              audience_revision: number;
              subject: string;
              body: string;
            }>("SELECT * FROM event_campaigns WHERE id=?")
            .get(input.previewId);
          if (!row) fail("Message preview not found.", 404);
          if (row.status === "preview") {
            if (
              Date.now() >= row.created_at + 7_200_000 ||
              row.audience_revision !== audienceRevision(db)
            )
              fail(
                "The preview expired or the audience changed. Prepare a new preview.",
                409,
              );
            db.prepare(
              "UPDATE event_campaigns SET status='sending' WHERE id=?",
            ).run(row.id);
          }
          return row;
        });
        const pending = db
          .prepare<{
            fingerprint: string;
          }>(
            "SELECT fingerprint FROM event_deliveries WHERE campaign=? AND status='pending' ORDER BY rowid LIMIT 20",
          )
          .all(campaign.id);
        for (const { fingerprint } of pending) {
          const code = newCode();
          const recipient = atomic(db, () => {
            const claimed = db
              .prepare(
                "UPDATE event_deliveries SET status='unknown',withdraw_hash=? WHERE campaign=? AND fingerprint=? AND status='pending' RETURNING fingerprint",
              )
              .get(
                ctx.fingerprint("event-withdraw:" + code),
                campaign.id,
                fingerprint,
              );
            if (!claimed) return null;
            const row = db
              .prepare<{
                address: string;
              }>(
                "SELECT address FROM event_audience WHERE fingerprint=? AND NOT EXISTS(SELECT 1 FROM event_suppressions WHERE fingerprint=?)",
              )
              .get(fingerprint, fingerprint);
            if (!row)
              db.prepare(
                "UPDATE event_deliveries SET status='skipped' WHERE campaign=? AND fingerprint=?",
              ).run(campaign.id, fingerprint);
            return row?.address;
          });
          if (!recipient) continue;
          try {
            const delivered = await send({
              to: ctx.open(recipient),
              subject: ctx.open(campaign.subject),
              text: `${ctx.open(campaign.body)}\n\nUnsubscribe from emails about this event:\n${codeInstructions(ctx, "messages_withdraw", code)}`,
            });
            db.prepare(
              "UPDATE event_deliveries SET status='accepted',message_id=? WHERE campaign=? AND fingerprint=?",
            ).run(delivered?.id ?? null, campaign.id, fingerprint);
          } catch (error) {
            // Ambiguous outcomes include process interruptions. Never auto-resend them.
            if (
              error &&
              typeof error === "object" &&
              "definitivelyRejected" in error &&
              error.definitivelyRejected === true
            )
              db.prepare(
                "UPDATE event_deliveries SET status='rejected' WHERE campaign=? AND fingerprint=?",
              ).run(campaign.id, fingerprint);
          }
        }
        const totals = counts(db, campaign.id);
        if (!totals.pending)
          db.prepare(
            "UPDATE event_campaigns SET status='processed' WHERE id=?",
          ).run(campaign.id);
        return { campaignId: campaign.id, deliveries: totals };
      },
    ),
    operation(
      "messages_withdraw",
      "Stop event announcements using a private code from an event email. This setting survives later roster imports.",
      object({ code: text(128) }),
      { code: "private-code-from-event-email" },
      publicRoles,
      ({ code }, ctx) =>
        atomic(ctx.db, () => {
          const row = ctx.db
            .prepare<{
              fingerprint: string;
            }>("SELECT fingerprint FROM event_deliveries WHERE withdraw_hash=?")
            .get(ctx.fingerprint("event-withdraw:" + code));
          if (!row) fail("Invalid event withdrawal code.", 404);
          const inserted = ctx.db
            .prepare(
              "INSERT INTO event_suppressions VALUES(?) ON CONFLICT DO NOTHING",
            )
            .run(row.fingerprint);
          if (inserted.changes)
            ctx.db.exec(
              "UPDATE event_audience_version SET revision=revision+1",
            );
          return { withdrawn: true };
        }),
    ),
    operation(
      "messages_history",
      "Review recent previews and sent campaigns, including accepted, skipped, rejected and uncertain delivery counts.",
      object({ offset: v.optional(number(0, 1_000_000)) }),
      {},
      organizer,
      (input, ctx) => ({
        campaigns: ctx.db
          .prepare<{
            id: string;
            subject: string;
            created_at: number;
            status: string;
          }>(
            "SELECT id,subject,created_at,status FROM event_campaigns ORDER BY rowid DESC LIMIT 50 OFFSET ?",
          )
          .all(input.offset ?? 0)
          .map((row) => ({
            id: row.id,
            subject: ctx.open(row.subject),
            status: row.status,
            createdAt: new Date(row.created_at).toISOString(),
            deliveries: counts(ctx.db, row.id),
          })),
      }),
    ),
  ],
};
