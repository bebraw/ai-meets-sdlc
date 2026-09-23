import { authenticateSpeaker } from "./speaker-login.ts";
import { withAdminSecurityHeaders } from "./admin-auth.ts";
import { jsonResponse } from "./form-utils.ts";

type ActorType = "admin" | "speaker";
type Activity = {
  actorType: ActorType;
  actorId: string;
  subjectSpeakerId: string | null;
  category: string;
  action: string;
};

const speakerActions: Record<string, [string, string]> = {
  "/api/speaker/dinner": ["Dinner response", "saved"],
  "/api/speaker/presentation": ["Presentation setup", "saved"],
  "/api/speaker/photo": ["Speaker photo", "uploaded"],
  "/api/speaker/videos/upload": ["Speaker video", "upload started"],
  "/api/speaker/receipts": ["Travel receipt", "changed"],
  "/api/speaker/workspace": ["Profile and talks", "saved draft"],
};

const adminActions: Record<string, [string, string]> = {
  "/api/admin/speakers/contact": ["Speaker contact", "saved"],
  "/api/admin/speakers/content": ["Profile and talks", "saved"],
  "/api/admin/speakers/review": ["Speaker revision", "reviewed"],
  "/api/admin/speakers/invite": ["Speaker access", "invitation sent"],
  "/api/admin/speakers/photos/upload": ["Speaker photo", "uploaded"],
  "/api/admin/speakers/photos/review": ["Speaker photo", "reviewed"],
  "/api/admin/speakers/videos/review": ["Speaker video", "reviewed"],
  "/api/admin/speakers/announcements/send": ["Speaker announcement", "sent"],
  "/api/admin/speakers/announcements/retry": [
    "Speaker announcement",
    "retried",
  ],
  "/api/admin/schedule": ["Schedule order", "saved"],
  "/api/admin/poster-proposals/status": ["Poster decision", "saved"],
  "/api/admin/speaker-dinner/invite": ["Dinner invitation", "rotated"],
  "/api/admin/speaker-dinner/shared-invite": ["Dinner invitation", "rotated"],
  "/api/admin/speaker-dinner/guests": ["Dinner guest", "added"],
  "/api/admin/speaker-dinner/purge": ["Dinner data", "purged"],
};

export function shouldRecordActivity(request: Request): boolean {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method))
    return false;
  const path = new URL(request.url).pathname;
  return Boolean(
    speakerActions[path] ||
    adminActions[path] ||
    path.startsWith("/api/admin/volunteers") ||
    path.startsWith("/api/admin/receipts") ||
    path.startsWith("/api/speaker/receipts/") ||
    /^\/api\/speaker\/videos\/[0-9a-f-]{36}\/preview$/iu.test(path),
  );
}

