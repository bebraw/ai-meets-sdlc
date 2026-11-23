import { randomUUID } from "node:crypto";
import {
  anyone,
  bool,
  changed,
  choice,
  csvArtifact,
  dateValue,
  decode,
  email,
  encode,
  fail,
  id,
  obj,
  operation,
  organizer,
  rev,
  text,
  time,
  transaction,
  word,
} from "./workflow-helpers.mjs";

const statuses = choice(
  "submitted",
  "shortlisted",
  "accepted",
  "waitlisted",
  "declined",
  "withdrawn",
);
const revision = { type: "integer", minimum: 0 };
const formFields = {
  name: word(),
  email,
  title: word(250),
  abstract: word(6000),
  organization: text(250),
  coauthors: text(1000),
  size: choice("A0", "A1", "either"),
  setupNotes: text(),
  requestId: id,
  consentAccepted: { const: true, type: "boolean" },
  callRevision: rev,
  challengeToken: text(3000),
};
const sample = {
  name: "Alex Li",
  email: "alex@example.test",
  title: "Accessible diagram design",
  abstract: "A comparison of accessible diagram conventions.",
  requestId: "example-submission-1",
  consentAccepted: true,
  callRevision: 1,
};
function readCall(db) {
  const call = db
    .prepare(
      "SELECT deadline,consent,revision,require_challenge AS requireChallenge FROM tk_poster_call WHERE id=1",
    )
    .get();
  return call && { ...call, requireChallenge: Boolean(call.requireChallenge) };
}
function asPrivate(ctx, row) {
  return {
    id: row.id,
    ...decode(ctx, row.details),
    status: row.status,
    revision: row.revision,
    callRevision: row.call_revision,
    consentText: row.consent,
    receivedAt: row.created_at,
  };
}
export const posters = {
  id: "poster-proposals",
  title: "Poster proposal inbox",
  description:
    "Open an event-specific call, collect proposals, review decisions, and export accepted presenters.",
  migrate(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS tk_poster_call(id INTEGER PRIMARY KEY CHECK(id=1),deadline TEXT NOT NULL,consent TEXT NOT NULL,revision INTEGER NOT NULL,require_challenge INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tk_posters(id TEXT PRIMARY KEY,retry_key TEXT UNIQUE NOT NULL,digest TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,call_revision INTEGER NOT NULL,consent TEXT NOT NULL,created_at TEXT NOT NULL)`);
  },
  operations: [
    operation(
      "posters_configure_call",
      "Set the deadline and consent wording. Use revision zero for a new call.",
      obj(
        {
          deadline: word(64),
          consent: word(2500),
          revision,
          requireChallenge: bool,
        },
        ["deadline", "consent", "revision"],
      ),
      {
        deadline: "2030-09-01T18:00:00Z",
        consent: "I agree to be contacted about this proposal.",
        revision: 0,
      },
      organizer,
      (input, ctx) =>
        transaction(ctx.db, () => {
          const current = readCall(ctx.db);
          if ((current?.revision ?? 0) !== input.revision)
            fail("The poster call changed. Reload before editing.", 409);
          if (input.requireChallenge && !ctx.services?.verifyChallenge)
            fail(
              "Connect a form verification provider before enabling challenges.",
            );
          const deadline = dateValue(input.deadline);
          ctx.db
            .prepare(
              "INSERT INTO tk_poster_call VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET deadline=excluded.deadline,consent=excluded.consent,revision=excluded.revision,require_challenge=excluded.require_challenge",
            )
            .run(
              deadline,
              input.consent.trim(),
              input.revision + 1,
              Number(input.requireChallenge ?? false),
            );
          return readCall(ctx.db);
        }),
    ),
    operation(
      "posters_call",
      "Read the configured call deadline, consent wording and version before submitting.",
      obj({}),
      {},
      anyone,
      (_, ctx) => {
        const call = readCall(ctx.db);
        return call
          ? {
              ...call,
              open: time() <= call.deadline,
            }
          : { revision: 0, open: false };
      },
    ),
    operation(
      "posters_submit",
      "Submit one proposal with the published consent revision. Reuse the request ID for retries.",
      obj(formFields, [
        "name",
        "email",
        "title",
        "abstract",
        "requestId",
        "callRevision",
        "consentAccepted",
      ]),
      sample,
      anyone,
      async (input, ctx) => {
        const call = readCall(ctx.db);
        if (!call) fail("The poster call has not opened.", 409);
        if (
          call.requireChallenge &&
          (!ctx.services?.verifyChallenge ||
            !(await ctx.services.verifyChallenge({
              action: "poster-submission",
              token: input.challengeToken ?? "",
              actor: ctx.actor,
              eventId: ctx.eventId,
            })))
        )
          fail("Form verification failed.", 403);
        return transaction(ctx.db, () => {
          const details = {
            name: input.name.trim(),
            email: input.email.toLowerCase(),
            title: input.title.trim(),
            abstract: input.abstract.trim(),
            organization: input.organization ?? "",
            coauthors: input.coauthors ?? "",
            size: input.size ?? "either",
            setupNotes: input.setupNotes ?? "",
          };
          const key = ctx.fingerprint(
              JSON.stringify([details.email, input.requestId]),
            ),
            digest = ctx.fingerprint(
              JSON.stringify([details, input.callRevision]),
            );
          const previous = ctx.db
            .prepare("SELECT id,digest FROM tk_posters WHERE retry_key=?")
            .get(key);
          if (previous) {
            if (previous.digest !== digest)
              fail(
                "This request ID was already used for a different proposal.",
                409,
              );
            return { id: previous.id, received: true };
          }
          const fresh = readCall(ctx.db),
            now = time();
          if (
            fresh.revision !== input.callRevision ||
            call.revision !== fresh.revision ||
            input.consentAccepted !== true
          )
            fail("Review and accept the current call terms.", 409);
          if (now > fresh.deadline) fail("The poster call has closed.", 410);
          const id = randomUUID();
          ctx.db
            .prepare(
              "INSERT INTO tk_posters VALUES(?,?,?,?,'submitted',1,?,?,?)",
            )
            .run(
              id,
              key,
              digest,
              encode(ctx, details),
              fresh.revision,
              fresh.consent,
              now,
            );
          return { id, received: true };
        });
      },
    ),
    operation(
      "posters_review_queue",
      "List private proposal details and current decision revisions.",
      obj({ status: statuses }, []),
      {},
      organizer,
      (input, ctx) => {
        const rows = input.status
          ? ctx.db
              .prepare(
                "SELECT * FROM tk_posters WHERE status=? ORDER BY created_at,id",
              )
              .all(input.status)
          : ctx.db
              .prepare("SELECT * FROM tk_posters ORDER BY created_at,id")
              .all();
        return { proposals: rows.map((r) => asPrivate(ctx, r)) };
      },
    ),
    operation(
      "posters_decide",
      "Record a proposal decision using its current revision.",
      obj({ id, status: statuses, revision: rev }),
      { id: "from-posters-review-queue", status: "accepted", revision: 1 },
      organizer,
      (input, ctx) => {
        changed(
          ctx.db
            .prepare(
              "UPDATE tk_posters SET status=?,revision=revision+1 WHERE id=? AND revision=?",
            )
            .run(input.status, input.id, input.revision),
        );
        return {
          id: input.id,
          status: input.status,
          revision: input.revision + 1,
        };
      },
    ),
    operation(
      "posters_presenters",
      "Return accepted presenters as source records for checkin_register.",
      obj({}),
      {},
      organizer,
      (_, ctx) => ({
        people: ctx.db
          .prepare(
            "SELECT * FROM tk_posters WHERE status='accepted' ORDER BY created_at,id",
          )
          .all()
          .map((row) => {
            const { name, email, organization } = decode(ctx, row.details);
            return {
              id: "poster:" + row.id,
              source: "poster",
              name,
              company: organization,
              email,
              status: "active",
              type: "attendee",
            };
          }),
      }),
    ),
    operation(
      "posters_export",
      "Download organizer-only proposal decisions and presenter details as CSV.",
      obj({ status: statuses }, []),
      {},
      organizer,
      (input, ctx) => {
        const rows = ctx.db
          .prepare(
            "SELECT * FROM tk_posters WHERE (? IS NULL OR status=?) ORDER BY created_at,id",
          )
          .all(input.status ?? null, input.status ?? null)
          .map((row) => asPrivate(ctx, row));
        const columns = [
          "id",
          "name",
          "email",
          "organization",
          "title",
          "abstract",
          "status",
          "receivedAt",
        ];
        return {
          count: rows.length,
          artifact: csvArtifact("poster-proposals.csv", [
            columns,
            ...rows.map((row) => columns.map((k) => row[k])),
          ]),
        };
      },
    ),
  ],
};
