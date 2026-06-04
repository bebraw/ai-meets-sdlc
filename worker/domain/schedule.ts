import type { ScheduleEntryRow } from "../types";

export async function getAdminScheduleEntries(env: Env) {
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
    ORDER BY starts_at ASC, sort_order ASC, id ASC`,
  ).all<ScheduleEntryRow>();

  return (entries.results ?? []).map(serializeScheduleEntry);
}

export function serializeScheduleEntry(row: ScheduleEntryRow) {
  return {
    cfp_proposal_id: row.cfp_proposal_id,
    created_at: row.created_at,
    description: row.description,
    ends_at: row.ends_at,
    entry_type: row.entry_type,
    id: row.id,
    is_published: row.is_published === 1,
    location: row.location,
    organization: row.organization,
    presenter: row.presenter,
    sort_order: row.sort_order,
    starts_at: row.starts_at,
    title: row.title,
    updated_at: row.updated_at,
  };
}

export function serializePublicScheduleEntry(row: ScheduleEntryRow) {
  return {
    description: row.description,
    ends_at: row.ends_at,
    entry_type: row.entry_type,
    location: row.location,
    organization: row.organization,
    presenter: row.presenter,
    starts_at: row.starts_at,
    title: row.title,
  };
}
