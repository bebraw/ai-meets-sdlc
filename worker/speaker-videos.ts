interface SpeakerVideoRow {
  created_at: string;
  duration_seconds: number | null;
  error_code: string | null;
  may_caption: number;
  may_crop: number;
  may_edit: number;
  may_excerpt: number;
  may_publish: number;
  permission_recorded_at: string;
  permission_text: string;
  retention_until: string;
  review_note: string | null;
  reviewed_at: string | null;
  speaker_id: string;
  state:
    | "approved"
    | "changes_requested"
    | "error"
    | "processing"
    | "ready"
    | "superseded"
    | "upload_pending";
  stream_state: string | null;
  stream_uid: string;
  submission_id: string;
  talk_id: string;
  updated_at: string;
  upload_expires_at: string;
}

interface StreamWebhookPayload {
  creator?: unknown;
  duration?: unknown;
  meta?: unknown;
  readyToStream?: unknown;
  status?: unknown;
  uid?: unknown;
}

interface StreamWebhookStatus {
  errReasonCode?: unknown;
  errorReasonCode?: unknown;
  state?: unknown;
}

interface VideoPermissionInput {
  mayCaption: boolean;
  mayCrop: boolean;
  mayEdit: boolean;
  mayExcerpt: boolean;
  mayPublish: boolean;
}

const maxVideoDurationSeconds = 120;
const directUploadLifetimeMilliseconds = 30 * 60 * 1000;
const maxWebhookBodyBytes = 64 * 1024;
const webhookTimestampToleranceSeconds = 5 * 60;
const permissionText =
  "I confirm that I created or control this video and grant Toska Osuuskunta permission to use it for SDLCAI promotion according to the options selected here. I understand that the upload remains private until organizer review and that I can contact info@sdlcai.org to withdraw permission for future use.";

export async function handleStreamWebhookRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return videoJson({ error: "Method not allowed" }, 405);
  }

  const secret = (env as Env & { STREAM_WEBHOOK_SECRET?: string })
    .STREAM_WEBHOOK_SECRET;

  if (!secret?.trim() || !env.INTERESTS) {
    return videoJson({ error: "Stream webhook is not configured." }, 503);
  }

  const body = await readBytesWithinLimit(request, maxWebhookBodyBytes);

  if (body instanceof Response) return body;

  const signature = request.headers.get("webhook-signature");

  if (!(await verifyWebhookSignature(body, signature, secret))) {
    return videoJson({ error: "Webhook signature was not accepted." }, 401);
  }

  let payload: StreamWebhookPayload;

  try {
    payload = JSON.parse(
      new TextDecoder().decode(body),
    ) as StreamWebhookPayload;
  } catch {
    return videoJson({ error: "Webhook body is invalid." }, 400);
  }

  const uid = typeof payload.uid === "string" ? payload.uid : "";
  const status = isRecord(payload.status)
    ? (payload.status as StreamWebhookStatus)
    : null;
  const streamState = typeof status?.state === "string" ? status.state : "";

  if (!/^[A-Za-z0-9_-]{16,64}$/u.test(uid) || !status) {
    return videoJson({ error: "Webhook body is invalid." }, 400);
  }

  const row = await env.INTERESTS.prepare(
    `SELECT
       submission_id,
       speaker_id,
       talk_id,
       stream_uid,
       state,
       stream_state,
       duration_seconds,
       error_code,
       may_caption,
       may_crop,
       may_excerpt,
       may_edit,
       may_publish,
       permission_text,
       permission_recorded_at,
       upload_expires_at,
       retention_until,
       reviewed_at,
       review_note,
       created_at,
       updated_at
     FROM speaker_video_submissions
    WHERE stream_uid = ?1`,
  )
    .bind(uid)
    .first<SpeakerVideoRow>();

  if (!row) return new Response(null, { status: 204 });

  const creator = typeof payload.creator === "string" ? payload.creator : "";
  const meta = isRecord(payload.meta) ? payload.meta : {};

  if (
    creator !== row.speaker_id ||
    meta.talk_id !== row.talk_id ||
    meta.submission_id !== row.submission_id
  ) {
    console.error("Stream webhook metadata mismatch", {
      submissionId: row.submission_id,
    });
    return videoJson({ error: "Webhook metadata was not accepted." }, 409);
  }

  const duration =
    typeof payload.duration === "number" && Number.isFinite(payload.duration)
      ? payload.duration
      : null;
  const isReady =
    streamState === "ready" &&
    payload.readyToStream === true &&
    duration !== null;
  const isError = streamState === "error";

  if (!isReady && !isError) {
    return new Response(null, { status: 204 });
  }

  const now = new Date().toISOString();
  const durationAccepted =
    isReady && duration >= 0.1 && duration <= maxVideoDurationSeconds;
  const nextState = durationAccepted ? "ready" : "error";
  const errorCode = durationAccepted
    ? null
    : duration !== null && duration > maxVideoDurationSeconds
      ? "ERR_DURATION_EXCEED_CONSTRAINT"
      : normalizeErrorCode(status);

  await env.INTERESTS.prepare(
    `UPDATE speaker_video_submissions
        SET state = ?2,
            stream_state = ?3,
            duration_seconds = ?4,
            error_code = ?5,
            updated_at = ?6
      WHERE stream_uid = ?1
        AND state IN ('upload_pending', 'processing')`,
  )
    .bind(uid, nextState, streamState, duration, errorCode, now)
    .run();

  return new Response(null, { status: 204 });
}

