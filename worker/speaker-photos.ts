interface SpeakerPhotoRow {
  byte_size: number;
  content_hash: string;
  created_at: string;
  height: number;
  photo_revision_id: string;
  r2_key: string;
  review_note: string | null;
  reviewed_at: string | null;
  speaker_id: string;
  state: "approved" | "rejected" | "submitted";
  updated_at: string;
  width: number;
}

const maxPhotoUploadBytes = 5 * 1024 * 1024;
const maxPhotoOutputBytes = 250 * 1024;
const maxDecodedPixels = 20_000_000;
const photoSize = 400;

export async function handleSpeakerPhotoRequest(
  request: Request,
  env: Env,
  speakerId: string,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/speaker/photo") {
    if (request.method === "GET") {
      return photoJson(await readSpeakerPhotoStatus(env, speakerId));
    }

    if (request.method === "POST") {
      return uploadSpeakerPhoto(request, env, speakerId);
    }

    return photoJson({ error: "Method not allowed" }, 405);
  }

  if (url.pathname === "/api/speaker/photo/image") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return photoJson({ error: "Method not allowed" }, 405);
    }

    const photo = await readLatestPhoto(env, speakerId);

    if (!photo) return photoJson({ error: "Photo was not found." }, 404);

    return servePhotoObject(env, photo, request.method === "HEAD");
  }

  return photoJson({ error: "Not found" }, 404);
}

export async function readAdminSpeakerPhotos(
  env: Env,
): Promise<Map<string, Record<string, unknown>>> {
  if (!env.INTERESTS) return new Map();

  const result = await env.INTERESTS.prepare(
    `SELECT
       photo_revision_id,
       speaker_id,
       r2_key,
       content_hash,
       byte_size,
       width,
       height,
       state,
       reviewed_at,
       review_note,
       created_at,
       updated_at
     FROM speaker_photo_revisions
    ORDER BY
      CASE state WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      updated_at DESC`,
  ).all<SpeakerPhotoRow>();
  const photos = new Map<string, Record<string, unknown>>();

  for (const photo of result.results) {
    if (!photos.has(photo.speaker_id)) {
      photos.set(photo.speaker_id, serializePhoto(photo, true));
    }
  }

  return photos;
}

export async function handleAdminSpeakerPhotoRequest(
  request: Request,
  env: Env,
  allowedSpeakerIds: ReadonlySet<string>,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/admin/speakers/photos/upload") {
    if (request.method !== "POST") {
      return photoJson({ error: "Method not allowed" }, 405);
    }

    const speakerId = url.searchParams.get("speaker_id")?.trim() ?? "";

    if (!allowedSpeakerIds.has(speakerId)) {
      return photoJson({ error: "Choose a valid speaker." }, 400);
    }

    return uploadSpeakerPhoto(request, env, speakerId, "admin");
  }

  if (url.pathname === "/api/admin/speakers/photos/review") {
    if (request.method !== "POST") {
      return photoJson({ error: "Method not allowed" }, 405);
    }

    return reviewSpeakerPhoto(request, env);
  }

  const match = /^\/api\/admin\/speakers\/photos\/([0-9a-f-]{36})$/iu.exec(
    url.pathname,
  );

  if (!match) return photoJson({ error: "Not found" }, 404);

  if (request.method !== "GET" && request.method !== "HEAD") {
    return photoJson({ error: "Method not allowed" }, 405);
  }

  if (!env.INTERESTS || !env.SPEAKER_UPLOADS) {
    return photoJson(
      { error: "Speaker photo storage is not configured." },
      503,
    );
  }

  const photo = await env.INTERESTS.prepare(
    `SELECT
       photo_revision_id,
       speaker_id,
       r2_key,
       content_hash,
       byte_size,
       width,
       height,
       state,
       reviewed_at,
       review_note,
       created_at,
       updated_at
     FROM speaker_photo_revisions
    WHERE photo_revision_id = ?1`,
  )
    .bind(match[1])
    .first<SpeakerPhotoRow>();

  if (!photo) return photoJson({ error: "Photo was not found." }, 404);

  return servePhotoObject(
    env,
    photo,
    request.method === "HEAD",
    url.searchParams.get("download") === "1",
  );
}

