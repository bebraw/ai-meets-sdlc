import * as v from "valibot";
import type { Context, Role, QueryDatabase } from "../contracts.mjs";
import { randomUUID } from "node:crypto";
import {
  actorKey,
  atomic,
  choice,
  clean,
  fail,
  key,
  limitWrites,
  migrateLimits,
  object,
  operation,
  organizer,
  publicRoles,
  revision,
  text,
} from "./engagement-common.mjs";

const moderators: Role[] = ["organizer", "moderator"];
const hosts: Role[] = ["organizer", "mc"];
const room = "main-stage";
const exampleQuestion = "replace-with-question-id";

export type Room = {
  id: string;
  title: string;
  status: string;
  selected: string | null;
  revision: number;
};
type Question = {
  id: string;
  question: string;
  status: string;
  revision: number;
};
type StoredQuestion = Question & {
  room: string;
  actor: string;
  submitted_hash: string | null;
};

function getRoom(db: QueryDatabase, id: string) {
  return (
    db.prepare<Room>("SELECT * FROM audience_rooms WHERE id=?").get(id) ??
    fail("Q&A room not found.", 404)
  );
}

function getQuestion(db: QueryDatabase, roomId: string, questionId: string) {
  return (
    db
      .prepare<StoredQuestion>(
        "SELECT * FROM audience_questions WHERE room=? AND id=?",
      )
      .get(roomId, questionId) ?? fail("Question not found in this room.", 404)
  );
}

function roomView(input: { room: string }, ctx: Context) {
  const record = getRoom(ctx.db, input.room);
  const viewer = actorKey(ctx, "qa");
  const questions = ctx.db
    .prepare<Question & { votes: number; voted: number; own: number }>(
      `SELECT q.id, q.question, q.status, q.revision,
    (SELECT COUNT(*) FROM audience_votes v WHERE v.question=q.id) AS votes,
    EXISTS(SELECT 1 FROM audience_votes v WHERE v.question=q.id AND v.actor=?) AS voted,
    q.actor=? AS own
    FROM audience_questions q WHERE q.room=? AND
      (?=1 OR q.status='approved' OR (q.status='pending' AND q.actor=?))
    ORDER BY votes DESC, q.rowid`,
    )
    .all(
      viewer,
      viewer,
      input.room,
      Number(moderators.includes(ctx.role)),
      viewer,
    );
  return {
    room: record,
    questions,
    screen: questions.find((q) => q.id === record.selected) ?? null,
    permissions: {
      canModerate: moderators.includes(ctx.role),
      canPresent: hosts.includes(ctx.role),
    },
  };
}

export type RoomView = ReturnType<typeof roomView>;
export type StageSelection = {
  room: string;
  title: string;
  status: string;
  questionId: string | null;
  question: string | null;
};