export async function handleSpeakerVideoRequest(
  request: Request,
  env: Env,
  speakerId: string,
  assignedTalkIds: readonly string[],
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/speaker/videos") {
    if (request.method !== "GET") {
      return videoJson({ error: "Method not allowed" }, 405);
    }

    return videoJson({
      submissions: await readSpeakerVideos(env, speakerId, false),
    });
  }

  if (url.pathname === "/api/speaker/videos/upload") {
    if (request.method !== "POST") {
      return videoJson({ error: "Method not allowed" }, 405);
    }

    return createSpeakerVideoUpload(request, env, speakerId, assignedTalkIds);
  }

  const previewMatch =
    /^\/api\/speaker\/videos\/([0-9a-f-]{36})\/preview$/iu.exec(url.pathname);

  if (!previewMatch) return videoJson({ error: "Not found" }, 404);

  if (request.method !== "GET") {
    return videoJson({ error: "Method not allowed" }, 405);
  }

  return createVideoPreview(env, previewMatch[1]!, speakerId);
}

export async function readAdminSpeakerVideos(
  env: Env,
): Promise<Map<string, Record<string, unknown>[]>> {
  if (!env.INTERESTS) return new Map();

  const result = await env.INTERESTS.prepare(
    `${videoSelectSql}
     WHERE state <> 'superseded'
     ORDER BY updated_at DESC`,
  ).all<SpeakerVideoRow>();
  const videos = new Map<string, Record<string, unknown>[]>();

  for (const video of result.results) {
    const items = videos.get(video.speaker_id) ?? [];
    items.push(serializeVideo(video, true));
    videos.set(video.speaker_id, items);
  }

  return videos;
}

export async function handleAdminSpeakerVideoRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/admin/speakers/videos/review") {
    if (request.method !== "POST") {
      return videoJson({ error: "Method not allowed" }, 405);
    }

    return reviewSpeakerVideo(request, env);
  }

  const previewMatch =
    /^\/api\/admin\/speakers\/videos\/([0-9a-f-]{36})\/preview$/iu.exec(
      url.pathname,
    );

  if (!previewMatch) return videoJson({ error: "Not found" }, 404);

  if (request.method !== "GET") {
    return videoJson({ error: "Method not allowed" }, 405);
  }

  return createVideoPreview(env, previewMatch[1]!);
}

