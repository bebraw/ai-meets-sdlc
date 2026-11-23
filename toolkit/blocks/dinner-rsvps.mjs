import { randomUUID } from "node:crypto";
import {
  anyone,
  changed,
  choice,
  dateValue,
  decode,
  email,
  encode,
  fail,
  id,
  invitation,
  newToken,
  obj,
  operation,
  organizer,
  rev,
  text,
  time,
  tokenField,
  transaction,
  word,
} from "./workflow-helpers.mjs";

const sampleToken = "token-from-dinner-invite";
function purge(db, now = time()) {
  return db
    .prepare("DELETE FROM tk_dinner_guests WHERE retain_until<=?")
    .run(now).changes;
}
function find(ctx, token) {
  purge(ctx.db);
  const row = ctx.db
    .prepare("SELECT * FROM tk_dinner_guests WHERE token_hash=? AND revoked=0")
    .get(ctx.fingerprint(token));
  if (!row) fail("Invitation is invalid, revoked or expired.", 404);
  return row;
}
function guest(ctx, row) {
  return {
    id: row.id,
    ...decode(ctx, row.guest),
    response: row.response ? decode(ctx, row.response) : null,
    replyBy: row.deadline,
    retainUntil: row.retain_until,
    revision: row.revision,
    revoked: Boolean(row.revoked),
  };
}
const meal = choice("omnivore", "vegetarian", "vegan", "other", "unspecified");
const response = {
  token: tokenField,
  revision: rev,
  attendance: choice("attending", "not_attending"),
  meal,
  diet: text(1900),
  crossContamination: choice("yes", "no", "unsure", "unspecified"),
};
export const dinner = {
  id: "dinner-rsvps",
  title: "Dinner RSVPs",
  description:
    "Issue guest invitations, collect private meal responses and prepare a catering handoff.",
  migrate(db) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS tk_dinner_guests(id TEXT PRIMARY KEY,guest TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,deadline TEXT NOT NULL,retain_until TEXT NOT NULL,response TEXT,revision INTEGER NOT NULL DEFAULT 1,revoked INTEGER NOT NULL DEFAULT 0)`,
    );
  },
  cleanup(ctx) {
    purge(ctx.db);
  },
  operations: [
    operation(
      "dinner_invite",
      "Invite one named guest and set a reply deadline and private-data deletion date.",
      obj({ name: word(), email, replyBy: word(64), retainUntil: word(64) }, [
        "name",
        "replyBy",
        "retainUntil",
      ]),
      {
        name: "Casey Chen",
        replyBy: "2030-09-01T18:00:00Z",
        retainUntil: "2030-09-20T00:00:00Z",
      },
      organizer,
      (input, ctx) => {
        const deadline = dateValue(input.replyBy),
          retention = dateValue(input.retainUntil);
        if (deadline <= time() || retention <= deadline)
          fail("The future reply deadline must precede the deletion date.");
        const id = randomUUID(),
          token = newToken();
        ctx.db
          .prepare(
            "INSERT INTO tk_dinner_guests(id,guest,token_hash,deadline,retain_until) VALUES(?,?,?,?,?)",
          )
          .run(
            id,
            encode(ctx, {
              name: input.name.trim(),
              email: input.email?.toLowerCase() ?? "",
            }),
            ctx.fingerprint(token),
            deadline,
            retention,
          );
        return {
          id,
          ...invitation(ctx, "dinner_read_invitation", token),
          replyBy: deadline,
          retainUntil: retention,
        };
      },
    ),
    operation(
      "dinner_read_invitation",
      "Read only the dinner invitation and response identified by its private token.",
      obj({ token: tokenField }),
      { token: sampleToken },
      anyone,
      (input, ctx) => {
        const { email, ...item } = guest(ctx, find(ctx, input.token));
        return item;
      },
    ),
    operation(
      "dinner_respond",
      "Set attendance and dietary requirements for the invited guest before the deadline.",
      obj(response, ["token", "revision", "attendance"]),
      {
        token: sampleToken,
        revision: 1,
        attendance: "attending",
        meal: "vegan",
        diet: "",
        crossContamination: "unsure",
      },
      anyone,
      (input, ctx) =>
        transaction(ctx.db, () => {
          const row = find(ctx, input.token);
          if (time() > row.deadline)
            fail("The dinner response deadline has passed.", 410);
          const attending = input.attendance === "attending";
          const answer = {
            attendance: input.attendance,
            meal: attending ? (input.meal ?? "unspecified") : "unspecified",
            diet: attending ? (input.diet ?? "") : "",
            crossContamination: attending
              ? (input.crossContamination ?? "unspecified")
              : "unspecified",
          };
          changed(
            ctx.db
              .prepare(
                "UPDATE tk_dinner_guests SET response=?,revision=revision+1 WHERE id=? AND revision=? AND revoked=0",
              )
              .run(encode(ctx, answer), row.id, input.revision),
          );
          return { id: row.id, revision: input.revision + 1, response: answer };
        }),
    ),
    operation(
      "dinner_list",
      "List invitations, replies and their revisions for the organizer.",
      obj({}),
      {},
      organizer,
      (_, ctx) => {
        purge(ctx.db);
        return {
          guests: ctx.db
            .prepare("SELECT * FROM tk_dinner_guests ORDER BY rowid")
            .all()
            .map((r) => guest(ctx, r)),
        };
      },
    ),
    operation(
      "dinner_revoke",
      "Revoke a guest’s link and remove their saved response from meal totals.",
      obj({ id, revision: rev }),
      { id: "from-dinner-list", revision: 1 },
      organizer,
      (input, ctx) => {
        changed(
          ctx.db
            .prepare(
              "UPDATE tk_dinner_guests SET revoked=1,response=NULL,revision=revision+1 WHERE id=? AND revision=?",
            )
            .run(input.id, input.revision),
        );
        return { revoked: true };
      },
    ),
    operation(
      "dinner_catering",
      "Produce attending meal counts and unnamed dietary records for the catering brief.",
      obj({}),
      {},
      organizer,
      (_, ctx) => {
        purge(ctx.db);
        let pending = 0,
          declined = 0;
        const meals = {},
          people = [];
        for (const row of ctx.db
          .prepare(
            "SELECT id,response FROM tk_dinner_guests WHERE revoked=0 ORDER BY rowid",
          )
          .iterate()) {
          if (!row.response) {
            pending++;
            continue;
          }
          const answer = decode(ctx, row.response);
          if (answer.attendance !== "attending") {
            declined++;
            continue;
          }
          meals[answer.meal] = (meals[answer.meal] ?? 0) + 1;
          const dietary = [
            ...(["vegan", "vegetarian"].includes(answer.meal)
              ? [answer.meal]
              : []),
            answer.diet,
            ...(["yes", "unsure"].includes(answer.crossContamination)
              ? ["Cross-contamination: " + answer.crossContamination]
              : []),
          ].filter(Boolean);
          people.push({ status: "active", diet: dietary.join("; ") });
        }
        return { attending: people.length, pending, declined, meals, people };
      },
    ),
  ],
};
