import { randomUUID } from "node:crypto";
import {
  actorKey,
  atomic,
  choice,
  clean,
  fail,
  key,
  limitWrites,
  list,
  migrateLimits,
  newCode,
  number,
  object,
  operation,
  organizer,
  publicRoles,
  revision,
  text,
  verifyChallenge,
} from "./engagement-common.mjs";

const day = 86_400_000;
const question = object(
  {
    id: key,
    label: text(300),
    kind: choice("rating", "recommendation", "choice", "text"),
    options: list(text(150), 30, 2),
    required: { type: "boolean" },
  },
  ["id", "label", "kind"],
);
const sampleQuestions = [
  {
    id: "value",
    label: "How valuable was the programme?",
    kind: "rating",
    required: true,
  },
  {
    id: "recommend",
    label: "How likely are you to recommend the event?",
    kind: "recommendation",
  },
  { id: "comment", label: "What could we improve?", kind: "text" },
];

function unpack(row) {
  if (!row) fail("The organizer has not published this questionnaire.", 404);
  return { ...row, questions: JSON.parse(row.questions) };
}

function currentForm(db) {
  return unpack(
    db
      .prepare("SELECT * FROM feedback_forms ORDER BY version DESC LIMIT 1")
      .get(),
  );
}

function checkAnswers(questions, answers) {
  const expected = new Set(questions.map((q) => q.id));
  for (const id of Object.keys(answers))
    if (!expected.has(id)) fail(`Unknown question: ${id}.`);
  const result = Object.create(null);
  for (const q of questions) {
    const value = Object.hasOwn(answers, q.id) ? answers[q.id] : undefined;
    if (value === undefined || value === "") {
      if (q.required) fail(`Answer “${q.label}”.`);
      continue;
    }
    if (q.kind === "text") {
      if (typeof value !== "string" || value.length > 2000 || !value.trim())
        fail(`Enter up to 2,000 characters for “${q.label}”.`);
      result[q.id] = value.trim();
    } else if (q.kind === "choice") {
      if (!q.options.includes(value))
        fail(`Choose a listed option for “${q.label}”.`);
      result[q.id] = value;
    } else {
      const [min, max] = q.kind === "rating" ? [1, 5] : [0, 10];
      if (!Number.isInteger(value) || value < min || value > max)
        fail(`Choose a number from ${min} to ${max} for “${q.label}”.`);
      result[q.id] = value;
    }
  }
  if (!Object.keys(result).length) fail("Answer at least one question.");
  return result;
}

function addTotals(db, form, answers, step) {
  const add =
    db.prepare(`INSERT INTO feedback_counts(version,question,answer,n) VALUES(?,?,?,?)
    ON CONFLICT(version,question,answer) DO UPDATE SET n=n+excluded.n`);
  for (const q of form.questions) {
    if (q.kind !== "text" && Object.hasOwn(answers, q.id))
      add.run(form.version, q.id, String(answers[q.id]), step);
  }
  db.prepare(
    "UPDATE feedback_forms SET received=received+? WHERE version=?",
  ).run(step, form.version);
}