export async function recordSuccessfulActivity(
  request: Request,
  bodyRequest: { json(): Promise<unknown> } | null,
  response: Response,
  env: Env,
): Promise<void> {
  if (response.status < 200 || response.status >= 300 || !env.INTERESTS) return;

  const path = new URL(request.url).pathname;
  let activity: Activity | null = null;
  let body: Record<string, unknown> = {};
  if (bodyRequest) {
    try {
      const value: unknown = await bodyRequest.json();
      if (value && typeof value === "object" && !Array.isArray(value)) {
        body = value as Record<string, unknown>;
      }
    } catch {
      // The event category remains useful without request details.
    }
  }

  if (path.startsWith("/api/speaker/")) {
    const session = await authenticateSpeaker(request, env);
    if (session instanceof Response) return;
    const [category, defaultAction] =
      speakerActions[path] ??
      (path.startsWith("/api/speaker/receipts/")
        ? ["Travel receipt", "changed"]
        : ["Speaker video", "preview created"]);
    const action =
      path === "/api/speaker/workspace" && body.action === "submit"
        ? "submitted for review"
        : category === "Travel receipt"
          ? request.method === "DELETE"
            ? "deleted"
            : request.method === "POST"
              ? "uploaded"
              : "updated"
          : defaultAction;
    activity = {
      actorType: "speaker",
      actorId: session.speaker_id,
      subjectSpeakerId: session.speaker_id,
      category,
      action,
    };
  } else {
    const [category, defaultAction] =
      adminActions[path] ??
      (path.startsWith("/api/admin/volunteers")
        ? ["Volunteer", request.method === "DELETE" ? "deleted" : "saved"]
        : ["Travel receipt", "managed"]);
    const subject =
      body.speaker_id ??
      body.speakerId ??
      new URL(request.url).searchParams.get("speaker_id");
    let subjectSpeakerId = typeof subject === "string" ? subject : null;
    if (!subjectSpeakerId) {
      const review =
        path === "/api/admin/speakers/review"
          ? ["speaker_content_revisions", "revision_id", body.revision_id]
          : path === "/api/admin/speakers/photos/review"
            ? [
                "speaker_photo_revisions",
                "photo_revision_id",
                body.photo_revision_id,
              ]
            : path === "/api/admin/speakers/videos/review"
              ? [
                  "speaker_video_submissions",
                  "submission_id",
                  body.submission_id,
                ]
              : null;
      if (review && typeof review[2] === "string") {
        const row = await env.INTERESTS.prepare(
          `SELECT speaker_id FROM ${review[0]} WHERE ${review[1]} = ?1`,
        )
          .bind(review[2])
          .first<{ speaker_id: string }>();
        subjectSpeakerId = row?.speaker_id ?? null;
      }
    }
    if (!subjectSpeakerId) {
      const receiptId = /^\/api\/admin\/receipts\/([0-9a-f-]{36})$/iu.exec(
        path,
      )?.[1];
      if (receiptId) {
        const row = await env.INTERESTS.prepare(
          "SELECT speaker_id FROM speaker_travel_receipts WHERE receipt_id = ?1",
        )
          .bind(receiptId)
          .first<{ speaker_id: string }>();
        subjectSpeakerId = row?.speaker_id ?? null;
      }
    }
    const action =
      body.decision === "approve"
        ? "approved"
        : body.decision === "reject" || body.decision === "request_changes"
          ? "changes requested"
          : path === "/api/admin/speakers/content" && body.mode === "draft"
            ? "saved draft"
            : path === "/api/admin/speakers/content" && body.mode === "approve"
              ? "published"
              : defaultAction;
    activity = {
      actorType: "admin",
      actorId:
        (env as Env & { ADMIN_USERNAME?: string }).ADMIN_USERNAME ?? "admin",
      subjectSpeakerId,
      category,
      action,
    };
  }

  await insertActivity(env, activity);
}

export async function insertActivity(
  env: Env,
  activity: Activity,
): Promise<void> {
  await env
    .INTERESTS!.prepare(
      `INSERT INTO activity_events
      (occurred_at, actor_type, actor_id, subject_speaker_id, category, action)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      new Date().toISOString(),
      activity.actorType,
      activity.actorId,
      activity.subjectSpeakerId,
      activity.category,
      activity.action,
    )
    .run();
}

export async function handleActivityList(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET") {
    return withAdminSecurityHeaders(
      jsonResponse({ error: "Method not allowed" }, 405),
    );
  }
  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before"));
  const actor = url.searchParams.get("actor");
  const speaker = url.searchParams.get("speaker")?.trim() ?? "";
  if (
    (actor && actor !== "speaker" && actor !== "admin") ||
    speaker.length > 100 ||
    (url.searchParams.has("before") &&
      (!Number.isSafeInteger(before) || before <= 0))
  ) {
    return withAdminSecurityHeaders(
      jsonResponse({ error: "Invalid filter" }, 400),
    );
  }
  const { results } = await env
    .INTERESTS!.prepare(
      `SELECT e.event_id, e.occurred_at, e.actor_type, e.actor_id,
            e.subject_speaker_id, e.category, e.action,
            COALESCE(json_extract(c.content_json, '$.profile.name'), e.subject_speaker_id) AS speaker_name
       FROM activity_events e
       LEFT JOIN canonical_speaker_content c ON c.speaker_id = e.subject_speaker_id
      WHERE (?1 IS NULL OR e.event_id < ?1)
        AND (?2 IS NULL OR e.actor_type = ?2)
        AND (?3 IS NULL OR instr(lower(e.subject_speaker_id), lower(?3)) > 0
          OR instr(lower(json_extract(c.content_json, '$.profile.name')), lower(?3)) > 0)
      ORDER BY e.event_id DESC
      LIMIT 51`,
    )
    .bind(
      url.searchParams.has("before") ? before : null,
      actor,
      speaker || null,
    )
    .all();
  const page = results.slice(0, 50);
  return withAdminSecurityHeaders(
    jsonResponse({
      events: page,
      next_before: results.length > 50 ? page[page.length - 1]?.event_id : null,
    }),
  );
}
