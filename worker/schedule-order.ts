import seed from "../site/data/schedule.json" with { type: "json" };
import * as v from "valibot";
import { withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  getCanonicalTalks,
  readPublicCanonicalSpeakers,
} from "./canonical-content.ts";
import {
  jsonResponse,
  readFormDataWithinLimit,
  requireAdminAction,
  sha256Hex,
} from "./form-utils.ts";

const scheduleGroupsSchema = v.array(
  v.object({ id: v.string(), talkIds: v.array(v.string()) }),
);
export type ScheduleGroup = v.InferOutput<typeof scheduleGroupsSchema>[number];
export interface ScheduleOrder {
  groups: ScheduleGroup[];
  revision: number;
  updatedAt: string;
}
export const scheduleSessions = seed.items.filter((item) => "talks" in item);
export const seedGroups: ScheduleGroup[] = scheduleSessions.map((item) => ({
  id: item.id,
  talkIds: (item.talks ?? []).map((talk) => talk.id),
}));

export function parseScheduleGroups(value: unknown): ScheduleGroup[] | null {
  const parsed = v.safeParse(scheduleGroupsSchema, value);
  if (!parsed.success || parsed.output.length !== seedGroups.length)
    return null;
  const expectedTalks = new Set(seedGroups.flatMap((group) => group.talkIds));
  const seen = new Set<string>();
  for (const [index, group] of parsed.output.entries()) {
    if (group.id !== seedGroups[index]?.id) return null;
    for (const id of group.talkIds) {
      if (!expectedTalks.has(id) || seen.has(id)) return null;
      seen.add(id);
    }
  }
  return seen.size === expectedTalks.size ? parsed.output : null;
}

export async function readScheduleOrder(env: Env): Promise<ScheduleOrder> {
  const row = await env.INTERESTS.prepare(
    "SELECT groups_json, revision, updated_at FROM schedule_order WHERE id = 1",
  ).first<{ groups_json: string; revision: number; updated_at: string }>();
  if (!row) throw new Error("Missing schedule order");
  const groups = parseScheduleGroups(JSON.parse(row.groups_json));
  if (!groups || !Number.isSafeInteger(row.revision) || row.revision < 1)
    throw new Error("Invalid schedule order");
  return { groups, revision: row.revision, updatedAt: row.updated_at };
}

export function scheduleSlideIds(order: ScheduleOrder): string[] {
  const groups = new Map(
    order.groups.map((group) => [group.id, group.talkIds]),
  );
  return [
    "event",
    ...seed.items.flatMap((item) => [
      `session-${item.id}`,
      ...(groups.get(item.id) ?? []).map((id) => `talk-${id}`),
    ]),
  ];
}

export async function withScheduleVersion(
  version: string,
  order: ScheduleOrder,
): Promise<string> {
  return sha256Hex(`${version}:${JSON.stringify(order.groups)}`);
}

export async function handleScheduleOrder(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await handle(request, env));
  } catch {
    console.error("schedule_order_unavailable");
    return withAdminSecurityHeaders(
      jsonResponse(
        {
          error:
            "Schedule is temporarily unavailable. Your draft has not been saved.",
        },
        503,
      ),
    );
  }
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const [order, records] = await Promise.all([
      readScheduleOrder(env),
      readPublicCanonicalSpeakers(env),
    ]);
    const talks = getCanonicalTalks(records);
    return jsonResponse({
      ...order,
      sessions: scheduleSessions.map(({ id, title, time }) => ({
        id,
        title,
        time,
      })),
      talks: [...talks].map(([id, talk]) => ({
        id,
        title: talk.title,
        speakers: records
          .filter((record) =>
            record.content.talks.some((item) => item.id === id),
          )
          .map((record) => record.content.profile.name)
          .join(", "),
      })),
    });
  }
  if (request.method !== "PUT")
    return jsonResponse({ error: "Method not allowed." }, 405, {
      allow: "GET, PUT",
    });
  const forbidden = requireAdminAction(request, "save-schedule-order");
  if (forbidden) return forbidden;
  const form = await readFormDataWithinLimit(request, 32 * 1024);
  if (form instanceof Response) return form;
  let submittedGroups: unknown;
  try {
    submittedGroups = JSON.parse(String(form.get("groups")));
  } catch {
    return jsonResponse({ error: "Invalid schedule." }, 400);
  }
  const groups = parseScheduleGroups(submittedGroups);
  const revision = Number(form.get("revision"));
  if (!groups || !Number.isSafeInteger(revision) || revision < 1) {
    return jsonResponse(
      {
        error:
          "Each scheduled talk must appear exactly once in an existing session.",
      },
      400,
    );
  }
  const updatedAt = new Date().toISOString();
  const result = await env.INTERESTS.prepare(
    "UPDATE schedule_order SET groups_json = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?",
  )
    .bind(JSON.stringify(groups), updatedAt, revision)
    .run();
  if (!result.meta.changes)
    return jsonResponse(
      {
        error:
          "The schedule was changed in another tab. Your draft is still here. Reload the published schedule before making further changes.",
      },
      409,
    );
  return jsonResponse({ groups, revision: revision + 1, updatedAt });
}
