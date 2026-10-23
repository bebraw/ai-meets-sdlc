import * as v from "valibot";
import { withAdminSecurityHeaders } from "./admin-auth.ts";
import { jsonResponse, requireAdminAction } from "./form-utils.ts";
import {
  parseHttpsUrl,
  readJsonWithinLimit,
} from "./speaker-workspace-utils.ts";
import type { PublicationItem } from "../site/scripts/publication-model.ts";

const eventId = "2026";
const statusSchema = v.picklist([
  "draft",
  "review",
  "ready",
  "scheduled",
  "published",
]);
const formatSchema = v.picklist(["portrait", "landscape"]);
const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const nonempty = (max: number) =>
  v.pipe(
    text(max),
    v.check((value) => Boolean(value.trim())),
  );
const updateSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[a-z][a-z0-9-]{0,79}$/u)),
  revision: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(1),
    v.maxValue(Number.MAX_SAFE_INTEGER - 1),
  ),
  title: nonempty(300),
  subtitle: text(1200),
  summary: text(1200),
  body: nonempty(20000),
  altText: text(2000),
  notes: text(4000),
  status: statusSchema,
  publicationDate: text(10),
  publicationUrl: text(2048),
  graphicFormat: formatSchema,
});
const assetsSchema = v.array(
  v.object({
    format: formatSchema,
    url: v.string(),
    width: v.number(),
    height: v.number(),
  }),
);
const sourcesSchema = v.array(v.object({ label: v.string(), url: v.string() }));
interface Row {
  id: string;
  event_id: string;
  channel: PublicationItem["channel"];
  position: number;
  title: string;
  subtitle: string;
  summary: string;
  body: string;
  alt_text: string;
  notes: string;
  status: PublicationItem["status"];
  publication_date: string;
  publication_url: string;
  graphic_format: PublicationItem["graphicFormat"];
  revision: number;
  updated_at: string | null;
  assets_json: string;
  sources_json: string;
}

function item(row: Row): PublicationItem {
  return {
    id: row.id,
    eventId: row.event_id,
    channel: row.channel,
    position: row.position,
    title: row.title,
    subtitle: row.subtitle,
    summary: row.summary,
    body: row.body,
    altText: row.alt_text,
    notes: row.notes,
    status: row.status,
    publicationDate: row.publication_date,
    publicationUrl: row.publication_url,
    graphicFormat: row.graphic_format,
    revision: row.revision,
    updatedAt: row.updated_at,
    assets: v.parse(assetsSchema, JSON.parse(row.assets_json)),
    sources: v.parse(sourcesSchema, JSON.parse(row.sources_json)),
  };
}

// The shared admin guard in index.ts runs before this handler.
export async function handlePublicationQueue(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await handle(request, env));
  } catch {
    console.error("publication_queue_request_failed");
    return withAdminSecurityHeaders(
      jsonResponse(
        {
          error:
            "The publication queue is temporarily unavailable. Please try again.",
        },
        503,
      ),
    );
  }
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.searchParams.has("event") &&
    url.searchParams.get("event") !== eventId
  )
    return jsonResponse({ error: "Event not found." }, 404);
  if (!env.INTERESTS)
    return jsonResponse({ error: "Publication storage is unavailable." }, 503);
  if (request.method === "GET") {
    const { results } = await env.INTERESTS.prepare(
      "SELECT * FROM publication_queue WHERE event_id = ? ORDER BY position, id",
    )
      .bind(eventId)
      .all<Row>();
    return jsonResponse({ eventId, items: results.map(item) });
  }
  if (request.method !== "PUT")
    return jsonResponse({ error: "Method not allowed." }, 405, {
      allow: "GET, PUT",
    });
  const denied = requireAdminAction(request, "manage-publications");
  if (denied) return denied;
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    return jsonResponse({ error: "Send the draft as JSON." }, 415);
  const body = await readJsonWithinLimit(request, 64 * 1024);
  if (body instanceof Response) return body;
  const parsed = v.safeParse(updateSchema, body);
  if (!parsed.success)
    return jsonResponse(
      {
        error: "Check the draft fields and reload if its revision is missing.",
      },
      400,
    );
  const data = parsed.output;
  if (
    data.publicationDate &&
    (!/^\d{4}-\d{2}-\d{2}$/u.test(data.publicationDate) ||
      !Number.isFinite(Date.parse(data.publicationDate)) ||
      new Date(data.publicationDate).toISOString().slice(0, 10) !==
        data.publicationDate)
  )
    return jsonResponse({ error: "Choose a valid publication date." }, 400);
  if (data.publicationUrl && !parseHttpsUrl(data.publicationUrl))
    return jsonResponse(
      {
        error:
          "Use a complete HTTPS publication URL without embedded credentials.",
      },
      400,
    );
  if (["scheduled", "published"].includes(data.status) && !data.publicationDate)
    return jsonResponse(
      { error: "Add the publication date for a scheduled or published item." },
      400,
    );
  const previous = await env.INTERESTS.prepare(
    "SELECT * FROM publication_queue WHERE event_id = ? AND id = ?",
  )
    .bind(eventId, data.id)
    .first<Row>();
  if (!previous) return jsonResponse({ error: "Draft not found." }, 404);
  if (
    data.status === "published" &&
    previous.channel !== "newsletter" &&
    !data.publicationUrl
  )
    return jsonResponse({ error: "Add the published post URL." }, 400);
  const updated = await env.INTERESTS.prepare(
    `UPDATE publication_queue SET
    title = ?1, subtitle = ?2, summary = ?3, body = ?4, alt_text = ?5, notes = ?6,
    status = ?7, publication_date = ?8, publication_url = ?9, graphic_format = ?10,
    revision = revision + 1, updated_at = ?11
    WHERE event_id = ?12 AND id = ?13 AND revision = ?14 RETURNING *`,
  )
    .bind(
      data.title,
      data.subtitle,
      data.summary,
      data.body,
      data.altText,
      data.notes,
      data.status,
      data.publicationDate,
      data.publicationUrl,
      data.graphicFormat,
      new Date().toISOString(),
      eventId,
      data.id,
      data.revision,
    )
    .first<Row>();
  if (!updated) {
    const current = await env.INTERESTS.prepare(
      "SELECT * FROM publication_queue WHERE event_id = ? AND id = ?",
    )
      .bind(eventId, data.id)
      .first<Row>();
    return jsonResponse(
      {
        error:
          "This draft has a newer saved version. Your edits have been kept here. Compare the saved version before continuing.",
        current: current ? item(current) : null,
      },
      409,
    );
  }
  return jsonResponse({ item: item(updated) });
}