async function createSpeakerVideoUpload(
  request: Request,
  env: Env,
  speakerId: string,
  assignedTalkIds: readonly string[],
): Promise<Response> {
  if (!env.INTERESTS || !env.STREAM) {
    return videoJson({ error: "Speaker video upload is not configured." }, 503);
  }

  const retentionUntil = parseFutureDate(env.SPEAKER_VIDEO_RETENTION_UNTIL);

  if (
    !retentionUntil ||
    retentionUntil.getTime() < Date.now() + 30 * 86_400_000
  ) {
    return videoJson(
      { error: "Speaker video retention is not configured." },
      503,
    );
  }

  const body = await readSmallJson(request);

  if (body instanceof Response) return body;

  const talkId = typeof body.talk_id === "string" ? body.talk_id.trim() : "";

  if (!assignedTalkIds.includes(talkId)) {
    return videoJson({ error: "Choose one of your assigned talks." }, 400);
  }

  const permissions = parsePermissions(body.permissions);

  if (!permissions) {
    return videoJson({ error: "Confirm each video permission choice." }, 400);
  }

  if (!permissions.mayPublish) {
    return videoJson(
      {
        error:
          "Promotion upload requires permission to publish the reviewed video. You can still decline optional editing choices.",
      },
      400,
    );
  }

  if (body.permission_text !== permissionText) {
    return videoJson(
      { error: "Confirm the current video permission text." },
      400,
    );
  }

  const existing = await env.INTERESTS.prepare(
    `SELECT stream_uid
       FROM speaker_video_submissions
      WHERE speaker_id = ?1
        AND talk_id = ?2
        AND state IN ('upload_pending', 'processing', 'ready')
      LIMIT 1`,
  )
    .bind(speakerId, talkId)
    .first<{ stream_uid: string }>();
  const submissionId = crypto.randomUUID();
  const now = new Date();
  const uploadExpiry = new Date(
    now.getTime() + directUploadLifetimeMilliseconds,
  );
  let directUpload: StreamDirectUpload;

  try {
    directUpload = await env.STREAM.createDirectUpload({
      allowedOrigins: ["sdlcai.org", "www.sdlcai.org"],
      creator: speakerId,
      expiry: uploadExpiry.toISOString(),
      maxDurationSeconds: maxVideoDurationSeconds,
      meta: { submission_id: submissionId, talk_id: talkId },
      requireSignedURLs: true,
      scheduledDeletion: retentionUntil.toISOString(),
      thumbnailTimestampPct: 0.2,
    });
  } catch (error) {
    console.error("Unable to create Stream direct upload", {
      error: error instanceof Error ? error.message : "Unknown Stream error",
      speakerId,
      talkId,
    });
    return videoJson(
      { error: "A private video upload could not be created." },
      502,
    );
  }

  const nowIso = now.toISOString();

  try {
    await env.INTERESTS.batch([
      env.INTERESTS.prepare(
        `UPDATE speaker_video_submissions
            SET state = 'superseded', updated_at = ?3
          WHERE speaker_id = ?1
            AND talk_id = ?2
            AND state IN ('upload_pending', 'processing', 'ready')`,
      ).bind(speakerId, talkId, nowIso),
      env.INTERESTS.prepare(
        `INSERT INTO speaker_video_submissions (
           submission_id,
           speaker_id,
           talk_id,
           stream_uid,
           state,
           may_caption,
           may_crop,
           may_excerpt,
           may_edit,
           may_publish,
           permission_text,
           permission_recorded_at,
           upload_expires_at,
           retention_until,
           created_at,
           updated_at
         ) VALUES (
           ?1, ?2, ?3, ?4, 'upload_pending', ?5, ?6, ?7, ?8, ?9,
           ?10, ?11, ?12, ?13, ?11, ?11
         )`,
      ).bind(
        submissionId,
        speakerId,
        talkId,
        directUpload.id,
        permissions.mayCaption ? 1 : 0,
        permissions.mayCrop ? 1 : 0,
        permissions.mayExcerpt ? 1 : 0,
        permissions.mayEdit ? 1 : 0,
        permissions.mayPublish ? 1 : 0,
        permissionText,
        nowIso,
        uploadExpiry.toISOString(),
        retentionUntil.toISOString(),
      ),
    ]);
  } catch (error) {
    try {
      await env.STREAM.video(directUpload.id).delete();
    } catch {
      console.error("Unable to delete orphaned Stream upload", {
        streamUid: directUpload.id,
      });
    }
    throw error;
  }

  if (existing) {
    try {
      await env.STREAM.video(existing.stream_uid).delete();
    } catch (error) {
      console.error("Unable to delete superseded Stream video", {
        error: error instanceof Error ? error.message : "Unknown Stream error",
        streamUid: existing.stream_uid,
      });
    }
  }

  return videoJson(
    {
      max_duration_seconds: maxVideoDurationSeconds,
      message: "Private upload created.",
      submission_id: submissionId,
      upload_expires_at: uploadExpiry.toISOString(),
      upload_url: directUpload.uploadURL,
    },
    201,
  );
}