async function uploadSpeakerPhoto(
  request: Request,
  env: Env,
  speakerId: string,
  source: "admin" | "speaker" = "speaker",
): Promise<Response> {
  if (!env.INTERESTS || !env.SPEAKER_UPLOADS || !env.IMAGES) {
    return photoJson(
      { error: "Speaker photo processing is not configured." },
      503,
    );
  }

  const bytes = await readBytesWithinLimit(request, maxPhotoUploadBytes);

  if (bytes instanceof Response) return bytes;

  if (bytes.byteLength === 0) {
    return photoJson({ error: "Choose a JPEG, PNG, or WebP portrait." }, 400);
  }

  let sourceInfo: ImageInfoResponse;

  try {
    sourceInfo = await env.IMAGES.info(new Blob([bytes]).stream());
  } catch {
    return photoJson(
      { error: "The selected file is not a supported image." },
      400,
    );
  }

  if (
    !("width" in sourceInfo) ||
    sourceInfo.format === "image/svg+xml" ||
    sourceInfo.width < photoSize ||
    sourceInfo.height < photoSize ||
    sourceInfo.width * sourceInfo.height > maxDecodedPixels
  ) {
    return photoJson(
      {
        error:
          "Use a JPEG, PNG, or WebP image at least 400 × 400 pixels and no more than 20 megapixels.",
      },
      400,
    );
  }

  let outputBytes: Uint8Array<ArrayBuffer>;

  try {
    const transformed = await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({
        fit: "cover",
        gravity: "auto",
        height: photoSize,
        width: photoSize,
      })
      .output({ anim: false, format: "image/webp", quality: 84 });
    outputBytes = new Uint8Array(
      await new Response(transformed.image()).arrayBuffer(),
    );
  } catch (error) {
    console.error("Speaker photo transformation failed", {
      error: error instanceof Error ? error.message : "Unknown image error",
      speakerId,
    });
    return photoJson({ error: "The photo could not be processed." }, 422);
  }

  if (
    outputBytes.byteLength === 0 ||
    outputBytes.byteLength > maxPhotoOutputBytes
  ) {
    return photoJson(
      { error: "The processed photo is unexpectedly large." },
      422,
    );
  }

  try {
    const outputInfo = await env.IMAGES.info(new Blob([outputBytes]).stream());

    if (
      !("width" in outputInfo) ||
      outputInfo.width !== photoSize ||
      outputInfo.height !== photoSize ||
      outputInfo.format !== "image/webp"
    ) {
      return photoJson({ error: "The photo derivative was not valid." }, 422);
    }
  } catch {
    return photoJson({ error: "The photo derivative was not valid." }, 422);
  }

  const photoRevisionId = crypto.randomUUID();
  const r2Key = `photos/${speakerId}/${photoRevisionId}.webp`;
  const contentHash = await sha256(outputBytes);
  const now = new Date().toISOString();
  const previous = await env.INTERESTS.prepare(
    source === "admin"
      ? `SELECT r2_key
           FROM speaker_photo_revisions
          WHERE speaker_id = ?1 AND state IN ('submitted', 'approved')`
      : `SELECT r2_key
           FROM speaker_photo_revisions
          WHERE speaker_id = ?1 AND state = 'submitted'`,
  )
    .bind(speakerId)
    .all<{ r2_key: string }>();

  await env.SPEAKER_UPLOADS.put(r2Key, outputBytes, {
    customMetadata: { speakerId },
    httpMetadata: { contentType: "image/webp" },
  });

  try {
    const state = source === "admin" ? "approved" : "submitted";
    const supersededNote =
      source === "admin"
        ? "Superseded by an organizer upload."
        : "Replaced by a newer upload.";
    await env.INTERESTS.batch([
      env.INTERESTS.prepare(
        `UPDATE speaker_photo_revisions
            SET state = 'rejected',
                reviewed_at = ?2,
                reviewed_by = ?3,
                review_note = ?4,
                updated_at = ?2
          WHERE speaker_id = ?1
            AND state ${source === "admin" ? "IN ('submitted', 'approved')" : "= 'submitted'"}`,
      ).bind(speakerId, now, source, supersededNote),
      env.INTERESTS.prepare(
        `INSERT INTO speaker_photo_revisions (
           photo_revision_id,
           speaker_id,
           r2_key,
           content_hash,
           byte_size,
           width,
           height,
           state,
           reviewed_at,
           reviewed_by,
           review_note,
           created_at,
           updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 400, 400, ?6, ?7, ?8, ?9, ?10, ?10)`,
      ).bind(
        photoRevisionId,
        speakerId,
        r2Key,
        contentHash,
        outputBytes.byteLength,
        state,
        source === "admin" ? now : null,
        source === "admin" ? "admin" : null,
        source === "admin" ? "Uploaded by the organizer." : null,
        now,
      ),
    ]);
  } catch (error) {
    await env.SPEAKER_UPLOADS.delete(r2Key);
    throw error;
  }

  for (const item of previous.results) {
    await env.SPEAKER_UPLOADS.delete(item.r2_key);
  }

  return photoJson(
    {
      message:
        source === "admin"
          ? "Photo processed and approved. Download the derivative and replace the canonical WebP in Git."
          : "Photo processed and submitted for organizer review.",
      photo: serializePhoto(
        {
          byte_size: outputBytes.byteLength,
          content_hash: contentHash,
          created_at: now,
          height: photoSize,
          photo_revision_id: photoRevisionId,
          r2_key: r2Key,
          review_note: source === "admin" ? "Uploaded by the organizer." : null,
          reviewed_at: source === "admin" ? now : null,
          speaker_id: speakerId,
          state: source === "admin" ? "approved" : "submitted",
          updated_at: now,
          width: photoSize,
        },
        source === "admin",
      ),
    },
    201,
  );
}

