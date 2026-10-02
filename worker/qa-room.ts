import { DurableObject } from "cloudflare:workers";
import type {
  QaActor,
  QaCommand,
  QaQuestion,
  QaResult,
  QaRoomStatus,
  QaSnapshot,
} from "./qa-types.ts";

type Metadata = {
  revision: number;
  status: QaRoomStatus;
  active_question_id: string | null;
};
type QuestionRow = {
  id: string;
  text: string;
  status: "pending" | "approved" | "answered" | "hidden";
  participant_key: string;
  created_at: string;
  revision: number;
};
const failure = (message: string, status = 409): QaResult => ({
  ok: false,
  changed: false,
  message,
  status,
});
const success = (message: string, changed = true): QaResult => ({
  ok: true,
  changed,
  message,
  status: 200,
});

export class QaRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS qa_metadata (
          id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('open', 'paused', 'archived')),
          active_question_id TEXT
        );
        INSERT INTO qa_metadata VALUES (1, 0, 'paused', NULL) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS qa_questions (
          id TEXT PRIMARY KEY, text TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'answered', 'hidden')),
          participant_key TEXT NOT NULL, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
          request_id TEXT NOT NULL, UNIQUE (participant_key, request_id)
        );
        CREATE TABLE IF NOT EXISTS qa_votes (
          question_id TEXT NOT NULL REFERENCES qa_questions(id) ON DELETE CASCADE,
          participant_key TEXT NOT NULL, PRIMARY KEY (question_id, participant_key)
        );
        CREATE TABLE IF NOT EXISTS qa_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS qa_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL,
          actor_id TEXT NOT NULL, role TEXT NOT NULL, action TEXT NOT NULL, question_id TEXT
        );
      `);
    });
  }

  async snapshot(
    role: QaActor["role"],
    participantKey = "",
  ): Promise<QaSnapshot> {
    const metadata = this.metadata();
    const staff = role === "admin" || role === "moderator";
    const rows = this.ctx.storage.sql
      .exec<QuestionRow & { votes: number; voted: number }>(
        `
      SELECT q.*, (SELECT COUNT(*) FROM qa_votes WHERE question_id = q.id) AS votes,
        EXISTS (SELECT 1 FROM qa_votes WHERE question_id = q.id AND participant_key = ?) AS voted
      FROM qa_questions q
      WHERE ? = 1 OR q.status = 'approved' OR (q.status = 'pending' AND q.participant_key = ? AND ? = 'attendee')
      ORDER BY votes DESC, q.created_at, q.id`,
        participantKey,
        staff ? 1 : 0,
        participantKey,
        role,
      )
      .toArray();
    const questions: QaQuestion[] = rows.map((row) => ({
      id: row.id,
      text: row.text,
      status: row.id === metadata.active_question_id ? "active" : row.status,
      createdAt: row.created_at,
      revision: row.revision,
      votes: row.votes,
      own: row.participant_key === participantKey,
      voted: Boolean(row.voted),
    }));
    return {
      revision: metadata.revision,
      status: metadata.status,
      activeQuestionId: metadata.active_question_id,
      questions,
    };
  }

  async history(): Promise<Record<string, SqlStorageValue>[]> {
    return this.ctx.storage.sql
      .exec(
        "SELECT occurred_at, actor_id, role, action, question_id FROM qa_history ORDER BY id DESC LIMIT 100",
      )
      .toArray();
  }

  async throttle(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean> {
    return this.rateLimited(key, limit, windowMs);
  }

  async command(
    actor: QaActor,
    command: QaCommand,
    ipKey: string,
  ): Promise<QaResult> {
    // The binding is private to the Worker. Roles and participant keys come from
    // server authentication, never from submitted form fields.
    if (!/^[a-f0-9]{64}$/u.test(actor.participantKey))
      return failure("Reload this page before continuing.", 400);
    const moderator = actor.role === "admin" || actor.role === "moderator";
    const mc = actor.role === "admin" || actor.role === "mc";
    const metadata = this.metadata();
    if (command.action === "add") {
      if (actor.role !== "attendee" && !moderator)
        return failure("Moderator access is required.", 403);
      if (
        metadata.status === "archived" ||
        (actor.role === "attendee" && metadata.status !== "open")
      )
        return failure("Questions are paused for this session.");
      const text = command.text
        .trim()
        .normalize("NFC")
        .replaceAll(/\s+/gu, " ");
      if (text.length < 8 || text.length > 500)
        return failure(
          "Use between 8 and 500 characters for your question.",
          400,
        );
      if (!/^[a-zA-Z0-9-]{16,80}$/u.test(command.requestId))
        return failure("Reload this page before asking your question.", 400);
      const duplicate = this.ctx.storage.sql
        .exec(
          "SELECT id FROM qa_questions WHERE participant_key = ? AND request_id = ?",
          actor.participantKey,
          command.requestId,
        )
        .toArray()[0];
      if (duplicate) return success("Question already received.", false);
      if (
        this.ctx.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM qa_questions")
          .one().count >= 1000
      )
        return failure("This room is full. Please ask a moderator for help.");
      if (
        !moderator &&
        (this.rateLimited(`submit:${actor.participantKey}`, 3, 60_000) ||
          this.rateLimited(`submit-ip:${ipKey}`, 300, 60_000))
      )
        return failure(
          "Please wait a minute before adding another question.",
          429,
        );
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO qa_questions (id, text, status, participant_key, created_at, request_id) VALUES (?, ?, ?, ?, ?, ?)",
          crypto.randomUUID(),
          text,
          moderator ? "approved" : "pending",
          actor.participantKey,
          new Date().toISOString(),
          command.requestId,
        );
        this.advance();
        if (moderator) this.audit(actor, "added", null);
      });
      return success(
        moderator ? "Question added." : "Question sent for moderation.",
      );
    }
    if (command.action === "status") {
      if (
        !moderator ||
        (command.status === "archived" && actor.role !== "admin")
      )
        return failure("Admin access is required for this action.", 403);
      if (!["open", "paused", "archived"].includes(command.status))
        return failure("Choose a valid room status.", 400);
      if (metadata.status === "archived" && actor.role !== "admin")
        return failure("An admin must reopen this room.", 403);
      if (metadata.status === command.status)
        return success("Room status already saved.", false);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "UPDATE qa_metadata SET status = ?, active_question_id = CASE WHEN ? = 'archived' THEN NULL ELSE active_question_id END WHERE id = 1",
          command.status,
          command.status,
        );
        this.advance();
        this.audit(actor, command.status, null);
      });
      return success(`Room ${command.status}.`);
    }
    if (command.action === "reset") {
      if (actor.role !== "admin")
        return failure("Admin access is required.", 403);
      if (
        command.confirmation !== "CLEAR" ||
        command.revision !== metadata.revision
      )
        return failure(
          "Reload the room and type CLEAR to confirm clearing its questions.",
        );
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "DELETE FROM qa_votes; DELETE FROM qa_questions; DELETE FROM qa_rate_limits; UPDATE qa_metadata SET status = 'paused', active_question_id = NULL WHERE id = 1;",
        );
        this.advance();
        this.audit(actor, "cleared", null);
      });
      return success("Questions cleared. The room is paused.");
    }
    if (metadata.status === "archived")
      return failure("This room has been archived.");
    const question = this.ctx.storage.sql
      .exec<QuestionRow>(
        "SELECT * FROM qa_questions WHERE id = ?",
        command.questionId,
      )
      .toArray()[0];
    if (!question) return failure("This question is no longer available.", 404);
    if (command.action === "vote") {
      if (metadata.status !== "open" || question.status !== "approved")
        return failure("Voting is paused or this question is unavailable.");
      if (question.participant_key === actor.participantKey)
        return failure("You cannot vote for your own question.", 400);
      const voted = this.ctx.storage.sql
        .exec(
          "SELECT 1 FROM qa_votes WHERE question_id = ? AND participant_key = ?",
          question.id,
          actor.participantKey,
        )
        .toArray()[0];
      if (voted) return success("Your vote is already counted.", false);
      if (
        this.rateLimited(`vote:${actor.participantKey}`, 60, 60_000) ||
        this.rateLimited(`vote-ip:${ipKey}`, 3000, 60_000)
      )
        return failure("Please wait a minute before voting again.", 429);
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(
          "INSERT INTO qa_votes VALUES (?, ?)",
          question.id,
          actor.participantKey,
        );
        this.advance();
      });
      return success("Vote counted.");
    }
    if (["approve", "hide", "edit"].includes(command.action)) {
      if (!moderator) return failure("Moderator access is required.", 403);
      if (command.revision !== question.revision)
        return failure(
          "This question changed elsewhere. Reload before editing it.",
        );
      if (
        command.action === "approve" &&
        question.status !== "pending" &&
        question.status !== "hidden"
      )
        return failure("This question cannot be approved.");
      const text = command.text
        .trim()
        .normalize("NFC")
        .replaceAll(/\s+/gu, " ");
      if (command.action === "edit" && (text.length < 8 || text.length > 500))
        return failure(
          "Use between 8 and 500 characters for the question.",
          400,
        );
      this.ctx.storage.transactionSync(() => {
        if (command.action === "edit")
          this.ctx.storage.sql.exec(
            "UPDATE qa_questions SET text = ?, revision = revision + 1 WHERE id = ?",
            text,
            question.id,
          );
        else
          this.ctx.storage.sql.exec(
            "UPDATE qa_questions SET status = ?, revision = revision + 1 WHERE id = ?",
            command.action === "approve" ? "approved" : "hidden",
            question.id,
          );
        if (command.action === "hide")
          this.ctx.storage.sql.exec(
            "UPDATE qa_metadata SET active_question_id = NULL WHERE active_question_id = ?",
            question.id,
          );
        this.advance();
        this.audit(actor, command.action, question.id);
      });
      return success("Question updated.");
    }
    if (command.action === "select" || command.action === "done") {
      if (!mc) return failure("MC access is required.", 403);
      if ((metadata.active_question_id ?? "") !== command.expectedActiveId)
        return failure("The question on screen changed. Reload the MC queue.");
      if (question.status !== "approved")
        return failure("Only approved questions can be selected.");
      if (
        command.action === "done" &&
        metadata.active_question_id !== question.id
      )
        return failure("This is no longer the question on screen.");
      this.ctx.storage.transactionSync(() => {
        if (command.action === "done")
          this.ctx.storage.sql.exec(
            "UPDATE qa_questions SET status = 'answered', revision = revision + 1 WHERE id = ?",
            question.id,
          );
        this.ctx.storage.sql.exec(
          "UPDATE qa_metadata SET active_question_id = ? WHERE id = 1",
          command.action === "select" ? question.id : null,
        );
        this.advance();
        this.audit(actor, command.action, question.id);
      });
      return success(
        command.action === "select"
          ? "Question on screen."
          : "Question marked answered.",
      );
    }
    return failure("Unknown QA action.", 400);
  }

  private metadata(): Metadata {
    return this.ctx.storage.sql
      .exec<Metadata>("SELECT * FROM qa_metadata WHERE id = 1")
      .one();
  }
  private advance(): void {
    this.ctx.storage.sql.exec(
      "UPDATE qa_metadata SET revision = revision + 1 WHERE id = 1",
    );
  }
  private audit(
    actor: QaActor,
    action: string,
    questionId: string | null,
  ): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO qa_history (occurred_at, actor_id, role, action, question_id) VALUES (?, ?, ?, ?, ?)",
      new Date().toISOString(),
      actor.id,
      actor.role,
      action,
      questionId,
    );
  }
  private rateLimited(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "DELETE FROM qa_rate_limits WHERE until_ms <= ?",
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO qa_rate_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
      key,
      now + windowMs,
    );
    return (
      this.ctx.storage.sql
        .exec<{
          count: number;
        }>("SELECT count FROM qa_rate_limits WHERE key = ?", key)
        .one().count > limit
    );
  }
}
