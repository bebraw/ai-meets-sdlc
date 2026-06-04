import {
  normalizeInteger,
  normalizeOptionalText,
  normalizePositiveInteger,
  normalizeScheduleDate,
  normalizeScheduleEntryType,
} from "../utils/normalize";
import { jsonResponse } from "../utils/response";

export async function handleAdminScheduleMutation(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Schedule storage is not configured" }, 503);
  }

  const formData = await request.formData();
  const action = normalizeOptionalText(formData.get("action"), 20);
  const id = normalizePositiveInteger(formData.get("id"), 999999999);

  if (action === "delete") {
    if (!id) return jsonResponse({ error: "Choose a schedule entry" }, 400);

    await env.INTERESTS.prepare("DELETE FROM schedule_entries WHERE id = ?")
      .bind(id)
      .run();

    return jsonResponse({ ok: true, deleted_id: id });
  }

  const startsAt = normalizeScheduleDate(formData.get("starts_at"));
  const endsAt = normalizeScheduleDate(formData.get("ends_at"));
  const entryType = normalizeScheduleEntryType(formData.get("entry_type"));
  const title = normalizeOptionalText(formData.get("title"), 180);
  const presenter = normalizeOptionalText(formData.get("presenter"), 160);
  const organization = normalizeOptionalText(formData.get("organization"), 160);
  const description = normalizeOptionalText(formData.get("description"), 1200);
  const location = normalizeOptionalText(formData.get("location"), 160);
  const cfpProposalId = normalizePositiveInteger(
    formData.get("cfp_proposal_id"),
    999999999,
  );
  const sortOrder = normalizeInteger(formData.get("sort_order"), 0, 9999);
  const isPublished = formData.get("is_published") === "yes" ? 1 : 0;

  if (!startsAt) {
    return jsonResponse({ error: "Enter a valid start time" }, 400);
  }

  if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    return jsonResponse({ error: "End time must be after start time" }, 400);
  }

  if (!entryType) {
    return jsonResponse({ error: "Choose an entry type" }, 400);
  }

  if (!title) {
    return jsonResponse({ error: "Enter a schedule title" }, 400);
  }

  if (cfpProposalId) {
    const cfpProposal = await env.INTERESTS.prepare(
      "SELECT id FROM cfp_proposals WHERE id = ?",
    )
      .bind(cfpProposalId)
      .first<{ id: number }>();

    if (!cfpProposal) {
      return jsonResponse(
        { error: "Selected CFP proposal was not found" },
        400,
      );
    }
  }

  const now = new Date().toISOString();

  if (id) {
    const result = await env.INTERESTS.prepare(
      `UPDATE schedule_entries
      SET
        starts_at = ?,
        ends_at = ?,
        entry_type = ?,
        title = ?,
        presenter = ?,
        organization = ?,
        description = ?,
        location = ?,
        cfp_proposal_id = ?,
        is_published = ?,
        sort_order = ?,
        updated_at = ?
      WHERE id = ?`,
    )
      .bind(
        startsAt,
        endsAt || null,
        entryType,
        title,
        presenter || null,
        organization || null,
        description || null,
        location || null,
        cfpProposalId || null,
        isPublished,
        sortOrder,
        now,
        id,
      )
      .run();

    if (result.meta.changes !== 1) {
      return jsonResponse({ error: "Schedule entry was not found" }, 404);
    }
  } else {
    await env.INTERESTS.prepare(
      `INSERT INTO schedule_entries (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        startsAt,
        endsAt || null,
        entryType,
        title,
        presenter || null,
        organization || null,
        description || null,
        location || null,
        cfpProposalId || null,
        isPublished,
        sortOrder,
        now,
        now,
      )
      .run();
  }

  return jsonResponse({ ok: true });
}
