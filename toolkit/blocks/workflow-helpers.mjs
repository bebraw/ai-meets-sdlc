import { randomBytes } from "node:crypto";
import { workflowResults } from "./workflow-results.mjs";

export const organizer = ["organizer"];
export const anyone = [
  "public",
  "organizer",
  "speaker",
  "staff",
  "moderator",
  "mc",
  "attendee",
];
export const word = (maxLength = 200) => ({
  type: "string",
  minLength: 1,
  maxLength,
  pattern: "\\S",
});
export const text = (maxLength = 2000) => ({ type: "string", maxLength });
export const choice = (...values) => ({ type: "string", enum: values });
export const bool = { type: "boolean" };
export const id = word(150);
export const rev = { type: "integer", minimum: 1 };
export const email = {
  type: "string",
  maxLength: 254,
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
};
export const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const tokenField = {
  ...word(160),
  description: "Private invitation or staff access token.",
};
export const operation = (
  name,
  description,
  inputSchema,
  example,
  roles,
  run,
) => ({
  name,
  description,
  inputSchema,
  outputSchema: workflowResults[name],
  example,
  roles,
  run,
});
export function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function changed(result) {
  if (!result.changes)
    fail("The record changed or was removed. Reload it and try again.", 409);
}
export function dateValue(value) {
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
export const encode = (ctx, value) => ctx.seal(JSON.stringify(value));
export const decode = (ctx, value) => JSON.parse(ctx.open(value));
export function invitation(ctx, name, token) {
  const url = ctx.services?.actionUrl?.(name, { token }, ctx.eventId);
  return { token, ...(url ? { url } : {}) };
}
export function transaction(db, work) {
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
export function csvArtifact(name, rows) {
  const cell = (value) => {
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