export const qa = {
  id: "audience-qa",
  title: "Moderated audience Q&A",
  description:
    "Open a session room, collect questions and votes, moderate the queue and choose the question shown on stage.",
  migrate(db: QueryDatabase) {
    migrateLimits(db);
    db.exec(`CREATE TABLE IF NOT EXISTS audience_rooms (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, selected TEXT, revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS audience_questions (
      id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES audience_rooms(id), actor TEXT NOT NULL,
      request_key TEXT NOT NULL, question TEXT NOT NULL, submitted_hash TEXT, status TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 1,
      UNIQUE(room,actor,request_key)
    );
    CREATE TABLE IF NOT EXISTS audience_votes (
      question TEXT NOT NULL REFERENCES audience_questions(id), actor TEXT NOT NULL, PRIMARY KEY(question,actor)
    );`);
    if (
      !db
        .prepare("PRAGMA table_info(audience_questions)")
        .all()
        .some((column) => column.name === "submitted_hash")
    ) {
      db.exec("ALTER TABLE audience_questions ADD COLUMN submitted_hash TEXT");
    }
  },
  operations: [
    operation(
      "qa_rooms",
      "List session rooms and their current status.",
      object({}),
      {},
      publicRoles,
      (_, { db }) => ({
        rooms: db
          .prepare<Room>("SELECT * FROM audience_rooms ORDER BY rowid")
          .all(),
      }),
    ),
    operation(
      "qa_configure_room",
      "Create a room using revision 0, or change its title and status using the current revision.",
      object({
        room: key,
        title: text(),
        status: choice("open", "paused", "archived"),
        revision,
      }),
      { room, title: "Main stage", status: "open", revision: 0 },
      organizer,
      (input, { db }) =>
        atomic(db, () => {
          const title = clean(input.title, "a room title");
          const saved =
            input.revision === 0
              ? db
                  .prepare<Room>(
                    "INSERT INTO audience_rooms(id,title,status) VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING *",
                  )
                  .get(input.room, title, input.status)
              : db
                  .prepare<Room>(
                    "UPDATE audience_rooms SET title=?,status=?,selected=CASE WHEN ?='archived' THEN NULL ELSE selected END,revision=revision+1 WHERE id=? AND revision=? RETURNING *",
                  )
                  .get(
                    title,
                    input.status,
                    input.status,
                    input.room,
                    input.revision,
                  );
          return (
            saved ??
            fail(
              "Room has changed. Reload rooms and use its current revision.",
              409,
            )
          );
        }),
    ),
    operation(
      "qa_view",
      "Read a room's approved queue and stage selection. Moderators can also see pending questions.",
      object({ room: key }),
      { room },
      publicRoles,
      roomView,
    ),
    operation(
      "qa_screen",
      "Display the MC's selected, approved question on a public stage screen.",
      object({ room: key }),
      { room },
      publicRoles,
      (input, { db }) => {
        const selected = db
          .prepare<StageSelection>(
            `SELECT r.title,r.id AS room,r.status,q.id AS questionId,q.question
          FROM audience_rooms r LEFT JOIN audience_questions q ON q.id=r.selected AND q.status='approved'
          WHERE r.id=?`,
          )
          .get(input.room);
        return selected ?? fail("Q&A room not found.", 404);
      },
    ),
    operation(
      "qa_ask",
      "Submit a question for moderation. Reuse requestId when retrying the same submission.",
      object({ room: key, question: text(1000), requestId: key }),
      {
        room,
        question: "Will the session slides be available?",
        requestId: "first-question",
      },
      publicRoles,
      (input, ctx) =>
        atomic(ctx.db, () => {
          const actor = actorKey(ctx, "qa");
          const question = clean(input.question, "a question");
          const fingerprint = ctx.fingerprint("qa-submission:" + question);
          const existing = ctx.db
            .prepare<
              Pick<
                StoredQuestion,
                "id" | "question" | "submitted_hash" | "status" | "revision"
              >
            >("SELECT id,question,submitted_hash,status,revision FROM audience_questions WHERE room=? AND actor=? AND request_key=?")
            .get(input.room, actor, input.requestId);
          if (existing) {
            if (
              (existing.submitted_hash ??
                ctx.fingerprint("qa-submission:" + existing.question)) !==
              fingerprint
            )
              fail("Choose a new request ID for a different question.", 409);
            return {
              id: existing.id,
              room: input.room,
              status: existing.status,
              revision: existing.revision,
            };
          }
          if (getRoom(ctx.db, input.room).status !== "open")
            fail("This room is closed to questions.", 409);
          limitWrites(ctx.db, `qa:${actor}`, 5, 60_000);
          return ctx.db
            .prepare<
              Pick<StoredQuestion, "id" | "room" | "status" | "revision">
            >("INSERT INTO audience_questions(id,room,actor,request_key,question,submitted_hash) VALUES(?,?,?,?,?,?) RETURNING id,room,status,revision")
            .get(
              randomUUID(),
              input.room,
              actor,
              input.requestId,
              question,
              fingerprint,
            )!;
        }),
    ),
    operation(
      "qa_moderate",
      "Approve or hide a question, optionally editing its text. Supply the question revision.",
      object({
        room: key,
        questionId: key,
        revision,
        status: choice("approved", "hidden"),
        question: v.optional(text(1000)),
      }),
      { room, questionId: exampleQuestion, revision: 1, status: "approved" },
      moderators,
      (input, { db, fingerprint }) =>
        atomic(db, () => {
          const record = getRoom(db, input.room);
          if (record.status === "archived") fail("This room is archived.", 409);
          const row = getQuestion(db, input.room, input.questionId);
          const saved = db
            .prepare<Question>(
              "UPDATE audience_questions SET status=?,question=?,submitted_hash=COALESCE(submitted_hash,?),revision=revision+1 WHERE id=? AND revision=? RETURNING id,question,status,revision",
            )
            .get(
              input.status,
              clean(input.question ?? row.question, "a question"),
              fingerprint("qa-submission:" + row.question),
              row.id,
              input.revision,
            );
          if (!saved) fail("Question has changed. Reload the room.", 409);
          if (record.selected === row.id && input.status === "hidden")
            db.prepare(
              "UPDATE audience_rooms SET selected=NULL,revision=revision+1 WHERE id=?",
            ).run(record.id);
          return saved;
        }),
    ),
    operation(
      "qa_vote",
      "Vote for an approved question from another participant. Repeated requests count once.",
      object({ room: key, questionId: key }),
      { room, questionId: exampleQuestion },
      publicRoles,
      (input, ctx) =>
        atomic(ctx.db, () => {
          const actor = actorKey(ctx, "qa");
          if (getRoom(ctx.db, input.room).status !== "open")
            fail("Voting is closed.", 409);
          const q = getQuestion(ctx.db, input.room, input.questionId);
          if (q.status !== "approved" || q.actor === actor)
            fail("Choose an approved question from another participant.", 409);
          ctx.db
            .prepare(
              "INSERT INTO audience_votes VALUES(?,?) ON CONFLICT DO NOTHING",
            )
            .run(q.id, actor);
          return {
            questionId: q.id,
            votes: ctx.db
              .prepare<{
                n: number;
              }>("SELECT COUNT(*) AS n FROM audience_votes WHERE question=?")
              .get(q.id)!.n,
          };
        }),
    ),
    operation(
      "qa_present",
      "Select an approved question for the stage, clear it, or mark the selected question answered. Supply the room revision.",
      object({
        room: key,
        revision,
        action: choice("select", "clear", "answered"),
        questionId: v.optional(key),
      }),
      { room, revision: 1, action: "select", questionId: exampleQuestion },
      hosts,
      (input, { db }) =>
        atomic(db, () => {
          const record = getRoom(db, input.room);
          if (
            record.status === "archived" ||
            record.revision !== input.revision
          )
            fail("Room has changed or is archived. Reload it.", 409);
          let selected = null;
          if (input.action === "select") {
            if (
              !input.questionId ||
              getQuestion(db, input.room, input.questionId).status !==
                "approved"
            )
              fail("Select an approved question.");
            selected = input.questionId;
          }
          if (input.action === "answered") {
            if (!record.selected) fail("Select a question first.", 409);
            db.prepare(
              "UPDATE audience_questions SET status='answered',revision=revision+1 WHERE id=?",
            ).run(record.selected);
          }
          return db
            .prepare<Room>(
              "UPDATE audience_rooms SET selected=?,revision=revision+1 WHERE id=? RETURNING *",
            )
            .get(selected, input.room)!;
        }),
    ),
  ],
};
