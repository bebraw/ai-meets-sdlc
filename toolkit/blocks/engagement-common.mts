import { randomBytes } from "node:crypto";

import type * as v from "valibot";
import {
  defineOperation,
  type Context,
  type Role,
  type QueryDatabase,
} from "../contracts.mjs";
import { engagementResults } from "./engagement-results.mjs";
export * from "./engagement-fields.mjs";
export const publicRoles: Role[] = [
  "public",
  "attendee",
  "organizer",
  "moderator",
  "mc",
  "staff",
  "speaker",
];
export const organizer: Role[] = ["organizer"];

export function operation<
  const N extends keyof typeof engagementResults,
  S extends v.GenericSchema,
  R,
>(
  name: N,
  description: string,
  schema: S,
  example: v.InferInput<S>,
  roles: Role[],
  run: (input: v.InferOutput<S>, ctx: Context) => R,
) {
  return defineOperation({
    name,
    description,
    schema,
    example,
    roles,
    run,
    outputSchema: engagementResults[name],
  });
}

export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}

export function clean(value: string, label: string) {
  const s = value.trim();
  if (!s) fail(`Enter ${label}.`);
  return s;
}

export function atomic<T>(db: QueryDatabase, write: () => T): T {
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

export function codeInstructions(
  ctx: Context,
  operationName: string,
  code: string,
) {
  const url = ctx.services?.actionUrl?.(operationName, { code }, ctx.eventId);
  return url || `${operationName} — code: ${code}`;
}

export async function verifyChallenge(
  ctx: Context,
  action: string,
  token: string | undefined,
) {
  const verify = ctx.services?.verifyChallenge;
  if (
    verify &&
    !(await verify({
      action,
      ...(token === undefined ? {} : { token }),
      actor: ctx.actor,
      eventId: ctx.eventId,
    }))
  )
    fail("Form verification failed.", 403);
}

export function limitWrites(
  db: QueryDatabase,
  key: string,
  limit: number,
  periodMs: number,
) {
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

export function migrateLimits(db: QueryDatabase) {
  db.exec(`CREATE TABLE IF NOT EXISTS engagement_limits (
    id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS engagement_limits_expiry ON engagement_limits(expires)`);
}

export function actorKey(ctx: Context, purpose: string) {
  if (!ctx.actor) fail("A participant identity is required.", 401);
  return ctx.fingerprint(`${purpose}:${ctx.actor}`);
}

export function mailer(ctx: Context) {
  if (typeof ctx.services?.sendMail !== "function")
    fail(
      "Configure a transactional mail sender before using this operation.",
      503,
    );
  return ctx.services.sendMail;
}