async function reviewSpeakerPhoto(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS || !env.SPEAKER_UPLOADS) {
    return photoJson(
      { error: "Speaker photo storage is not configured." },
      503,
    );
  }

  const body = await readSmallJson(request);

  if (body instanceof Response) return body;

  const photoRevisionId =
    typeof body.photo_revision_id === "string"
      ? body.photo_revision_id.trim()
      : "";
  const decision = body.decision;
  const reviewNote =
    typeof body.review_note === "string" ? body.review_note.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(photoRevisionId)) {
    return photoJson({ error: "Choose a submitted photo." }, 400);
  }

  if (decision !== "approve" && decision !== "reject") {
    return photoJson(
      { error: "Choose approve or request another photo." },
      400,
    );
  }

  if (
    reviewNote.length > 1_000 ||
    (decision === "reject" && reviewNote.length < 3)
  ) {
    return photoJson({ error: "Add a concise review note." }, 400);
  }

  const photo = await env.INTERESTS.prepare(
    `SELECT
       photo_revision_id,
       speaker_id,
       r2_key,
       content_hash,
       byte_size,
       width,
       height,
       state,
       reviewed_at,
       review_note,
       created_at,
       updated_at
     FROM speaker_photo_revisions
    WHERE photo_revision_id = ?1 AND state = 'submitted'`,
  )
    .bind(photoRevisionId)
    .first<SpeakerPhotoRow>();

  if (!photo) {
    return photoJson(
      { error: "That photo is no longer awaiting review." },
      409,
    );
  }

  const now = new Date().toISOString();

  if (decision === "approve") {
    await env.INTERESTS.batch([
      env.INTERESTS.prepare(
        `UPDATE speaker_photo_revisions
            SET state = 'rejected',
                reviewed_at = ?2,
                reviewed_by = 'admin',
                review_note = 'Superseded by a newer approved portrait.',
                updated_at = ?2
          WHERE speaker_id = ?1 AND state = 'approved'`,
      ).bind(photo.speaker_id, now),
      env.INTERESTS.prepare(
        `UPDATE speaker_photo_revisions
            SET state = 'approved',
                reviewed_at = ?2,
                reviewed_by = 'admin',
                review_note = ?3,
                updated_at = ?2
          WHERE photo_revision_id = ?1 AND state = 'submitted'`,
      ).bind(photoRevisionId, now, reviewNote || null),
    ]);
  } else {
    await env.INTERESTS.prepare(
      `UPDATE speaker_photo_revisions
          SET state = 'rejected',
              reviewed_at = ?2,
              reviewed_by = 'admin',
              review_note = ?3,
              updated_at = ?2
        WHERE photo_revision_id = ?1 AND state = 'submitted'`,
    )
      .bind(photoRevisionId, now, reviewNote)
      .run();
  }

  return photoJson({
    decision,
    message:
      decision === "approve"
        ? "Photo approved. Download the derivative and replace the canonical WebP in Git."
        : "Photo rejected. The speaker can upload a replacement.",
    photo_revision_id: photoRevisionId,
    speaker_id: photo.speaker_id,
  });
}

