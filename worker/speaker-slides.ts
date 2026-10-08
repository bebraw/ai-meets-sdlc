import { unzipSync } from "fflate";
import {
  maxSlideFileBytes,
  slideFormatFromFilename,
  type SlideFormat,
  type SpeakerSlideFile,
} from "../site/scripts/speaker-slides-model.ts";
import {
  isRecord,
  json,
  readJsonWithinLimit,
} from "./speaker-workspace-utils.ts";
import {
  readCanonicalSpeaker,
  workspaceOnlySpeakerIds,
} from "./canonical-content.ts";

interface SlideRow {
  slide_id: string;
  speaker_id: string;
  talk_id: string;
  format: SlideFormat;
  r2_key: string;
  filename: string;
  byte_size: number;
  content_hash: string;
  may_publish: number;
  published_at: string | null;
  uploaded_at: string;
}

const slideIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const publicSlidePattern =
  /^\/media\/talks\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([0-9a-f-]{36})\.pdf$/u;
const contentTypes = {
  pdf: "application/pdf",
  powerpoint:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

export async function handleSpeakerSlidesRequest(
  request: Request,
  env: Env,
  speakerId: string,
  talkIds: readonly string[],
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/speaker/slides") {
    if (request.method === "GET") {
      const slides = await readSlides(env);
      return json({
        slides: slides
          .filter((slide) => talkIds.includes(slide.talk_id))
          .map((slide) => serializeSlide(slide, false)),
      });
    }
    if (request.method === "POST") {
      return uploadSlides(request, env, speakerId, talkIds);
    }
    return methodNotAllowed("GET, POST");
  }

  const slideId = url.pathname.slice("/api/speaker/slides/".length);
  if (!slideIdPattern.test(slideId)) return notFound();
  const row = await readSlide(env, slideId);
  if (!row || !talkIds.includes(row.talk_id)) return notFound();
  if (request.method === "GET" || request.method === "HEAD") {
    return downloadSlide(request, env, row, false);
  }
  if (request.method === "DELETE") {
    const deleted = await env.INTERESTS.batch<SlideRow>([
      env.INTERESTS.prepare(
        `INSERT OR IGNORE INTO speaker_slide_garbage (r2_key, created_at)
         SELECT r2_key, ?2 FROM speaker_slides WHERE slide_id = ?1`,
      ).bind(slideId, new Date().toISOString()),
      env.INTERESTS.prepare(
        "DELETE FROM speaker_slides WHERE slide_id = ?1 RETURNING *",
      ).bind(slideId),
    ]);
    if (!deleted[1]?.results[0]) return staleSlides();
    await purgeDeletedSpeakerSlides(env);
    return json({
      message: "Slides removed. Any public link has been removed.",
    });
  }
  return methodNotAllowed("GET, HEAD, DELETE");
}

export async function readAdminSpeakerSlides(
  env: Env,
): Promise<Map<string, SpeakerSlideFile[]>> {
  const grouped = new Map<string, SpeakerSlideFile[]>();
  for (const row of await readSlides(env)) {
    const files = grouped.get(row.talk_id) ?? [];
    files.push(serializeSlide(row, true));
    grouped.set(row.talk_id, files);
  }
  return grouped;
}

export async function handleAdminSpeakerSlidesRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/admin/speakers/slides/publication") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await readJsonWithinLimit(request, 4096);
    if (body instanceof Response) return body;
    if (
      !isRecord(body) ||
      typeof body.slide_id !== "string" ||
      !slideIdPattern.test(body.slide_id) ||
      typeof body.published !== "boolean"
    ) {
      return json({ error: "Choose a PDF and its publication state." }, 400);
    }
    const row = await readSlide(env, body.slide_id);
    if (!row) return staleSlides();
    if (row.format !== "pdf") {
      return json({ error: "Only PDF slides can be published." }, 400);
    }
    if (body.published) {
      if (row.may_publish !== 1) {
        return json(
          { error: "The speaker has not allowed publication of this PDF." },
          403,
        );
      }
      const canonical = await readCanonicalSpeaker(env, row.speaker_id);
      if (
        !canonical ||
        workspaceOnlySpeakerIds.has(row.speaker_id) ||
        !canonical.content.talks.some(({ id }) => id === row.talk_id)
      ) {
        return json(
          { error: "Only slides for a public talk can be published." },
          400,
        );
      }
    }
    const updated = await env.INTERESTS.prepare(
      `UPDATE speaker_slides SET published_at = ?2
       WHERE slide_id = ?1 RETURNING *`,
    )
      .bind(row.slide_id, body.published ? new Date().toISOString() : null)
      .first<SlideRow>();
    if (!updated) return staleSlides();
    return json({
      message: body.published
        ? "PDF published on the schedule."
        : "PDF unpublished. The schedule link has been removed.",
      slide: serializeSlide(updated, true),
    });
  }
  const slideId = url.pathname.slice("/api/admin/speakers/slides/".length);
  if (!slideIdPattern.test(slideId)) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }
  const row = await readSlide(env, slideId);
  return row ? downloadSlide(request, env, row, false) : notFound();
}

