import { unzipSync } from "fflate";
import { createHash } from "node:crypto";
import {
  maxSlideFileBytes,
  slideContentTypes,
  slideFormatFromFilename,
  type SlideFormat,
  type SpeakerSlideFile,
  type SpeakerSlideLink,
  type SpeakerRecordingLink,
  type PublishedSlideLink,
} from "../site/scripts/speaker-slides-model.ts";
import {
  isRecord,
  json,
  readJsonWithinLimit,
  parseHttpsUrl,
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
const contentTypes = slideContentTypes;

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
    return removeSlide(env, slideId);
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
  if (url.pathname === "/api/admin/speakers/slides/upload") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const speakerId = url.searchParams.get("speaker_id") ?? "";
    const canonical = await readCanonicalSpeaker(env, speakerId);
    if (!canonical)
      return json({ error: "Choose a speaker before uploading slides." }, 400);
    return uploadSlides(
      request,
      env,
      speakerId,
      canonical.content.talks.map(({ id }) => id),
      true,
    );
  }
  if (url.pathname === "/api/admin/speakers/slides/links") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return saveAdminTalkLink(request, env, "slide");
  }
  if (url.pathname === "/api/admin/speakers/slides/recordings") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    return saveAdminTalkLink(request, env, "recording");
  }
  if (url.pathname === "/api/admin/speakers/slides/publication") {
    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await readJsonWithinLimit(request, 4096);
    if (body instanceof Response) return body;
    if (
      !isRecord(body) ||
      typeof body.slide_id !== "string" ||
      !slideIdPattern.test(body.slide_id) ||
      typeof body.published !== "boolean" ||
      (body.permission_confirmed !== undefined &&
        typeof body.permission_confirmed !== "boolean")
    ) {
      return json({ error: "Choose a PDF and its publication state." }, 400);
    }
    const row = await readSlide(env, body.slide_id);
    if (!row) return staleSlides();
    if (row.format !== "pdf") {
      return json({ error: "Only PDF slides can be published." }, 400);
    }
    if (body.published) {
      if (row.may_publish !== 1 && body.permission_confirmed !== true) {
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
      `UPDATE speaker_slides SET published_at = ?2,
         may_publish = CASE WHEN ?3 = 1 THEN 1 ELSE may_publish END
       WHERE slide_id = ?1 RETURNING *`,
    )
      .bind(
        row.slide_id,
        body.published ? new Date().toISOString() : null,
        body.published && body.permission_confirmed === true ? 1 : 0,
      )
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
  const row = await readSlide(env, slideId);
  if (!row) return notFound();
  if (request.method === "DELETE") return removeSlide(env, slideId);
  if (request.method === "GET" || request.method === "HEAD")
    return downloadSlide(request, env, row, false);
  return methodNotAllowed("GET, HEAD, DELETE");
}

async function removeSlide(env: Env, slideId: string): Promise<Response> {
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
  return json({ message: "Slides removed. Any public link has been removed." });
}

export async function readPublishedSlideLinks(
  env: Env,
): Promise<Map<string, PublishedSlideLink[]>> {
  const [files, links, recordings] = await Promise.all([
    env.INTERESTS.prepare(
      `SELECT * FROM speaker_slides
       WHERE format = 'pdf' AND may_publish = 1 AND published_at IS NOT NULL`,
    ).all<SlideRow>(),
    env.INTERESTS.prepare("SELECT * FROM speaker_slide_links").all<
      SpeakerSlideLink & { speaker_id: string }
    >(),
    env.INTERESTS.prepare("SELECT * FROM speaker_recording_links").all<
      SpeakerRecordingLink & { speaker_id: string }
    >(),
  ]);
  const published = new Map<string, PublishedSlideLink[]>();
  for (const row of files.results) {
    if (!workspaceOnlySpeakerIds.has(row.speaker_id))
      published.set(row.talk_id, [
        { url: publicSlideUrl(row), label: "Slides (PDF)" },
      ]);
  }
  for (const link of links.results) {
    if (
      workspaceOnlySpeakerIds.has(link.speaker_id) ||
      !parseHttpsUrl(link.url)
    )
      continue;
    const materials = published.get(link.talk_id) ?? [];
    materials.push({
      url: link.url,
      label: link.kind === "resource" ? "Related resource" : "Presentation",
    });
    published.set(link.talk_id, materials);
  }
  for (const link of recordings.results) {
    if (
      workspaceOnlySpeakerIds.has(link.speaker_id) ||
      !parseHttpsUrl(link.url)
    )
      continue;
    const materials = published.get(link.talk_id) ?? [];
    materials.push({ url: link.url, label: "Watch talk" });
    published.set(link.talk_id, materials);
  }
  return published;
}

export async function readAdminSpeakerSlideLinks(
  env: Env,
): Promise<Map<string, SpeakerSlideLink>> {
  const result = await env.INTERESTS.prepare(
    "SELECT talk_id, url, kind FROM speaker_slide_links ORDER BY talk_id",
  ).all<SpeakerSlideLink>();
  return new Map(result.results.map((link) => [link.talk_id, link]));
}

export async function readAdminSpeakerRecordingLinks(
  env: Env,
): Promise<Map<string, SpeakerRecordingLink>> {
  const result = await env.INTERESTS.prepare(
    "SELECT talk_id, url FROM speaker_recording_links ORDER BY talk_id",
  ).all<SpeakerRecordingLink>();
  return new Map(result.results.map((link) => [link.talk_id, link]));
}

async function saveAdminTalkLink(
  request: Request,
  env: Env,
  type: "slide" | "recording",
): Promise<Response> {
  const table =
    type === "slide" ? "speaker_slide_links" : "speaker_recording_links";
  const body = await readJsonWithinLimit(request, 16 * 1024);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    typeof body.speaker_id !== "string" ||
    typeof body.talk_id !== "string" ||
    typeof body.url !== "string" ||
    !(body.previous_url === null || typeof body.previous_url === "string")
  )
    return json({ error: `Submit the ${type} link form again.` }, 400);

  const kind = body.kind ?? "presentation";
  const previousKind = body.previous_kind ?? "presentation";
  if (
    type === "slide" &&
    (typeof kind !== "string" ||
      typeof previousKind !== "string" ||
      !["presentation", "resource"].includes(kind) ||
      !["presentation", "resource"].includes(previousKind))
  )
    return json({ error: "Choose a presentation or related resource." }, 400);

  const canonical = await readCanonicalSpeaker(env, body.speaker_id);
  if (
    !canonical ||
    workspaceOnlySpeakerIds.has(body.speaker_id) ||
    !canonical.content.talks.some(({ id }) => id === body.talk_id)
  )
    return json({ error: "Choose one of this speaker's public talks." }, 400);

  const value = body.url.trim();
  const parsed = parseHttpsUrl(value);
  if (
    value &&
    (!parsed || value.length > 2048 || /[\x00-\x1f\x7f]/u.test(value))
  )
    return json(
      { error: `Enter a complete HTTPS ${type} URL, up to 2,048 characters.` },
      400,
    );

  const linkUrl = parsed?.toString() ?? "";
  const updatedAt = new Date().toISOString();
  const kindCondition = type === "slide" ? " AND kind = ?3" : "";
  const previousValues =
    type === "slide"
      ? [body.talk_id, body.previous_url, previousKind]
      : [body.talk_id, body.previous_url];
  // Compare the saved URL in the write itself so concurrent tabs cannot silently
  // replace or remove a link that has changed since their form was loaded.
  const statement = !linkUrl
    ? env.INTERESTS.prepare(
        `DELETE FROM ${table} WHERE talk_id = ?1 AND url = ?2${kindCondition} RETURNING talk_id`,
      ).bind(...previousValues)
    : body.previous_url === null
      ? env.INTERESTS.prepare(
          `INSERT INTO ${table} (talk_id, speaker_id, url, updated_at${type === "slide" ? ", kind" : ""})
           VALUES (?1, ?2, ?3, ?4${type === "slide" ? ", ?5" : ""})
           ON CONFLICT(talk_id) DO NOTHING RETURNING talk_id`,
        ).bind(
          body.talk_id,
          body.speaker_id,
          linkUrl,
          updatedAt,
          ...(type === "slide" ? [kind] : []),
        )
      : env.INTERESTS.prepare(
          `UPDATE ${table} SET speaker_id = ?2, url = ?3, updated_at = ?4${type === "slide" ? ", kind = ?6" : ""}
           WHERE talk_id = ?1 AND url = ?5${type === "slide" ? " AND kind = ?7" : ""} RETURNING talk_id`,
        ).bind(
          body.talk_id,
          body.speaker_id,
          linkUrl,
          updatedAt,
          body.previous_url,
          ...(type === "slide" ? [kind, previousKind] : []),
        );
  if (!(await statement.first()))
    return json(
      {
        error: `The ${type} link changed. Reload speakers before saving again.`,
      },
      409,
    );
  return json({
    message: linkUrl
      ? `${type === "slide" ? "Slide" : "Recording"} link published on the schedule.`
      : `${type === "slide" ? "Slide" : "Recording"} link removed from the schedule.`,
  });
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
  admin = false,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const talkId = params.get("talk_id") ?? "";
  const filename = (params.get("filename") ?? "").trim();
  const expectedSlideId = params.get("replaces_slide_id") ?? "";
  const permission = params.get("may_publish") ?? "0";
  if (!talkIds.includes(talkId)) {
    return json({ error: "Choose one of this speaker's assigned talks." }, 400);
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
  if (!format || (!admin && format === "html"))
    return json(
      {
        error: admin
          ? "Choose a PDF, PowerPoint (.pptx), or HTML file."
          : "Choose a PDF or PowerPoint (.pptx) file.",
      },
      400,
    );
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (
    contentType !== contentTypes[format] &&
    contentType !== "application/octet-stream"
  ) {
    return json({ error: "The file type does not match its extension." }, 415);
  }
  const upload = await readSlideBytes(request);
  if (upload instanceof Response) return upload;
  const { bytes, hash } = upload;
  if (!validSlideFile(bytes, format)) {
    return json(
      {
        error:
          format === "html"
            ? "The file is not a valid UTF-8 HTML presentation."
            : "The file is not a valid PDF or PowerPoint (.pptx) presentation.",
      },
      400,
    );
  }
  const slideId = crypto.randomUUID();
  const extension = format === "powerpoint" ? "pptx" : format;
  const r2Key = `speaker-slides/${talkId}/${slideId}.${extension}`;
  const uploadedAt = new Date().toISOString();
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
        slide: serializeSlide(row, admin),
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
      "content-disposition": `attachment; filename="slides.${row.format === "powerpoint" ? "pptx" : row.format}"; filename*=UTF-8''${encodeURIComponent(row.filename).replaceAll("'", "%27")}`,
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
): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | Response> {
  const length = request.headers.get("content-length");
  if (
    length &&
    (!/^\d+$/u.test(length) || Number(length) > maxSlideFileBytes)
  ) {
    return json({ error: "Slides must be 50 MB or smaller." }, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Choose a presentation file." }, 400);
  // Browser File uploads supply a length. Keep a single bounded buffer rather
  // than retaining all chunks and copying the entire presentation at the end.
  const bytes = new Uint8Array(
    length === null ? maxSlideFileBytes : Number(length),
  );
  const hash = createHash("sha256");
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxSlideFileBytes) {
        await reader.cancel();
        return json({ error: "Slides must be 50 MB or smaller." }, 413);
      }
      if (size + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        return json({ error: "The upload was interrupted. Try again." }, 400);
      }
      bytes.set(value, size);
      hash.update(value);
      size += value.byteLength;
    }
  } catch {
    return json({ error: "The upload was interrupted. Try again." }, 400);
  } finally {
    reader.releaseLock();
  }
  if (length !== null && size !== Number(length))
    return json({ error: "The upload was interrupted. Try again." }, 400);
  return { bytes: bytes.subarray(0, size), hash: hash.digest("hex") };
}

function validSlideFile(bytes: Uint8Array, format: SlideFormat): boolean {
  if (format === "html") {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let previous = "";
      let hasDocument = false;
      // Validate text in chunks as well: a full UTF-16 string can use twice the
      // file size. Keep enough overlap to recognize a split document tag.
      for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
        const text = decoder.decode(
          bytes.subarray(offset, offset + 64 * 1024),
          { stream: true },
        );
        if (text.includes("\u0000")) return false;
        hasDocument ||= /<(?:!doctype\s+html|html)(?:\s|>)/iu.test(
          previous + text,
        );
        previous = text.slice(-128);
      }
      decoder.decode();
      return hasDocument;
    } catch {
      return false;
    }
  }
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
