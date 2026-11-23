import { strictJsonObject, jsonObject } from "../json-object.mjs";
import { randomBytes } from "node:crypto";
import { workflowResults } from "./workflow-results.mjs";

import * as v from "valibot";
import {
  defineOperation,
  type Context,
  type Role,
  type QueryDatabase,
} from "../contracts.mjs";

export const organizer: Role[] = ["organizer"];
export const anyone: Role[] = [
  "public",
  "organizer",
  "speaker",
  "staff",
  "moderator",
  "mc",
  "attendee",
];
export const word = (maxLength = 200) =>
  v.pipe(v.string(), v.minLength(1), v.maxCodePoints(maxLength), v.regex(/\S/));
export const text = (maxLength = 2000) =>
  v.pipe(v.string(), v.maxCodePoints(maxLength));
export const choice = <const T extends readonly [string, ...string[]]>(
  ...values: T
) => v.picklist(values);
export const bool = v.boolean();
export const id = word(150);
export const rev = v.pipe(v.number(), v.integer(), v.minValue(1));
export const email = v.pipe(
  v.string(),
  v.maxCodePoints(254),
  v.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
);
export const obj = strictJsonObject;
type OptionalFields<
  T extends v.ObjectEntries,
  K extends readonly [keyof T, ...(keyof T)[]],
> = ReturnType<typeof v.partial<v.StrictObjectSchema<T, undefined>, K>>;
export function withOptional<
  const T extends v.ObjectEntries,
  const K extends readonly [keyof T, ...(keyof T)[]],
>(
  entries: T,
  optional: K,
): ReturnType<typeof jsonObject<OptionalFields<T, K>>> {
  return jsonObject(v.partial(v.strictObject(entries), optional));
}
export const tokenField = v.pipe(
  word(160),
  v.description("Private invitation or staff access token."),
);
export function operation<
  const N extends keyof typeof workflowResults,
  S extends v.GenericSchema,
  R,
>(
  name: N,
  description: string,
  schema: S,
  example: v.InferInput<NoInfer<S>>,
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
    outputSchema: workflowResults[name],
  });
}
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export function changed(result: { changes: number | bigint }) {
  if (!result.changes)
    fail("The record changed or was removed. Reload it and try again.", 409);
}
export function dateValue(value: string) {
  // Require explicit zone so an organizer in another time zone sees the same deadline.
  if (
    !/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("Supply a date and time with a time zone.");
  return new Date(value).toISOString();
}
export const time = () => new Date().toISOString();
export const newToken = () => randomBytes(32).toString("base64url");
export const encode = (ctx: Context, value: unknown) =>
  ctx.seal(JSON.stringify(value));
export const decode = <T,>(ctx: Context, value: string): T =>
  JSON.parse(ctx.open(value)) as T;
export function invitation(ctx: Context, name: string, token: string) {
  const url = ctx.services?.actionUrl?.(name, { token }, ctx.eventId);
  return { token, ...(url ? { url } : {}) };
}
export function transaction<T>(db: QueryDatabase, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function csvArtifact(
  name: string,
  rows: readonly (readonly unknown[])[],
) {
  const cell = (value: unknown) => {
    const valueText = String(value ?? "");
    const safe = /^\s*[=+@-]|^[\r\n\t]/u.test(valueText)
      ? "'" + valueText
      : valueText;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  return {
    name,
    mimeType: "text/csv",
    bytes: new TextEncoder().encode(
      rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n",
    ),
  };
}