async function readSpeakerVideos(
  env: Env,
  speakerId: string,
  admin: boolean,
): Promise<Record<string, unknown>[]> {
  if (!env.INTERESTS) return [];

  const result = await env.INTERESTS.prepare(
    `${videoSelectSql}
     WHERE speaker_id = ?1 AND state <> 'superseded'
     ORDER BY updated_at DESC`,
  )
    .bind(speakerId)
    .all<SpeakerVideoRow>();

  return result.results.map((video) => serializeVideo(video, admin));
}

async function createVideoPreview(
  env: Env,
  submissionId: string,
  speakerId?: string,
): Promise<Response> {
  if (!env.INTERESTS || !env.STREAM) {
    return videoJson(
      { error: "Speaker video preview is not configured." },
      503,
    );
  }

  const speakerClause = speakerId ? "AND speaker_id = ?2" : "";
  const statement = env.INTERESTS.prepare(
    `${videoSelectSql}
     WHERE submission_id = ?1
       ${speakerClause}
       AND state IN ('ready', 'approved', 'changes_requested')`,
  );
  const video = speakerId
    ? await statement.bind(submissionId, speakerId).first<SpeakerVideoRow>()
    : await statement.bind(submissionId).first<SpeakerVideoRow>();

  if (!video)
    return videoJson({ error: "Video preview is not available." }, 404);

  try {
    const handle = env.STREAM.video(video.stream_uid);
    const [details, token] = await Promise.all([
      handle.details(),
      handle.generateToken(),
    ]);

    if (!details.readyToStream || !details.preview) {
      return videoJson({ error: "Video is still processing." }, 409);
    }

    return videoJson({
      expires_in_seconds: 3_600,
      preview_url: details.preview.replace(video.stream_uid, token),
    });
  } catch (error) {
    console.error("Unable to create private Stream preview", {
      error: error instanceof Error ? error.message : "Unknown Stream error",
      submissionId,
    });
    return videoJson({ error: "Private video preview is unavailable." }, 502);
  }
}

async function reviewSpeakerVideo(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return videoJson(
      { error: "Speaker video storage is not configured." },
      503,
    );
  }

  const body = await readSmallJson(request);

  if (body instanceof Response) return body;

  const submissionId =
    typeof body.submission_id === "string" ? body.submission_id.trim() : "";
  const decision = body.decision;
  const reviewNote =
    typeof body.review_note === "string" ? body.review_note.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(submissionId)) {
    return videoJson({ error: "Choose a ready video." }, 400);
  }

  if (decision !== "approve" && decision !== "request_changes") {
    return videoJson({ error: "Choose approve or request changes." }, 400);
  }

  if (
    reviewNote.length > 1_000 ||
    (decision === "request_changes" && reviewNote.length < 3)
  ) {
    return videoJson({ error: "Add a concise review note." }, 400);
  }

  const nextState = decision === "approve" ? "approved" : "changes_requested";
  const result = await env.INTERESTS.prepare(
    `UPDATE speaker_video_submissions
        SET state = ?2,
            reviewed_at = ?3,
            reviewed_by = 'admin',
            review_note = ?4,
            updated_at = ?3
      WHERE submission_id = ?1 AND state = 'ready'`,
  )
    .bind(submissionId, nextState, new Date().toISOString(), reviewNote || null)
    .run();

  if (!result.meta.changes) {
    return videoJson(
      { error: "That video is no longer awaiting review." },
      409,
    );
  }

  return videoJson({
    decision,
    message:
      decision === "approve"
        ? "Video approved for use within the recorded permissions."
        : "Changes requested. The speaker can upload a replacement.",
    submission_id: submissionId,
  });
}