export async function readPublishedSlideLinks(
  env: Env,
): Promise<Map<string, string>> {
  const result = await env.INTERESTS.prepare(
    `SELECT * FROM speaker_slides
     WHERE format = 'pdf' AND may_publish = 1 AND published_at IS NOT NULL`,
  ).all<SlideRow>();
  return new Map(
    result.results
      .filter((row) => !workspaceOnlySpeakerIds.has(row.speaker_id))
      .map((row) => [row.talk_id, publicSlideUrl(row)]),
  );
}

export async function servePublishedSlides(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const match = publicSlidePattern.exec(new URL(request.url).pathname);
  if (!match) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }
  const row = await readSlide(env, match[2]!);
  if (
    !row ||
    row.talk_id !== match[1] ||
    row.format !== "pdf" ||
    row.may_publish !== 1 ||
    !row.published_at ||
    workspaceOnlySpeakerIds.has(row.speaker_id)
  )
    return notFound();
  return downloadSlide(request, env, row, true);
}

async function uploadSlides(
  request: Request,
  env: Env,
  speakerId: string,
  talkIds: readonly string[],
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const talkId = params.get("talk_id") ?? "";
  const filename = (params.get("filename") ?? "").trim();
  const expectedSlideId = params.get("replaces_slide_id") ?? "";
  const permission = params.get("may_publish") ?? "0";
  if (!talkIds.includes(talkId)) {
    return json({ error: "Choose one of your assigned talks." }, 400);
  }
  if (
    !filename ||
    filename.length > 180 ||
    /[\x00-\x1f\x7f/\\]/u.test(filename) ||
    (expectedSlideId !== "" && !slideIdPattern.test(expectedSlideId)) ||
    !["0", "1"].includes(permission)
  )
    return json({ error: "Submit the slides upload form again." }, 400);
  const format = slideFormatFromFilename(filename);
  if (!format)
    return json({ error: "Choose a PDF or PowerPoint (.pptx) file." }, 400);
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (
    contentType !== contentTypes[format] &&
    contentType !== "application/octet-stream"
  ) {
    return json({ error: "Upload a PDF or PowerPoint (.pptx) file." }, 415);
  }
  const bytes = await readSlideBytes(request);
  if (bytes instanceof Response) return bytes;
  if (!validSlideFile(bytes, format)) {
    return json(
      {
        error:
          "The file is not a valid PDF or PowerPoint (.pptx) presentation.",
      },
      400,
    );
  }
  const slideId = crypto.randomUUID();
  const r2Key = `speaker-slides/${talkId}/${slideId}.${format === "pdf" ? "pdf" : "pptx"}`;
  const uploadedAt = new Date().toISOString();
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  await env.SPEAKER_UPLOADS.put(r2Key, bytes, {
    httpMetadata: { contentType: contentTypes[format] },
  });
  let saved = false;
  try {
    // The expected revision protects against another tab or co-speaker replacing
    // the same file. Garbage collection and replacement commit together in D1.
    const results = await env.INTERESTS.batch<SlideRow>([
      env.INTERESTS.prepare(
        `INSERT OR IGNORE INTO speaker_slide_garbage (r2_key, created_at)
         SELECT r2_key, ?4 FROM speaker_slides
         WHERE talk_id = ?1 AND format = ?2 AND slide_id = ?3`,
      ).bind(talkId, format, expectedSlideId, uploadedAt),
      env.INTERESTS.prepare(
        `INSERT INTO speaker_slides
         (slide_id, speaker_id, talk_id, format, r2_key, filename, byte_size,
          content_hash, may_publish, published_at, uploaded_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10
         WHERE ?11 = '' OR EXISTS (SELECT 1 FROM speaker_slides
           WHERE talk_id = ?3 AND format = ?4 AND slide_id = ?11)
         ON CONFLICT(talk_id, format) DO UPDATE SET
           slide_id = excluded.slide_id, speaker_id = excluded.speaker_id,
           r2_key = excluded.r2_key, filename = excluded.filename,
           byte_size = excluded.byte_size, content_hash = excluded.content_hash,
           may_publish = excluded.may_publish, published_at = NULL,
           uploaded_at = excluded.uploaded_at
         WHERE speaker_slides.slide_id = ?11
         RETURNING *`,
      ).bind(
        slideId,
        speakerId,
        talkId,
        format,
        r2Key,
        filename,
        bytes.byteLength,
        hash,
        format === "pdf" && permission === "1" ? 1 : 0,
        uploadedAt,
        expectedSlideId,
      ),
    ]);
    const row = results[1]?.results[0];
    if (!row) return staleSlides();
    saved = true;
    await purgeDeletedSpeakerSlides(env);
    return json(
      {
        message:
          "Slides uploaded privately. PDF publication is controlled by organizers.",
        slide: serializeSlide(row, false),
      },
      201,
    );
  } finally {
    if (!saved) await env.SPEAKER_UPLOADS.delete(r2Key);
  }
}