export const feedback = {
  id: "event-feedback",
  title: "Event feedback",
  description:
    "Publish a versioned survey, collect responses with consent, and review private comments and aggregate ratings.",
  migrate(db) {
    migrateLimits(db);
    db.exec(`CREATE TABLE IF NOT EXISTS feedback_forms(
      version INTEGER PRIMARY KEY, title TEXT NOT NULL, consent TEXT NOT NULL, retentionDays INTEGER NOT NULL,
      questions TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS feedback_private(
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, version INTEGER NOT NULL REFERENCES feedback_forms(version),
      answers TEXT NOT NULL, submitted TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS feedback_private_expiry ON feedback_private(expires);
    CREATE TABLE IF NOT EXISTS feedback_counts(
      version INTEGER NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,n INTEGER NOT NULL,PRIMARY KEY(version,question,answer));
    `);
  },
  cleanup({ db }) {
    return {
      expired: db
        .prepare("DELETE FROM feedback_private WHERE expires<=?")
        .run(Date.now()).changes,
    };
  },
  operations: [
    operation(
      "feedback_publish_form",
      "Publish a new questionnaire version. Ratings use 1–5; recommendation uses 0–10. Raw responses expire after the configured number of days.",
      object({
        title: text(),
        consent: text(2000),
        retentionDays: number(1, 365),
        questions: list(question, 40, 1),
        revision,
      }),
      {
        title: "Autumn gathering",
        consent: "I agree that my answers may be used to improve this event.",
        retentionDays: 30,
        questions: sampleQuestions,
        revision: 0,
      },
      organizer,
      (input, { db }) =>
        atomic(db, () => {
          const previous = db
            .prepare("SELECT COALESCE(MAX(version),0) AS v FROM feedback_forms")
            .get().v;
          if (previous !== input.revision)
            fail("The survey has changed. Load the published form.", 409);
          const ids = new Set();
          for (const q of input.questions) {
            if (
              ids.has(q.id) ||
              ["__proto__", "constructor", "prototype"].includes(q.id)
            )
              fail("Use unique question IDs.");
            ids.add(q.id);
            clean(q.label, "a question label");
            if (
              q.kind === "choice" &&
              (!q.options ||
                new Set(q.options).size !== q.options.length ||
                q.options.some((o) => !o.trim()))
            )
              fail("Supply at least two distinct choices.");
            if (q.kind !== "choice" && q.options)
              fail("Only choice questions accept options.");
          }
          db.prepare(
            "INSERT INTO feedback_forms(version,title,consent,retentionDays,questions) VALUES(?,?,?,?,?)",
          ).run(
            previous + 1,
            clean(input.title, "a title"),
            clean(input.consent, "the consent wording"),
            input.retentionDays,
            JSON.stringify(input.questions),
          );
          return currentForm(db);
        }),
    ),
    operation(
      "feedback_form",
      "Read the published questionnaire and its consent wording.",
      object({}),
      {},
      publicRoles,
      (_, { db }) => currentForm(db),
    ),
    operation(
      "feedback_respond",
      "Submit answers for the form version you read. Keep the returned private code to withdraw before raw answers expire.",
      object(
        {
          version: number(1, 1_000_000),
          consent: { const: true, type: "boolean" },
          answers: {
            type: "object",
            minProperties: 1,
            maxProperties: 40,
            additionalProperties: { anyOf: [text(2000, 0), number(0, 10)] },
          },
          challenge: text(4096),
        },
        ["version", "consent", "answers"],
      ),
      {
        version: 1,
        consent: true,
        answers: {
          value: 5,
          recommend: 9,
          comment: "Longer breaks would help.",
        },
      },
      publicRoles,
      async (input, ctx) => {
        await verifyChallenge(ctx, "feedback_respond", input.challenge);
        return atomic(ctx.db, () => {
          const form = currentForm(ctx.db);
          if (form.version !== input.version || input.consent !== true)
            fail("Review the current form and its consent wording.", 409);
          const answers = checkAnswers(form.questions, input.answers);
          limitWrites(ctx.db, actorKey(ctx, "feedback"), 10, 60 * 60_000);
          const code = newCode(),
            now = Date.now(),
            expires = now + form.retentionDays * day;
          ctx.db
            .prepare("INSERT INTO feedback_private VALUES(?,?,?,?,?,?)")
            .run(
              randomUUID(),
              ctx.fingerprint("feedback:" + code),
              form.version,
              ctx.seal(JSON.stringify(answers)),
              new Date(now).toISOString(),
              expires,
            );
          addTotals(ctx.db, form, answers, 1);
          return {
            withdrawalCode: code,
            expiresAt: new Date(expires).toISOString(),
          };
        });
      },
    ),
    operation(
      "feedback_withdraw",
      "Delete a response using its private code and remove its contribution to the survey counts.",
      object({ code: text(128) }),
      { code: "private-code-from-submission" },
      publicRoles,
      ({ code }, ctx) =>
        atomic(ctx.db, () => {
          const row = ctx.db
            .prepare(
              "DELETE FROM feedback_private WHERE code=? AND expires>? RETURNING version,answers",
            )
            .get(ctx.fingerprint("feedback:" + code), Date.now());
          if (!row) fail("This code is invalid, expired or already used.", 404);
          const form = unpack(
            ctx.db
              .prepare("SELECT * FROM feedback_forms WHERE version=?")
              .get(row.version),
          );
          addTotals(ctx.db, form, JSON.parse(ctx.open(row.answers)), -1);
          return { withdrawn: true };
        }),
    ),
    operation(
      "feedback_report",
      "Read counts for a survey version, including recommendation scores. Optionally read a page of unexpired private answers.",
      object(
        {
          version: number(1, 1_000_000),
          includeResponses: { type: "boolean" },
          offset: number(0, 1_000_000),
        },
        [],
      ),
      { version: 1, includeResponses: false },
      organizer,
      (input, ctx) => {
        const form = input.version
          ? unpack(
              ctx.db
                .prepare("SELECT * FROM feedback_forms WHERE version=?")
                .get(input.version),
            )
          : currentForm(ctx.db);
        const totals = ctx.db
          .prepare(
            "SELECT question,answer,n AS count FROM feedback_counts WHERE version=? AND n>0 ORDER BY question,answer",
          )
          .all(form.version);
        const recommendationScores = form.questions
          .filter((q) => q.kind === "recommendation")
          .map((q) => {
            const answers = totals.filter((row) => row.question === q.id);
            const answered = answers.reduce((a, row) => a + row.count, 0);
            const net = answers.reduce(
              (a, row) =>
                a +
                row.count *
                  (Number(row.answer) >= 9
                    ? 1
                    : Number(row.answer) <= 6
                      ? -1
                      : 0),
              0,
            );
            return {
              id: q.id,
              answered,
              score: answered ? Math.round((100 * net) / answered) : null,
            };
          });
        const result = {
          version: form.version,
          responsesReceived: form.received,
          totals,
          recommendationScores,
        };
        if (input.includeResponses)
          result.responses = ctx.db
            .prepare(
              "SELECT submitted,answers FROM feedback_private WHERE version=? AND expires>? ORDER BY rowid DESC LIMIT 50 OFFSET ?",
            )
            .all(form.version, Date.now(), input.offset ?? 0)
            .map((row) => ({
              ...row,
              answers: JSON.parse(ctx.open(row.answers)),
            }));
        return result;
      },
    ),
  ],
};
