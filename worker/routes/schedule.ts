import type { ScheduleEntryRow } from "../types";
import { serializePublicScheduleEntry } from "../domain/schedule";
import { jsonResponse } from "../utils/response";

export async function handlePublicSchedule(env: Env): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Schedule storage is not configured" }, 503);
  }

  const entries = await env.INTERESTS.prepare(
    `SELECT
      id,
      starts_at,
      ends_at,
      entry_type,
      title,
      presenter,
      organization,
      description,
      location,
      cfp_proposal_id,
      is_published,
      sort_order,
      created_at,
      updated_at
    FROM schedule_entries
    WHERE is_published = 1
    ORDER BY starts_at ASC, sort_order ASC, id ASC`,
  ).all<ScheduleEntryRow>();

  return jsonResponse({
    ok: true,
    entries: (entries.results ?? []).map(serializePublicScheduleEntry),
  });
}
