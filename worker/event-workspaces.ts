import * as v from "valibot";
import { eventPath, isEventPath } from "../shared/event-paths.ts";

const bindingName = v.pipe(v.string(), v.regex(/^[A-Z][A-Z0-9_]*$/u));
const settingNames = [
  "SPEAKER_REVIEW_DIGEST_ENABLED",
  "POSTER_REVIEW_DIGEST_ENABLED",
  "DATA_CHANGE_DIGEST_ENABLED",
  "POSTER_PROPOSAL_DEADLINE",
  "SPEAKER_DINNER_RESPONSE_DEADLINE",
  "SPEAKER_DINNER_RETENTION_UNTIL",
  "SPEAKER_WORKSPACE_ACCESS_UNTIL",
  "SPEAKER_CONTACT_RETENTION_UNTIL",
  "SPEAKER_VIDEO_RETENTION_UNTIL",
  "SHOW_INTEREST_FORM",
] as const;
const settingsSchema = v.record(v.picklist(settingNames), v.string());
const schema = v.array(
  v.object({
    id: v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
    label: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
    database: bindingName,
    uploads: bindingName,
    exports: bindingName,
    backups: bindingName,
    settings: v.optional(settingsSchema),
  }),
);
export type EventWorkspace = v.InferOutput<typeof schema>[number];
export const legacyEvent: EventWorkspace = {
  id: "2026",
  label: "SDLCAI 2026",
  database: "INTERESTS",
  uploads: "SPEAKER_UPLOADS",
  exports: "SOCIAL_EXPORTS",
  backups: "INTEREST_BACKUPS",
};

// These environments are created per request/job. Never mutate the platform Env.
const eventContext = Symbol("event-workspace-context");
type ScopedEnv = Env & {
  [eventContext]?: { event: EventWorkspace; shared: Env };
};
export const currentEvent = (env: Env): EventWorkspace =>
  (env as ScopedEnv)[eventContext]?.event ?? legacyEvent;
export const sharedEnvironment = (env: Env): Env =>
  (env as ScopedEnv)[eventContext]?.shared ?? env;
export const eventLink = (path: string, env: Env): string =>
  currentEvent(env).id === "2026"
    ? path
    : eventPath(path, currentEvent(env).id);

export function eventWorkspaces(env: Env): EventWorkspace[] {
  const events = v.parse(
    schema,
    JSON.parse(env.EVENT_WORKSPACES || JSON.stringify([legacyEvent])),
  );
  const ids = new Set<string>();
  const resources = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id)) throw new Error("Duplicate event identifier");
    ids.add(event.id);
    for (const key of ["database", "uploads", "exports", "backups"] as const) {
      const name = event[key];
      // Legacy resources cannot be reassigned through an alternative binding role.
      if (
        (event.id !== "2026" && Object.values(legacyEvent).includes(name)) ||
        resources.has(name)
      )
        throw new Error(
          "Events must have distinct database and storage bindings",
        );
      resources.add(name);
    }
    if (event.id === "2026") {
      if (
        ["database", "uploads", "exports", "backups"].some(
          (key) => Reflect.get(event, key) !== Reflect.get(legacyEvent, key),
        )
      )
        throw new Error("The legacy event bindings cannot be reassigned");
    }
  }
  if (!ids.has("2026"))
    throw new Error("The legacy event must remain configured");
  return events;
}

export async function eventEnvironment(
  root: Env,
  event: EventWorkspace,
): Promise<Env> {
  const env: Env = Object.assign({}, root);
  for (const [target, source] of Object.entries({
    INTERESTS: event.database,
    SPEAKER_UPLOADS: event.uploads,
    SOCIAL_EXPORTS: event.exports,
    INTEREST_BACKUPS: event.backups,
  })) {
    const value: unknown = Reflect.get(root, source);
    if (
      !value ||
      typeof value !== "object" ||
      typeof Reflect.get(value, target === "INTERESTS" ? "prepare" : "get") !==
        "function"
    )
      throw new Error(`Missing event binding: ${source}`);
    Reflect.set(env, target, value);
  }
  if (event.id !== "2026") {
    // A future edition must explicitly introduce its own deadlines and email jobs.
    for (const key of settingNames)
      Reflect.set(env, key, key.endsWith("ENABLED") ? "false" : "");
  }
  for (const [key, value] of Object.entries(event.settings ?? {}))
    Reflect.set(env, key, value);
  const dataset = await env.INTERESTS.prepare(
    "SELECT event_id FROM event_dataset WHERE id = 1",
  ).first<{ event_id: string }>();
  if (dataset?.event_id !== event.id)
    throw new Error("The database belongs to a different event");
  Object.defineProperty(env, eventContext, { value: { event, shared: root } });
  return env;
}

// Only these workspaces have edition-independent templates. Other tools require
// a deliberate edition content adapter, rather than falling back to 2026 assets.
const portable =
  /^(?:\/admin\/(?:attendees|badges|organizers|volunteers|activity|interests|posters|attendee-messages|qa)\/?|\/api\/admin\/(?:attendees|badges|organizers|volunteers|change-history|activity|interests(?:\.csv)?|poster-proposals(?:\.csv)?|attendee-messages|qa)(?:\/.*)?|\/registration(?:\/.*)?|\/api\/registration(?:\/.*)?|\/qa(?:\/.*)?|\/api\/qa(?:\/.*)?|\/event-email\/.*|\/api\/attendee-messages\/.*)$/u;
export function eventRouteAvailable(
  path: string,
  event: EventWorkspace,
): boolean {
  return (
    event.id === "2026" ||
    path === "/admin/" ||
    !isEventPath(path) ||
    portable.test(path)
  );
}

export function scopeUrl(
  value: string,
  event: EventWorkspace,
  origin: string,
): string {
  if (!value.startsWith("/") && !value.startsWith(origin + "/")) return value;
  const url = new URL(value, origin);
  if (url.origin !== origin || !isEventPath(url.pathname)) return value;
  url.pathname = eventPath(url.pathname, event.id);
  return value.startsWith("/")
    ? url.pathname + url.search + url.hash
    : url.href;
}