function serializeVideo(
  video: SpeakerVideoRow,
  admin: boolean,
): Record<string, unknown> {
  const previewable = ["ready", "approved", "changes_requested"].includes(
    video.state,
  );
  const previewBase = admin
    ? `/api/admin/speakers/videos/${video.submission_id}/preview`
    : `/api/speaker/videos/${video.submission_id}/preview`;

  return {
    created_at: video.created_at,
    duration_seconds: video.duration_seconds,
    error_code: video.error_code,
    permissions: {
      may_caption: video.may_caption === 1,
      may_crop: video.may_crop === 1,
      may_edit: video.may_edit === 1,
      may_excerpt: video.may_excerpt === 1,
      may_publish: video.may_publish === 1,
      permission_recorded_at: video.permission_recorded_at,
      permission_text: video.permission_text,
    },
    preview_endpoint: previewable ? previewBase : null,
    retention_until: video.retention_until,
    review_note: video.review_note,
    reviewed_at: video.reviewed_at,
    state: video.state,
    submission_id: video.submission_id,
    talk_id: video.talk_id,
    updated_at: video.updated_at,
    upload_expires_at: video.upload_expires_at,
  };
}

function parsePermissions(value: unknown): VideoPermissionInput | null {
  if (!isRecord(value)) return null;

  const keys = [
    "may_caption",
    "may_crop",
    "may_excerpt",
    "may_edit",
    "may_publish",
  ] as const;

  if (keys.some((key) => typeof value[key] !== "boolean")) return null;

  return {
    mayCaption: value.may_caption as boolean,
    mayCrop: value.may_crop as boolean,
    mayEdit: value.may_edit as boolean,
    mayExcerpt: value.may_excerpt as boolean,
    mayPublish: value.may_publish as boolean,
  };
}

function normalizeErrorCode(status: StreamWebhookStatus): string {
  const value = status.errReasonCode ?? status.errorReasonCode;
  return typeof value === "string" && /^[A-Z0-9_-]{1,100}$/u.test(value)
    ? value
    : "ERR_UNKNOWN";
}

export async function verifyWebhookSignature(
  body: Uint8Array<ArrayBuffer>,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<boolean> {
  const match = /^time=(\d{10,}),sig1=([a-f0-9]{64})$/iu.exec(header ?? "");

  if (!match) return false;

  const timestamp = Number(match[1]);

  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > webhookTimestampToleranceSeconds
  ) {
    return false;
  }

  const prefix = new TextEncoder().encode(`${match[1]}.`);
  const source = new Uint8Array(prefix.byteLength + body.byteLength);
  source.set(prefix);
  source.set(body, prefix.byteLength);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, source),
  );
  const received = hexDecode(match[2]!);

  if (!received || received.byteLength !== expected.byteLength) return false;

  let difference = 0;
  for (let index = 0; index < expected.byteLength; index += 1) {
    difference |= expected[index]! ^ received[index]!;
  }

  return difference === 0;
}

function hexDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[a-f0-9]{2})+$/iu.test(value)) return null;

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function parseFutureDate(value: string | undefined): Date | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now()
    ? new Date(timestamp)
    : null;
}

async function readSmallJson(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return videoJson({ error: "Submit the video form again." }, 415);
  }

  const bytes = await readBytesWithinLimit(request, 16 * 1024);

  if (bytes instanceof Response) return bytes;

  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (isRecord(value)) return value;
  } catch {
    // Return one stable validation response below.
  }

  return videoJson({ error: "Submit the video form again." }, 400);
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
    return videoJson({ error: "Request body is too large." }, 413);
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
          return videoJson({ error: "Request body is too large." }, 413);
        }
        chunks.push(value);
      }
    } catch {
      return videoJson({ error: "Request body could not be read." }, 400);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function videoJson(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

const videoSelectSql = `SELECT
  submission_id,
  speaker_id,
  talk_id,
  stream_uid,
  state,
  stream_state,
  duration_seconds,
  error_code,
  may_caption,
  may_crop,
  may_excerpt,
  may_edit,
  may_publish,
  permission_text,
  permission_recorded_at,
  upload_expires_at,
  retention_until,
  reviewed_at,
  review_note,
  created_at,
  updated_at
FROM speaker_video_submissions`;

export const speakerVideoPermissionText = permissionText;