async function readSpeakerPhotoStatus(
  env: Env,
  speakerId: string,
): Promise<Record<string, unknown>> {
  const photo = await readLatestPhoto(env, speakerId);

  return {
    photo: photo ? serializePhoto(photo, false) : null,
  };
}

async function readLatestPhoto(
  env: Env,
  speakerId: string,
): Promise<SpeakerPhotoRow | null> {
  if (!env.INTERESTS) return null;

  return env.INTERESTS.prepare(
    `SELECT
       photo_revision_id,
       speaker_id,
       r2_key,
       content_hash,
       byte_size,
       width,
       height,
       state,
       reviewed_at,
       review_note,
       created_at,
       updated_at
     FROM speaker_photo_revisions
    WHERE speaker_id = ?1 AND state IN ('submitted', 'approved')
    ORDER BY CASE state WHEN 'submitted' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1`,
  )
    .bind(speakerId)
    .first<SpeakerPhotoRow>();
}

function serializePhoto(
  photo: SpeakerPhotoRow,
  admin: boolean,
): Record<string, unknown> {
  const basePath = admin
    ? `/api/admin/speakers/photos/${photo.photo_revision_id}`
    : "/api/speaker/photo/image";

  return {
    byte_size: photo.byte_size,
    content_hash: photo.content_hash,
    created_at: photo.created_at,
    height: photo.height,
    image_url: `${basePath}?v=${photo.content_hash}`,
    photo_revision_id: photo.photo_revision_id,
    review_note: photo.review_note,
    reviewed_at: photo.reviewed_at,
    state: photo.state,
    updated_at: photo.updated_at,
    width: photo.width,
  };
}

async function servePhotoObject(
  env: Env,
  photo: SpeakerPhotoRow,
  head: boolean,
  download = false,
): Promise<Response> {
  const object = await env.SPEAKER_UPLOADS.get(photo.r2_key);

  if (!object) return photoJson({ error: "Photo was not found." }, 404);

  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-length": String(photo.byte_size),
    "content-type": "image/webp",
    etag: `"${photo.content_hash}"`,
    "x-content-type-options": "nosniff",
  });

  if (download) {
    headers.set(
      "content-disposition",
      `attachment; filename="sdlcai-${photo.speaker_id}-400x400.webp"`,
    );
  }

  return new Response(head ? null : object.body, { headers });
}

async function readBytesWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | Response> {
  const contentLength = request.headers.get("content-length");

  if (
    contentLength &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    return photoJson({ error: "Photo must be no larger than 5 MB." }, 413);
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        total += value.byteLength;

        if (total > maxBytes) {
          await reader.cancel();
          return photoJson(
            { error: "Photo must be no larger than 5 MB." },
            413,
          );
        }

        chunks.push(value);
      }
    } catch {
      return photoJson({ error: "The photo upload was interrupted." }, 400);
    } finally {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

async function readSmallJson(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return photoJson({ error: "Submit the review form again." }, 415);
  }

  const bytes = await readBytesWithinLimit(request, 8 * 1024);

  if (bytes instanceof Response) return bytes;

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Return one stable validation response below.
  }

  return photoJson({ error: "Submit the review form again." }, 400);
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function photoJson(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
