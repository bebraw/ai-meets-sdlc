import { randomBytes } from "node:crypto";

export const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const text = (maxLength = 200, minLength = 1) => ({
  type: "string",
  minLength,
  maxLength,
});
export const number = (minimum, maximum) => ({
  type: "integer",
  minimum,
  maximum,
});
export const choice = (...values) => ({ type: "string", enum: values });
export const list = (items, maxItems, minItems = 0) => ({
  type: "array",
  items,
  minItems,
  maxItems,
});
export const key = { ...text(80), pattern: "^[a-zA-Z0-9_-]+$" };
export const revision = number(0, Number.MAX_SAFE_INTEGER - 1);
export const email = {
  ...text(254),
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
};
export const publicRoles = [
  "public",
  "attendee",
  "organizer",
  "moderator",
  "mc",
  "staff",
  "speaker",
];
export const organizer = ["organizer"];

export function operation(name, description, inputSchema, example, roles, run) {
  return { name, description, inputSchema, example, roles, run };
}

export function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function clean(value, label) {
  const s = value.trim();
  if (!s) fail(`Enter ${label}.`);
  return s;
}

export function atomic(db, write) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = write();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function newCode() {
  return randomBytes(32).toString("base64url");
}

export function codeInstructions(ctx, operationName, code) {
  const url = ctx.services?.actionUrl?.(operationName, { code }, ctx.eventId);
  return url || `${operationName} — code: ${code}`;
}

export async function verifyChallenge(ctx, action, token) {
  const verify = ctx.services?.verifyChallenge;
  if (
    verify &&
    !(await verify({ action, token, actor: ctx.actor, eventId: ctx.eventId }))
  )
    fail("Form verification failed.", 403);
}

export function limitWrites(db, key, limit, periodMs) {
  const now = Date.now();
  db.prepare("DELETE FROM engagement_limits WHERE expires <= ?").run(now);
  const saved = db
    .prepare(
      `INSERT INTO engagement_limits (id, attempts, expires) VALUES (?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 WHERE attempts < ? RETURNING attempts`,
    )
    .get(key, now + periodMs, limit);
  if (!saved) fail("Too many requests. Try again later.", 429);
}

export function migrateLimits(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS engagement_limits (
    id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS engagement_limits_expiry ON engagement_limits(expires)`);
}

export function actorKey(ctx, purpose) {
  if (!ctx.actor) fail("A participant identity is required.", 401);
  return ctx.fingerprint(`${purpose}:${ctx.actor}`);
}

export function mailer(ctx) {
  if (typeof ctx.services?.sendMail !== "function")
    fail(
      "Configure a transactional mail sender before using this operation.",
      503,
    );
  return ctx.services.sendMail;
}