async function readSlides(env: Env): Promise<SlideRow[]> {
  const result = await env.INTERESTS.prepare(
    "SELECT * FROM speaker_slides ORDER BY talk_id, format",
  ).all<SlideRow>();
  return result.results;
}

async function readSlide(env: Env, slideId: string): Promise<SlideRow | null> {
  return env.INTERESTS.prepare(
    "SELECT * FROM speaker_slides WHERE slide_id = ?1",
  )
    .bind(slideId)
    .first<SlideRow>();
}

function publicSlideUrl(row: SlideRow): string {
  return `/media/talks/${row.talk_id}/${row.slide_id}.pdf`;
}

function serializeSlide(row: SlideRow, admin: boolean): SpeakerSlideFile {
  return {
    slide_id: row.slide_id,
    talk_id: row.talk_id,
    format: row.format,
    filename: row.filename,
    byte_size: row.byte_size,
    may_publish: row.may_publish === 1,
    published_at: row.published_at,
    uploaded_at: row.uploaded_at,
    download_url: `${admin ? "/api/admin/speakers" : "/api/speaker"}/slides/${row.slide_id}`,
    public_url: row.published_at ? publicSlideUrl(row) : null,
  };
}

async function downloadSlide(
  request: Request,
  env: Env,
  row: SlideRow,
  published: boolean,
): Promise<Response> {
  const metadata =
    request.method === "HEAD"
      ? await env.SPEAKER_UPLOADS.head(row.r2_key)
      : null;
  const object =
    request.method === "HEAD"
      ? null
      : await env.SPEAKER_UPLOADS.get(row.r2_key);
  const file = metadata ?? object;
  if (!file) {
    return new Response("Slides are temporarily unavailable.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  // Recheck publication after fetching storage so concurrent withdrawal cannot
  // serve a removed revision. Public responses never bypass this check via cache.
  if (published) {
    const current = await readSlide(env, row.slide_id);
    if (!current?.published_at || current.may_publish !== 1) {
      await object?.body.cancel();
      return notFound();
    }
  }
  return new Response(object?.body ?? null, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentTypes[row.format],
      "content-length": String(file.size),
      "content-disposition": `attachment; filename="slides.${row.format === "pdf" ? "pdf" : "pptx"}"; filename*=UTF-8''${encodeURIComponent(row.filename).replaceAll("'", "%27")}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
    },
  });
}

export async function purgeDeletedSpeakerSlides(env: Env): Promise<void> {
  const result = await env.INTERESTS.prepare(
    "SELECT r2_key FROM speaker_slide_garbage ORDER BY created_at LIMIT 100",
  ).all<{ r2_key: string }>();
  for (const { r2_key: key } of result.results) {
    try {
      await env.SPEAKER_UPLOADS.delete(key);
      await env.INTERESTS.prepare(
        "DELETE FROM speaker_slide_garbage WHERE r2_key = ?1",
      )
        .bind(key)
        .run();
    } catch {
      console.error(
        JSON.stringify({ message: "Slide file removal will be retried", key }),
      );
    }
  }
}

async function readSlideBytes(
  request: Request,
): Promise<Uint8Array<ArrayBuffer> | Response> {
  const length = request.headers.get("content-length");
  if (
    length &&
    (!/^\d+$/u.test(length) || Number(length) > maxSlideFileBytes)
  ) {
    return json({ error: "Slides must be 25 MB or smaller." }, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Choose a presentation file." }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSlideFileBytes) {
        await reader.cancel();
        return json({ error: "Slides must be 25 MB or smaller." }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "The upload was interrupted. Try again." }, 400);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function validSlideFile(bytes: Uint8Array, format: SlideFormat): boolean {
  if (format === "pdf") {
    return (
      /^%PDF-1\.[0-9]|^%PDF-2\.0/u.test(
        new TextDecoder().decode(bytes.subarray(0, 8)),
      ) &&
      new TextDecoder()
        .decode(bytes.subarray(Math.max(0, bytes.length - 1024)))
        .includes("%%EOF")
    );
  }
  try {
    const files = unzipSync(bytes, {
      filter: ({ name, originalSize }) =>
        ["[Content_Types].xml", "ppt/presentation.xml"].includes(name) &&
        originalSize > 0 &&
        originalSize <= 512 * 1024,
    });
    const types = files["[Content_Types].xml"];
    const presentation = files["ppt/presentation.xml"];
    return Boolean(
      types &&
      presentation &&
      new TextDecoder()
        .decode(types)
        .includes(
          "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
        ) &&
      new TextDecoder().decode(presentation).includes("presentation"),
    );
  } catch {
    return false;
  }
}

function notFound(): Response {
  return new Response("Slides not found.", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function staleSlides(): Response {
  return json(
    {
      error:
        "These slides changed. Reload to review the latest file before trying again.",
    },
    409,
  );
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method not allowed.", {
    status: 405,
    headers: { allow, "cache-control": "no-store" },
  });
}
