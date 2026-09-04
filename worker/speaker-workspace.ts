import { normalizeHostname, verifyTurnstile } from "./turnstile.ts";
import {
  canonicalSpeakerIds,
  getCanonicalPhotoUrl,
  hashCanonicalContent,
  readCanonicalSpeaker,
  readCanonicalSpeakers,
  workspaceOnlySpeakerIds,
  type SpeakerProfileContent,
  type SpeakerTalkContent,
  type SpeakerWorkspaceContent,
} from "./canonical-content.ts";
import {
  handleAdminSpeakerPhotoRequest,
  handleSpeakerPhotoRequest,
  readAdminSpeakerPhotos,
} from "./speaker-photos.ts";
import {
  handleAdminSpeakerVideoRequest,
  handleSpeakerVideoRequest,
  handleStreamWebhookRequest,
  readAdminSpeakerVideos,
} from "./speaker-videos.ts";

type SocialField =
  | "website"
  | "linkedin"
  | "x"
  | "github"
  | "devto"
  | "scholar";

interface SpeakerAccessRow {
  access_generation: number;
  invite_expires_at: string;
  speaker_id: string;
}

interface SpeakerSessionRow extends SpeakerAccessRow {
  expires_at: string;
  token_hash: string;
}

interface SpeakerMagicLinkRow {
  access_generation: number;
  speaker_id: string;
}

type SpeakerDinnerAttendance = "attending" | "not_attending";
type SpeakerDinnerMealPreference =
  | ""
  | "omnivore"
  | "vegetarian"
  | "vegan"
  | "other";
type SpeakerDinnerCrossContamination = "" | "yes" | "no" | "unsure";

interface SpeakerDinnerResponseData {
  attendance: SpeakerDinnerAttendance;
  cross_contamination: SpeakerDinnerCrossContamination;
  food_requirements: string;
  meal_preference: SpeakerDinnerMealPreference;
}

interface SpeakerDinnerRow {
  consent_text: string | null;
  expires_at: string;
  responded_at: string | null;
  response_ciphertext: string | null;
  response_iv: string | null;
  speaker_id: string;
  updated_at: string;
}

interface SpeakerLoginContactRow extends SpeakerAccessRow {
  delivery_status: "active" | "suppressed";
  email_ciphertext: string;
  email_iv: string;
  retention_until: string;
}

interface SpeakerRevisionRow {
  base_content_hash: string;
  base_content_version: number;
  content_json: string;
  revision_id: string;
  state: "approved" | "draft" | "rejected" | "submitted";
  submitted_at: string | null;
  updated_at: string;
}

interface SpeakerContactRow {
  delivery_status: "active" | "suppressed";
  email_ciphertext: string;
  email_confirmed_at: string | null;
  email_iv: string;
  operational_email_enabled: number;
  promotion_email_enabled: number;
  retention_until: string;
  speaker_id: string;
  updated_at: string;
}

interface SpeakerAdminAccessRow {
  invite_expires_at: string;
  last_sent_at: string | null;
  revoked_at: string | null;
  speaker_id: string;
}

interface SpeakerAdminRevisionRow extends SpeakerRevisionRow {
  review_note: string | null;
  reviewed_at: string | null;
  speaker_id: string;
}

type SpeakerEmailCategory = "operational" | "promotion";

interface SpeakerAnnouncementInput {
  category: SpeakerEmailCategory;
  speakerIds: string[];
  subject: string;
  textBody: string;
}

interface SpeakerAnnouncementRecipient {
  email: string;
  name: string;
  speakerId: string;
}

interface SpeakerEmailCampaignRow {
  campaign_id: string;
  category: SpeakerEmailCategory;
  completed_at: string | null;
  created_at: string;
  failed_count: number;
  html_body: string;
  recipient_count: number;
  sent_count: number;
  status: "failed" | "partial" | "sending" | "sent";
  subject: string;
  text_body: string;
}

interface ValidationResult {
  content?: SpeakerWorkspaceContent;
  errors: Record<string, string>;
}

const speakerSessionCookie = "__Host-sdlcai-speaker-session";
const maxWorkspaceBodyBytes = 24 * 1024;
const maxLoginBodyBytes = 8 * 1024;
const maxDinnerBodyBytes = 8 * 1024;
const sessionLifetimeMilliseconds = 14 * 24 * 60 * 60 * 1000;
const magicLinkLifetimeMilliseconds = 15 * 60 * 1000;
const loginRequestRetentionMilliseconds = 24 * 60 * 60 * 1000;
const loginRateWindowMilliseconds = 60 * 60 * 1000;
const loginCooldownMilliseconds = 2 * 60 * 1000;
const maxLoginRequestsPerEmail = 5;
const maxLoginRequestsPerIp = 20;
const speakerLoginTurnstileAction = "speaker-login-v1";
const speakerDinnerConsentText =
  "I consent to Toska Osuuskunta processing this response and, if I attend, sharing only the necessary food information with the dinner caterer. I can withdraw by contacting info@sdlcai.org.";
const genericLoginMessage =
  "If that address is assigned to an SDLCAI speaker, a sign-in link is on its way. Check your inbox and spam folder.";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const socialFields = [
  "website",
  "linkedin",
  "x",
  "github",
  "devto",
  "scholar",
] as const satisfies readonly SocialField[];
const socialHosts: Record<Exclude<SocialField, "website">, Set<string>> = {
  devto: new Set(["dev.to"]),
  github: new Set(["github.com", "www.github.com"]),
  linkedin: new Set(["linkedin.com", "www.linkedin.com"]),
  scholar: new Set(["scholar.google.com"]),
  x: new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]),
};
export function isSpeakerWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/speaker" ||
    pathname.startsWith("/speaker/") ||
    pathname.startsWith("/api/speaker/")
  );
}

export function withSpeakerWorkspaceSecurityHeaders(
  response: Response,
): Response {
  const headers = new Headers(response.headers);

  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function handleSpeakerWorkspaceRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/stream/webhook") {
    return handleStreamWebhookRequest(request, env);
  }

  if (url.pathname.startsWith("/api/admin/speakers/videos/")) {
    if (url.pathname === "/api/admin/speakers/videos/review") {
      const forbidden = requireAdminMutation(request, "review-speaker-video");

      if (forbidden) return adminSecure(forbidden);
    }

    return adminSecure(await handleAdminSpeakerVideoRequest(request, env));
  }

  if (url.pathname.startsWith("/api/admin/speakers/photos/")) {
    const action =
      url.pathname === "/api/admin/speakers/photos/review"
        ? "review-speaker-photo"
        : url.pathname === "/api/admin/speakers/photos/upload"
          ? "upload-speaker-photo"
          : null;

    if (action) {
      const forbidden = requireAdminMutation(request, action);

      if (forbidden) return adminSecure(forbidden);
    }

    return adminSecure(
      await handleAdminSpeakerPhotoRequest(request, env, canonicalSpeakerIds),
    );
  }

  if (url.pathname === "/api/admin/speakers") {
    if (request.method !== "GET") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    return adminSecure(await getAdminSpeakers(env));
  }

  if (url.pathname === "/api/admin/speakers/invite") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "send-speaker-invite");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await sendSpeakerInvitation(request, env));
  }

  if (url.pathname === "/api/admin/speakers/contact") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "save-speaker-contact");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await saveSpeakerContact(request, env));
  }

  if (url.pathname === "/api/admin/speakers/content") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "save-speaker-content");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await saveAdminSpeakerContent(request, env));
  }

  if (url.pathname === "/api/admin/speakers/review") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "review-speaker-revision");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await reviewSpeakerRevision(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements") {
    if (request.method !== "GET") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    return adminSecure(await getSpeakerAnnouncements(env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/preview") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "preview-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await previewSpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/test") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "test-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await testSpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/send") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "send-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await sendSpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/admin/speakers/announcements/retry") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(
      request,
      "retry-speaker-announcement",
    );

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await retrySpeakerAnnouncement(request, env));
  }

  if (url.pathname === "/api/speaker/login") {
    if (request.method !== "POST") {
      return secure(json({ error: "Method not allowed" }, 405));
    }

    return secure(await requestSpeakerLogin(request, env, ctx));
  }

  if (url.pathname === "/api/speaker/session") {
    if (request.method === "POST") {
      return secure(await redeemSpeakerInvitation(request, env));
    }

    if (request.method === "DELETE") {
      return secure(await endSpeakerSession(request, env));
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  if (url.pathname === "/api/speaker/dinner") {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    if (request.method === "GET") {
      return secure(await getSpeakerDinner(session.speaker_id, env));
    }

    if (request.method === "POST") {
      return secure(
        await updateSpeakerDinner(request, session.speaker_id, env),
      );
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  if (
    url.pathname === "/api/speaker/photo" ||
    url.pathname === "/api/speaker/photo/image"
  ) {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    return secure(
      await handleSpeakerPhotoRequest(request, env, session.speaker_id),
    );
  }

  if (
    url.pathname === "/api/speaker/videos" ||
    url.pathname === "/api/speaker/videos/upload" ||
    /^\/api\/speaker\/videos\/[0-9a-f-]{36}\/preview$/iu.test(url.pathname)
  ) {
    if (request.method === "POST" && !isSameOriginMutation(request)) {
      return secure(json({ error: "Request origin was not accepted." }, 403));
    }

    const session = await authenticateSpeaker(request, env);

    if (session instanceof Response) return secure(session);

    const canonicalRecord = await readCanonicalSpeaker(env, session.speaker_id);

    if (!canonicalRecord) {
      return secure(json({ error: "Speaker profile was not found." }, 404));
    }

    return secure(
      await handleSpeakerVideoRequest(
        request,
        env,
        session.speaker_id,
        canonicalRecord.content.talks.map(({ id }) => id),
      ),
    );
  }

  if (url.pathname === "/api/speaker/workspace") {
    if (request.method === "GET") {
      return secure(await getSpeakerWorkspace(request, env));
    }

    if (request.method === "POST") {
      return secure(await updateSpeakerWorkspace(request, env));
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  return null;
}

async function getAdminSpeakers(env: Env): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const canonicalRecords = await readCanonicalSpeakers(env);
  const [
    contactResult,
    accessResult,
    revisionResult,
    dinnerResult,
    photos,
    videos,
  ] = await Promise.all([
    env
      .INTERESTS!.prepare(
        `SELECT
         speaker_id,
         email_ciphertext,
         email_iv,
         email_confirmed_at,
         retention_until,
         operational_email_enabled,
         promotion_email_enabled,
         delivery_status,
         updated_at
       FROM speaker_contacts`,
      )
      .all<SpeakerContactRow>(),
    env
      .INTERESTS!.prepare(
        `SELECT speaker_id, invite_expires_at, last_sent_at, revoked_at
         FROM speaker_workspace_access`,
      )
      .all<SpeakerAdminAccessRow>(),
    env
      .INTERESTS!.prepare(
        `SELECT
         revision_id,
         speaker_id,
         base_content_hash,
         base_content_version,
         content_json,
         state,
         submitted_at,
         reviewed_at,
         review_note,
         updated_at
       FROM speaker_content_revisions
      ORDER BY
        CASE state
          WHEN 'submitted' THEN 0
          WHEN 'draft' THEN 1
          WHEN 'approved' THEN 2
          ELSE 3
        END,
        updated_at DESC`,
      )
      .all<SpeakerAdminRevisionRow>(),
    env
      .INTERESTS!.prepare(
        `SELECT
         speaker_id,
         response_ciphertext,
         response_iv,
         consent_text,
         expires_at,
         responded_at,
         updated_at
       FROM speaker_dinner_responses`,
      )
      .all<SpeakerDinnerRow>(),
    readAdminSpeakerPhotos(env),
    readAdminSpeakerVideos(env),
  ]);
  const contacts = new Map(
    contactResult.results.map((contact) => [contact.speaker_id, contact]),
  );
  const access = new Map(
    accessResult.results.map((item) => [item.speaker_id, item]),
  );
  const revisions = new Map<string, SpeakerAdminRevisionRow>();
  const dinners = new Map(
    dinnerResult.results.map((item) => [item.speaker_id, item]),
  );

  for (const revision of revisionResult.results) {
    if (!revisions.has(revision.speaker_id)) {
      revisions.set(revision.speaker_id, revision);
    }
  }

  const speakers = await Promise.all(
    canonicalRecords.map(async (record) => {
      const contact = contacts.get(record.speakerId);
      const invitation = access.get(record.speakerId);
      const revision = revisions.get(record.speakerId);
      const dinnerRow = dinners.get(record.speakerId);
      const canonical = record.content;
      let email: string | null = null;
      let dinner: SpeakerDinnerResponseData | null = null;

      if (contact) {
        try {
          email = await decryptPrivateText(
            contact.email_ciphertext,
            contact.email_iv,
            env.EMAIL_ENCRYPTION_KEY!,
          );
        } catch {
          console.error("Unable to decrypt speaker contact", {
            speakerId: record.speakerId,
          });
        }
      }

      if (dinnerRow) {
        try {
          dinner = await decryptSpeakerDinnerResponse(dinnerRow, env);
        } catch {
          console.error(
            JSON.stringify({
              message: "Unable to decrypt speaker dinner response",
              speakerId: record.speakerId,
            }),
          );
        }
      }

      return {
        canonical,
        canonical_hash: await hashCanonicalContent(canonical),
        canonical_photo: getCanonicalPhotoUrl(record),
        canonical_version: record.contentVersion,
        contact: contact
          ? {
              delivery_status: contact.delivery_status,
              email,
              email_confirmed_at: contact.email_confirmed_at,
              operational_email_enabled:
                contact.operational_email_enabled === 1,
              promotion_email_enabled: contact.promotion_email_enabled === 1,
              retention_until: contact.retention_until,
              updated_at: contact.updated_at,
            }
          : null,
        dinner: dinnerRow
          ? {
              expires_at: dinnerRow.expires_at,
              responded_at: dinnerRow.responded_at,
              response: dinner,
              updated_at: dinnerRow.updated_at,
            }
          : null,
        invitation: invitation
          ? {
              active:
                invitation.revoked_at === null &&
                Date.parse(invitation.invite_expires_at) > Date.now(),
              expires_at: invitation.invite_expires_at,
              last_sent_at: invitation.last_sent_at,
            }
          : null,
        name: canonical.profile.name,
        photo: photos.get(record.speakerId) ?? null,
        revision: revision ? serializeAdminRevision(revision, canonical) : null,
        speaker_id: record.speakerId,
        workspace_only: workspaceOnlySpeakerIds.has(record.speakerId),
        videos: videos.get(record.speakerId) ?? [],
      };
    }),
  );

  return json({ count: speakers.length, speakers });
}

async function saveAdminSpeakerContent(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const body = await readJsonWithinLimit(request, maxWorkspaceBodyBytes);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Submit the speaker editor again." }, 400);
  }

  const speakerId =
    typeof body.speaker_id === "string" ? body.speaker_id.trim() : "";
  const mode = body.mode;
  const canonicalRecord = await readCanonicalSpeaker(env, speakerId);

  if (!canonicalRecord) {
    return json({ error: "Choose a valid speaker." }, 400);
  }

  if (mode !== "draft" && mode !== "approve") {
    return json({ error: "Choose whether to save or approve the edit." }, 400);
  }

  const canonical = canonicalRecord.content;
  const canonicalHash = await hashCanonicalContent(canonical);
  const baseContentVersion =
    typeof body.base_content_version === "number"
      ? body.base_content_version
      : Number.NaN;

  if (
    body.base_content_hash !== canonicalHash ||
    baseContentVersion !== canonicalRecord.contentVersion
  ) {
    return json(
      {
        error:
          "The published profile changed while this editor was open. Reload and review the latest details.",
      },
      409,
    );
  }

  const validation = validateSpeakerWorkspaceContent(
    body.content,
    canonical.talks.map(({ id }) => id),
  );

  if (!validation.content) {
    return json(
      {
        error: "Review the highlighted fields.",
        field_errors: validation.errors,
      },
      400,
    );
  }

  if ((await hashCanonicalContent(validation.content)) === canonicalHash) {
    return json({ error: "Change at least one speaker detail first." }, 400);
  }

  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const state = mode === "approve" ? "approved" : "draft";
  const reviewNote =
    mode === "approve"
      ? "Edited and approved by the organizer."
      : "Replaced by an organizer draft.";

  const contentJson = JSON.stringify(validation.content);
  let publicationVersion = canonicalRecord.contentVersion;

  if (mode === "approve") {
    const results = await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE canonical_speaker_content
              SET content_json = ?3,
                  content_version = content_version + 1,
                  last_content_revision_id = ?4,
                  updated_at = ?5,
                  updated_by = 'admin'
            WHERE speaker_id = ?1 AND content_version = ?2`,
        )
        .bind(speakerId, baseContentVersion, contentJson, revisionId, now),
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
              SET state = 'rejected',
                  reviewed_at = ?3,
                  reviewed_by = 'admin',
                  review_note = ?4,
                  updated_at = ?3
            WHERE speaker_id = ?1
              AND state IN ('draft', 'submitted')
              AND EXISTS (
                SELECT 1 FROM canonical_speaker_content
                 WHERE speaker_id = ?1
                   AND content_version = ?2 + 1
                   AND last_content_revision_id = ?5
              )`,
        )
        .bind(speakerId, baseContentVersion, now, reviewNote, revisionId),
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_content_revisions (
             revision_id,
             speaker_id,
             base_content_hash,
             base_content_version,
             content_json,
             state,
             submitted_at,
             reviewed_at,
             reviewed_by,
             review_note,
             created_at,
             updated_at
           )
           SELECT ?1, ?2, ?3, ?4, ?5, 'approved', ?6, ?6, 'admin', ?7, ?6, ?6
             FROM canonical_speaker_content
            WHERE speaker_id = ?2
              AND content_version = ?4 + 1
              AND last_content_revision_id = ?1`,
        )
        .bind(
          revisionId,
          speakerId,
          canonicalHash,
          baseContentVersion,
          contentJson,
          now,
          reviewNote,
        ),
    ]);

    if (results[0]?.meta.changes !== 1 || results[2]?.meta.changes !== 1) {
      return staleCanonicalResponse();
    }

    publicationVersion += 1;
  } else {
    const results = await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
              SET state = 'rejected',
                  reviewed_at = ?3,
                  reviewed_by = 'admin',
                  review_note = ?4,
                  updated_at = ?3
            WHERE speaker_id = ?1
              AND state IN ('draft', 'submitted')
              AND EXISTS (
                SELECT 1 FROM canonical_speaker_content
                 WHERE speaker_id = ?1 AND content_version = ?2
              )`,
        )
        .bind(speakerId, baseContentVersion, now, reviewNote),
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_content_revisions (
             revision_id,
             speaker_id,
             base_content_hash,
             base_content_version,
             content_json,
             state,
             created_at,
             updated_at
           )
           SELECT ?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?6
             FROM canonical_speaker_content
            WHERE speaker_id = ?2 AND content_version = ?4`,
        )
        .bind(
          revisionId,
          speakerId,
          canonicalHash,
          baseContentVersion,
          contentJson,
          now,
        ),
    ]);

    if (results[1]?.meta.changes !== 1) return staleCanonicalResponse();
  }

  return json({
    changed_fields: getChangedFields(canonical, validation.content),
    content: validation.content,
    message:
      mode === "approve"
        ? "Organizer edit approved and published."
        : "Organizer draft saved. It will be prefilled when the speaker signs in.",
    canonical_version: publicationVersion,
    revision_id: revisionId,
    speaker_id: speakerId,
    state,
  });
}

async function saveSpeakerContact(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const accessUntil = parseFutureConfigurationDate(
    env.SPEAKER_WORKSPACE_ACCESS_UNTIL,
  );
  const retentionUntil = parseFutureConfigurationDate(
    env.SPEAKER_CONTACT_RETENTION_UNTIL,
  );

  if (!accessUntil || !retentionUntil) {
    return json({ error: "Speaker workspace dates are not configured." }, 503);
  }

  const body = await readJsonWithinLimit(request, 8 * 1024);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Choose a speaker and enter their email." }, 400);
  }

  const speakerId = typeof body.speaker_id === "string" ? body.speaker_id : "";
  const speaker = await readCanonicalSpeaker(env, speakerId);
  const email = normalizeEmail(body.email);

  if (!speaker) return json({ error: "Choose a valid speaker." }, 400);

  if (!isLikelyEmail(email)) {
    return json({ error: "Enter a valid speaker email address." }, 400);
  }

  const emailFingerprint = await hashPrivateText(
    email,
    env.EMAIL_ENCRYPTION_KEY!,
    "email-hash",
  );
  const [duplicate, existingContact, existingAccess] = await Promise.all([
    env
      .INTERESTS!.prepare(
        `SELECT speaker_id
         FROM speaker_contacts
        WHERE email_fingerprint = ?1 AND speaker_id <> ?2
        LIMIT 1`,
      )
      .bind(emailFingerprint, speakerId)
      .first<{ speaker_id: string }>(),
    env
      .INTERESTS!.prepare(
        `SELECT email_fingerprint
         FROM speaker_contacts
        WHERE speaker_id = ?1
        LIMIT 1`,
      )
      .bind(speakerId)
      .first<{ email_fingerprint: string }>(),
    env
      .INTERESTS!.prepare(
        `SELECT invite_expires_at, revoked_at
         FROM speaker_workspace_access
        WHERE speaker_id = ?1
        LIMIT 1`,
      )
      .bind(speakerId)
      .first<{ invite_expires_at: string; revoked_at: string | null }>(),
  ]);

  if (duplicate) {
    return json(
      { error: "That email address is already assigned to another speaker." },
      409,
    );
  }

  const encryptedEmail = await encryptPrivateText(
    email,
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const now = new Date().toISOString();
  const emailChanged = Boolean(
    existingContact && existingContact.email_fingerprint !== emailFingerprint,
  );
  const accessNeedsRotation = Boolean(
    existingAccess &&
    (emailChanged ||
      existingAccess.revoked_at !== null ||
      Date.parse(existingAccess.invite_expires_at) <= Date.now()),
  );
  const hiddenInviteTokenHash = await hashToken(
    createToken(),
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-invite-token",
  );
  const statements: D1PreparedStatement[] = [
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_contacts (
         speaker_id,
         email_ciphertext,
         email_iv,
         email_fingerprint,
         email_confirmed_at,
         retention_until,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?6)
       ON CONFLICT (speaker_id) DO UPDATE SET
         email_ciphertext = excluded.email_ciphertext,
         email_iv = excluded.email_iv,
         email_confirmed_at = CASE
           WHEN speaker_contacts.email_fingerprint = excluded.email_fingerprint
             THEN speaker_contacts.email_confirmed_at
           ELSE NULL
         END,
         email_fingerprint = excluded.email_fingerprint,
         retention_until = excluded.retention_until,
         delivery_status = 'active',
         updated_at = excluded.updated_at`,
      )
      .bind(
        speakerId,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        emailFingerprint,
        retentionUntil.toISOString(),
        now,
      ),
  ];

  if (!existingAccess || accessNeedsRotation) {
    statements.push(
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_workspace_access (
           speaker_id,
           invite_token_hash,
           access_generation,
           invite_created_at,
           invite_expires_at,
           last_sent_at,
           revoked_at,
           created_at,
           updated_at
         ) VALUES (?1, ?2, 1, ?3, ?4, NULL, NULL, ?3, ?3)
         ON CONFLICT (speaker_id) DO UPDATE SET
           invite_token_hash = excluded.invite_token_hash,
           access_generation = speaker_workspace_access.access_generation + 1,
           invite_created_at = excluded.invite_created_at,
           invite_expires_at = excluded.invite_expires_at,
           last_sent_at = NULL,
           revoked_at = NULL,
           updated_at = excluded.updated_at`,
        )
        .bind(speakerId, hiddenInviteTokenHash, now, accessUntil.toISOString()),
    );
  }

  if (emailChanged || accessNeedsRotation) {
    statements.push(
      env
        .INTERESTS!.prepare(
          "DELETE FROM speaker_workspace_sessions WHERE speaker_id = ?1",
        )
        .bind(speakerId),
      env
        .INTERESTS!.prepare(
          "DELETE FROM speaker_magic_links WHERE speaker_id = ?1",
        )
        .bind(speakerId),
    );
  }

  await env.INTERESTS!.batch(statements);

  return json({
    login_url: `${parsePublicOrigin(env.PUBLIC_SITE_ORIGIN) ?? new URL(request.url).origin}/speaker/`,
    message: `Email saved for ${speaker.content.profile.name}. They can now request a sign-in link.`,
    speaker_id: speakerId,
  });
}

async function sendSpeakerInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  if (!env.EMAIL) {
    return json({ error: "Speaker invitation email is not configured." }, 503);
  }

  const accessUntil = parseFutureConfigurationDate(
    env.SPEAKER_WORKSPACE_ACCESS_UNTIL,
  );
  const retentionUntil = parseFutureConfigurationDate(
    env.SPEAKER_CONTACT_RETENTION_UNTIL,
  );
  const publicOrigin = parsePublicOrigin(env.PUBLIC_SITE_ORIGIN);

  if (!accessUntil || !retentionUntil || !publicOrigin) {
    return json({ error: "Speaker workspace dates are not configured." }, 503);
  }

  const body = await readJsonWithinLimit(request, 8 * 1024);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Choose a speaker and enter their email." }, 400);
  }

  const speakerId = typeof body.speaker_id === "string" ? body.speaker_id : "";
  const speaker = await readCanonicalSpeaker(env, speakerId);
  const email = normalizeEmail(body.email);

  if (!speaker) {
    return json({ error: "Choose a valid speaker." }, 400);
  }

  if (!isLikelyEmail(email)) {
    return json({ error: "Enter a valid speaker email address." }, 400);
  }

  const emailFingerprint = await hashPrivateText(
    email,
    env.EMAIL_ENCRYPTION_KEY!,
    "email-hash",
  );
  const duplicate = await env
    .INTERESTS!.prepare(
      `SELECT speaker_id
       FROM speaker_contacts
      WHERE email_fingerprint = ?1 AND speaker_id <> ?2
      LIMIT 1`,
    )
    .bind(emailFingerprint, speakerId)
    .first<{ speaker_id: string }>();

  if (duplicate) {
    return json(
      { error: "That email address is already assigned to another speaker." },
      409,
    );
  }

  const token = createToken();
  const tokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-invite-token",
  );
  const encryptedEmail = await encryptPrivateText(
    email,
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const now = new Date().toISOString();

  await env.INTERESTS!.batch([
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_contacts (
         speaker_id,
         email_ciphertext,
         email_iv,
         email_fingerprint,
         email_confirmed_at,
         retention_until,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?6)
       ON CONFLICT (speaker_id) DO UPDATE SET
         email_ciphertext = excluded.email_ciphertext,
         email_iv = excluded.email_iv,
         email_confirmed_at = CASE
           WHEN speaker_contacts.email_fingerprint = excluded.email_fingerprint
             THEN speaker_contacts.email_confirmed_at
           ELSE NULL
         END,
         email_fingerprint = excluded.email_fingerprint,
         retention_until = excluded.retention_until,
         delivery_status = 'active',
         updated_at = excluded.updated_at`,
      )
      .bind(
        speakerId,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        emailFingerprint,
        retentionUntil.toISOString(),
        now,
      ),
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_workspace_access (
         speaker_id,
         invite_token_hash,
         access_generation,
         invite_created_at,
         invite_expires_at,
         last_sent_at,
         revoked_at,
         created_at,
         updated_at
       ) VALUES (?1, ?2, 1, ?3, ?4, NULL, NULL, ?3, ?3)
       ON CONFLICT (speaker_id) DO UPDATE SET
         invite_token_hash = excluded.invite_token_hash,
         access_generation = speaker_workspace_access.access_generation + 1,
         invite_created_at = excluded.invite_created_at,
         invite_expires_at = excluded.invite_expires_at,
         last_sent_at = NULL,
         revoked_at = NULL,
         updated_at = excluded.updated_at`,
      )
      .bind(speakerId, tokenHash, now, accessUntil.toISOString()),
    env
      .INTERESTS!.prepare(
        "DELETE FROM speaker_workspace_sessions WHERE speaker_id = ?1",
      )
      .bind(speakerId),
  ]);

  const invitationUrl = `${publicOrigin}/speaker/#${token}`;

  try {
    await env.EMAIL.send({
      from: { email: "info@sdlcai.org", name: "SDLCAI" },
      html: speakerInvitationHtml({
        expiresAt: accessUntil,
        invitationUrl,
        speakerName: speaker.content.profile.name,
      }),
      replyTo: "info@sdlcai.org",
      subject: "Your SDLCAI speaker workspace",
      text: speakerInvitationText({
        expiresAt: accessUntil,
        invitationUrl,
        speakerName: speaker.content.profile.name,
      }),
      to: email,
    });
  } catch (error) {
    console.error("Speaker invitation delivery failed", {
      error: error instanceof Error ? error.message : "Unknown email error",
      speakerId,
    });
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_workspace_access
          SET revoked_at = ?2, updated_at = ?2
        WHERE speaker_id = ?1 AND invite_token_hash = ?3`,
      )
      .bind(speakerId, new Date().toISOString(), tokenHash)
      .run();

    return json(
      {
        error:
          "The invitation could not be sent. No active link was left behind.",
      },
      502,
    );
  }

  const sentAt = new Date().toISOString();
  await env
    .INTERESTS!.prepare(
      `UPDATE speaker_workspace_access
        SET last_sent_at = ?2, updated_at = ?2
      WHERE speaker_id = ?1 AND invite_token_hash = ?3`,
    )
    .bind(speakerId, sentAt, tokenHash)
    .run();

  return json({
    message: `Invitation sent to ${speaker.content.profile.name}.`,
    sent_at: sentAt,
    speaker_id: speakerId,
  });
}

async function reviewSpeakerRevision(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const body = await readJsonWithinLimit(request, 8 * 1024);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Choose a submitted revision." }, 400);
  }

  const revisionId =
    typeof body.revision_id === "string" ? body.revision_id.trim() : "";
  const decision = body.decision;
  const reviewNote =
    typeof body.review_note === "string" ? body.review_note.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(revisionId)) {
    return json({ error: "Choose a submitted revision." }, 400);
  }

  if (decision !== "approve" && decision !== "reject") {
    return json({ error: "Choose approve or request changes." }, 400);
  }

  if (reviewNote.length > 1_000) {
    return json({ error: "Keep the review note under 1,000 characters." }, 400);
  }

  if (decision === "reject" && reviewNote.length < 3) {
    return json(
      { error: "Add a short note explaining the requested changes." },
      400,
    );
  }

  const revision = await env
    .INTERESTS!.prepare(
      `SELECT
       revision_id,
       speaker_id,
       base_content_hash,
       base_content_version,
       content_json,
       state,
       submitted_at,
       updated_at
     FROM speaker_content_revisions
    WHERE revision_id = ?1 AND state = 'submitted'
    LIMIT 1`,
    )
    .bind(revisionId)
    .first<SpeakerRevisionRow & { speaker_id: string }>();

  if (!revision) {
    return json({ error: "That revision is no longer awaiting review." }, 409);
  }

  const canonicalRecord = await readCanonicalSpeaker(env, revision.speaker_id);

  if (!canonicalRecord) {
    return json({ error: "The speaker profile no longer exists." }, 409);
  }

  const canonical = canonicalRecord.content;

  if (
    canonicalRecord.contentVersion !== revision.base_content_version ||
    (await hashCanonicalContent(canonical)) !== revision.base_content_hash
  ) {
    return json(
      {
        error:
          "The public profile changed after this revision was submitted. Reconcile it before reviewing.",
      },
      409,
    );
  }

  let proposed: SpeakerWorkspaceContent;

  try {
    const validation = validateSpeakerWorkspaceContent(
      JSON.parse(revision.content_json) as unknown,
      canonical.talks.map(({ id }) => id),
    );

    if (!validation.content) throw new Error("Invalid revision content");
    proposed = validation.content;
  } catch {
    return json(
      { error: "That revision is invalid and cannot be published." },
      409,
    );
  }

  const now = new Date().toISOString();

  if (decision === "approve") {
    const results = await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE canonical_speaker_content
              SET content_json = ?4,
                  content_version = content_version + 1,
                  last_content_revision_id = ?1,
                  updated_at = ?5,
                  updated_by = 'admin'
            WHERE speaker_id = ?2
              AND content_version = ?3
              AND EXISTS (
                SELECT 1 FROM speaker_content_revisions
                 WHERE revision_id = ?1 AND state = 'submitted'
              )`,
        )
        .bind(
          revisionId,
          revision.speaker_id,
          revision.base_content_version,
          JSON.stringify(proposed),
          now,
        ),
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
              SET state = 'approved',
                  reviewed_at = ?4,
                  reviewed_by = 'admin',
                  review_note = ?5,
                  updated_at = ?4
            WHERE revision_id = ?1
              AND speaker_id = ?2
              AND state = 'submitted'
              AND EXISTS (
                SELECT 1 FROM canonical_speaker_content
                 WHERE speaker_id = ?2
                   AND content_version = ?3 + 1
                   AND last_content_revision_id = ?1
              )`,
        )
        .bind(
          revisionId,
          revision.speaker_id,
          revision.base_content_version,
          now,
          reviewNote || null,
        ),
    ]);

    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return staleCanonicalResponse();
    }
  } else {
    const draftRevisionId = crypto.randomUUID();
    const results = await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
            SET state = 'rejected',
                reviewed_at = ?2,
                reviewed_by = 'admin',
                review_note = ?3,
                updated_at = ?2
          WHERE revision_id = ?1
            AND state = 'submitted'
            AND EXISTS (
              SELECT 1 FROM canonical_speaker_content
               WHERE speaker_id = ?4 AND content_version = ?5
            )`,
        )
        .bind(
          revisionId,
          now,
          reviewNote,
          revision.speaker_id,
          revision.base_content_version,
        ),
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_content_revisions (
           revision_id,
           speaker_id,
           base_content_hash,
           base_content_version,
           content_json,
           state,
           created_at,
           updated_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?6
           FROM canonical_speaker_content
          WHERE speaker_id = ?2 AND content_version = ?4`,
        )
        .bind(
          draftRevisionId,
          revision.speaker_id,
          revision.base_content_hash,
          revision.base_content_version,
          revision.content_json,
          now,
        ),
    ]);

    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return staleCanonicalResponse();
    }
  }

  return json({
    decision,
    message:
      decision === "approve"
        ? "Revision approved and published."
        : "Changes requested. The speaker can edit the returned draft.",
    revision_id: revisionId,
    speaker_id: revision.speaker_id,
  });
}

async function getSpeakerAnnouncements(env: Env): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const result = await env
    .INTERESTS!.prepare(
      `SELECT
       campaign_id,
       category,
       subject,
       text_body,
       html_body,
       status,
       recipient_count,
       sent_count,
       failed_count,
       created_at,
       completed_at
     FROM speaker_email_campaigns
    ORDER BY created_at DESC
    LIMIT 20`,
    )
    .all<SpeakerEmailCampaignRow>();

  return json({ campaigns: result.results, count: result.results.length });
}

async function previewSpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  const prepared = await prepareSpeakerAnnouncement(request, env);

  if (prepared instanceof Response) return prepared;

  const { excluded, input, recipients } = prepared;

  return json({
    excluded,
    html_body: renderAnnouncementHtml("{{speaker name}}", input.textBody),
    recipient_count: recipients.length,
    recipients: recipients.map(({ name, speakerId }) => ({
      name,
      speaker_id: speakerId,
    })),
    subject: input.subject,
    text_body: renderAnnouncementText("{{speaker name}}", input.textBody),
  });
}

async function testSpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.EMAIL) {
    return json(
      { error: "Speaker announcement email is not configured." },
      503,
    );
  }

  const body = await readJsonWithinLimit(request, 24 * 1024);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Complete the announcement before testing it." }, 400);
  }

  const parsed = parseSpeakerAnnouncementInput(body);

  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const testEmail = normalizeEmail(body.test_email);

  if (!isLikelyEmail(testEmail)) {
    return json({ error: "Enter a valid test recipient address." }, 400);
  }

  try {
    await deliverSpeakerEmail(
      env,
      {
        email: testEmail,
        name: "Test recipient",
        speakerId: "test",
      },
      `[TEST] ${parsed.subject}`,
      parsed.textBody,
    );
  } catch (error) {
    console.error("Speaker announcement test delivery failed", {
      error: error instanceof Error ? error.message : "Unknown email error",
    });
    return json({ error: "The test message could not be sent." }, 502);
  }

  return json({ message: "Test message sent." });
}

async function sendSpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.EMAIL) {
    return json(
      { error: "Speaker announcement email is not configured." },
      503,
    );
  }

  const prepared = await prepareSpeakerAnnouncement(request, env);

  if (prepared instanceof Response) return prepared;

  const { body, input, recipients } = prepared;
  const confirmedCount = body.confirm_recipient_count;

  if (
    !Number.isSafeInteger(confirmedCount) ||
    confirmedCount !== recipients.length
  ) {
    return json(
      {
        error:
          "Recipient eligibility changed. Preview again and confirm the new count.",
      },
      409,
    );
  }

  if (recipients.length === 0) {
    return json({ error: "No eligible speakers were selected." }, 400);
  }

  const campaignId = crypto.randomUUID();
  const now = new Date().toISOString();
  const previewHtml = renderAnnouncementHtml(
    "{{speaker name}}",
    input.textBody,
  );
  await env.INTERESTS!.batch([
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_email_campaigns (
         campaign_id,
         category,
         subject,
         text_body,
         html_body,
         status,
         recipient_count,
         created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'sending', ?6, ?7)`,
      )
      .bind(
        campaignId,
        input.category,
        input.subject,
        input.textBody,
        previewHtml,
        recipients.length,
        now,
      ),
    ...recipients.map((recipient) =>
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_email_deliveries (
           campaign_id,
           speaker_id,
           status,
           attempts,
           updated_at
         ) VALUES (?1, ?2, 'pending', 0, ?3)`,
        )
        .bind(campaignId, recipient.speakerId, now),
    ),
  ]);

  for (const recipient of recipients) {
    await attemptCampaignDelivery(
      env,
      campaignId,
      recipient,
      input.subject,
      input.textBody,
    );
  }

  const outcome = await finalizeCampaign(env, campaignId);

  return json({
    campaign_id: campaignId,
    message:
      outcome.failed_count === 0
        ? `Announcement sent separately to ${outcome.sent_count} speakers.`
        : `Sent ${outcome.sent_count}; ${outcome.failed_count} deliveries can be retried.`,
    ...outcome,
  });
}

async function retrySpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.EMAIL) {
    return json(
      { error: "Speaker announcement email is not configured." },
      503,
    );
  }

  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const body = await readJsonWithinLimit(request, 8 * 1024);

  if (body instanceof Response) return body;

  const campaignId =
    isRecord(body) && typeof body.campaign_id === "string"
      ? body.campaign_id.trim()
      : "";

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(campaignId)) {
    return json({ error: "Choose a failed announcement." }, 400);
  }

  const campaign = await env
    .INTERESTS!.prepare(
      `SELECT
       campaign_id,
       category,
       subject,
       text_body,
       html_body,
       status,
       recipient_count,
       sent_count,
       failed_count,
       created_at,
       completed_at
     FROM speaker_email_campaigns
    WHERE campaign_id = ?1 AND status IN ('failed', 'partial')`,
    )
    .bind(campaignId)
    .first<SpeakerEmailCampaignRow>();

  if (!campaign) {
    return json(
      { error: "That announcement has no retryable deliveries." },
      409,
    );
  }

  const failedResult = await env
    .INTERESTS!.prepare(
      `SELECT speaker_id
       FROM speaker_email_deliveries
      WHERE campaign_id = ?1 AND status = 'failed'`,
    )
    .bind(campaignId)
    .all<{ speaker_id: string }>();
  const eligible = await getAnnouncementRecipients(
    env,
    failedResult.results.map(({ speaker_id }) => speaker_id),
    campaign.category,
  );
  const recipientsById = new Map(
    eligible.recipients.map((recipient) => [recipient.speakerId, recipient]),
  );

  for (const { speaker_id: speakerId } of failedResult.results) {
    const recipient = recipientsById.get(speakerId);

    if (!recipient) {
      await env
        .INTERESTS!.prepare(
          `UPDATE speaker_email_deliveries
            SET status = 'skipped',
                last_error_code = 'no-longer-eligible',
                updated_at = ?3
          WHERE campaign_id = ?1 AND speaker_id = ?2 AND status = 'failed'`,
        )
        .bind(campaignId, speakerId, new Date().toISOString())
        .run();
      continue;
    }

    await attemptCampaignDelivery(
      env,
      campaignId,
      recipient,
      campaign.subject,
      campaign.text_body,
    );
  }

  const outcome = await finalizeCampaign(env, campaignId);

  return json({
    campaign_id: campaignId,
    message:
      outcome.failed_count === 0
        ? "Retry completed without remaining delivery failures."
        : `${outcome.failed_count} deliveries still failed.`,
    ...outcome,
  });
}

async function prepareSpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<
  | Response
  | {
      body: Record<string, unknown>;
      excluded: Array<{ reason: string; speaker_id: string }>;
      input: SpeakerAnnouncementInput;
      recipients: SpeakerAnnouncementRecipient[];
    }
> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const body = await readJsonWithinLimit(request, 24 * 1024);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Complete the announcement form." }, 400);
  }

  const parsed = parseSpeakerAnnouncementInput(body);

  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const selection = await getAnnouncementRecipients(
    env,
    parsed.speakerIds,
    parsed.category,
  );

  return { body, input: parsed, ...selection };
}

function parseSpeakerAnnouncementInput(
  body: Record<string, unknown>,
): SpeakerAnnouncementInput | { error: string } {
  const category = body.category;
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const textBody =
    typeof body.text_body === "string"
      ? body.text_body.trim().replace(/\r\n?/gu, "\n")
      : "";
  const speakerIds = Array.isArray(body.speaker_ids)
    ? body.speaker_ids.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  if (category !== "operational" && category !== "promotion") {
    return { error: "Choose an announcement category." };
  }

  if (subject.length < 4 || subject.length > 160 || /[\r\n]/u.test(subject)) {
    return { error: "Use a subject between 4 and 160 characters." };
  }

  if (textBody.length < 20 || textBody.length > 10_000) {
    return { error: "Use a message between 20 and 10,000 characters." };
  }

  const uniqueSpeakerIds = [...new Set(speakerIds)];

  if (
    uniqueSpeakerIds.length === 0 ||
    uniqueSpeakerIds.length > canonicalSpeakerIds.size ||
    uniqueSpeakerIds.some((speakerId) => !canonicalSpeakerIds.has(speakerId))
  ) {
    return { error: "Select at least one valid speaker." };
  }

  return {
    category,
    speakerIds: uniqueSpeakerIds,
    subject,
    textBody,
  };
}

async function getAnnouncementRecipients(
  env: Env,
  speakerIds: string[],
  category: SpeakerEmailCategory,
): Promise<{
  excluded: Array<{ reason: string; speaker_id: string }>;
  recipients: SpeakerAnnouncementRecipient[];
}> {
  const result = await env
    .INTERESTS!.prepare(
      `SELECT
       speaker_id,
       email_ciphertext,
       email_iv,
       email_confirmed_at,
       retention_until,
       operational_email_enabled,
       promotion_email_enabled,
       delivery_status,
       updated_at
     FROM speaker_contacts`,
    )
    .all<SpeakerContactRow>();
  const contacts = new Map(
    result.results.map((contact) => [contact.speaker_id, contact]),
  );
  const canonicalRecords = new Map(
    (await readCanonicalSpeakers(env)).map((record) => [
      record.speakerId,
      record,
    ]),
  );
  const recipients: SpeakerAnnouncementRecipient[] = [];
  const excluded: Array<{ reason: string; speaker_id: string }> = [];

  for (const speakerId of speakerIds) {
    const speaker = canonicalRecords.get(speakerId);
    const contact = contacts.get(speakerId);
    let reason = "";

    if (!speaker) reason = "unknown-speaker";
    else if (!contact) reason = "no-contact";
    else if (!contact.email_confirmed_at) reason = "unconfirmed";
    else if (contact.delivery_status !== "active") reason = "suppressed";
    else if (
      category === "operational" &&
      contact.operational_email_enabled !== 1
    ) {
      reason = "operational-disabled";
    } else if (
      category === "promotion" &&
      contact.promotion_email_enabled !== 1
    ) {
      reason = "promotion-disabled";
    }

    if (reason || !contact || !speaker) {
      excluded.push({ reason, speaker_id: speakerId });
      continue;
    }

    try {
      recipients.push({
        email: await decryptPrivateText(
          contact.email_ciphertext,
          contact.email_iv,
          env.EMAIL_ENCRYPTION_KEY!,
        ),
        name: speaker.content.profile.name,
        speakerId,
      });
    } catch {
      console.error("Unable to decrypt announcement recipient", { speakerId });
      excluded.push({ reason: "contact-unavailable", speaker_id: speakerId });
    }
  }

  return { excluded, recipients };
}

async function attemptCampaignDelivery(
  env: Env,
  campaignId: string,
  recipient: SpeakerAnnouncementRecipient,
  subject: string,
  textBody: string,
): Promise<void> {
  const now = new Date().toISOString();

  try {
    await deliverSpeakerEmail(env, recipient, subject, textBody);
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_email_deliveries
          SET status = 'sent',
              attempts = attempts + 1,
              last_error_code = NULL,
              sent_at = ?3,
              updated_at = ?3
        WHERE campaign_id = ?1
          AND speaker_id = ?2
          AND status IN ('pending', 'failed')`,
      )
      .bind(campaignId, recipient.speakerId, now)
      .run();
  } catch (error) {
    console.error("Speaker announcement delivery failed", {
      campaignId,
      error: error instanceof Error ? error.message : "Unknown email error",
      speakerId: recipient.speakerId,
    });
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_email_deliveries
          SET status = 'failed',
              attempts = attempts + 1,
              last_error_code = 'delivery-error',
              updated_at = ?3
        WHERE campaign_id = ?1
          AND speaker_id = ?2
          AND status IN ('pending', 'failed')`,
      )
      .bind(campaignId, recipient.speakerId, now)
      .run();
  }
}

async function deliverSpeakerEmail(
  env: Env,
  recipient: SpeakerAnnouncementRecipient,
  subject: string,
  textBody: string,
): Promise<void> {
  await env.EMAIL.send({
    from: { email: "info@sdlcai.org", name: "SDLCAI" },
    html: renderAnnouncementHtml(recipient.name, textBody),
    replyTo: "info@sdlcai.org",
    subject,
    text: renderAnnouncementText(recipient.name, textBody),
    to: recipient.email,
  });
}

async function finalizeCampaign(
  env: Env,
  campaignId: string,
): Promise<{
  failed_count: number;
  sent_count: number;
  status: "failed" | "partial" | "sending" | "sent";
}> {
  const counts = await env
    .INTERESTS!.prepare(
      `SELECT
       SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
       SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count
     FROM speaker_email_deliveries
    WHERE campaign_id = ?1`,
    )
    .bind(campaignId)
    .first<{
      failed_count: number;
      pending_count: number;
      sent_count: number;
      skipped_count: number;
    }>();
  const sentCount = counts?.sent_count ?? 0;
  const failedCount = counts?.failed_count ?? 0;
  const pendingCount = counts?.pending_count ?? 0;
  const skippedCount = counts?.skipped_count ?? 0;
  const status =
    pendingCount > 0
      ? "sending"
      : failedCount === 0 && skippedCount === 0
        ? "sent"
        : sentCount === 0 && skippedCount === 0
          ? "failed"
          : "partial";
  const completedAt = status === "sending" ? null : new Date().toISOString();

  await env
    .INTERESTS!.prepare(
      `UPDATE speaker_email_campaigns
        SET status = ?2,
            sent_count = ?3,
            failed_count = ?4,
            completed_at = ?5
      WHERE campaign_id = ?1`,
    )
    .bind(campaignId, status, sentCount, failedCount, completedAt)
    .run();

  return {
    failed_count: failedCount,
    sent_count: sentCount,
    status,
  };
}

function renderAnnouncementText(speakerName: string, textBody: string): string {
  return [
    `Hello ${speakerName},`,
    "",
    textBody,
    "",
    "Questions? Reply to this message or contact info@sdlcai.org.",
    "",
    "SDLCAI",
  ].join("\n");
}

function renderAnnouncementHtml(speakerName: string, textBody: string): string {
  const paragraphs = textBody
    .split(/\n{2,}/u)
    .map(
      (paragraph) =>
        `<p style="font-size:17px;line-height:1.6">${escapeHtml(paragraph).replace(/\n/gu, "<br>")}</p>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3efe7;color:#151515;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:13px;font-weight:700;text-transform:uppercase">SDLCAI / Speaker update</p>
      <div style="border:1px solid #151515;background:#fff;padding:28px">
        <p style="font-size:17px;line-height:1.6">Hello ${escapeHtml(speakerName)},</p>
        ${paragraphs}
      </div>
      <p style="font-size:14px;line-height:1.6">Questions? Reply to this message or contact <a href="mailto:info@sdlcai.org" style="color:#151515">info@sdlcai.org</a>.</p>
    </div>
  </body>
</html>`;
}

async function requestSpeakerLogin(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ error: "Request origin was not accepted." }, 403);
  }

  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  if (!env.EMAIL) {
    return json({ error: "Speaker sign-in email is not configured." }, 503);
  }

  const publicOrigin = parsePublicOrigin(env.PUBLIC_SITE_ORIGIN);

  if (!publicOrigin) {
    return json({ error: "Speaker sign-in is not configured." }, 503);
  }

  const turnstileConfigurationError =
    getSpeakerTurnstileConfigurationError(env);

  if (turnstileConfigurationError) return turnstileConfigurationError;

  const body = await readJsonWithinLimit(request, maxLoginBodyBytes);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Enter your speaker email address." }, 400);
  }

  const email = normalizeEmail(body.email);

  if (!isLikelyEmail(email)) {
    return json({ error: "Enter a valid email address." }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token =
      typeof body.turnstile_token === "string"
        ? body.turnstile_token.trim()
        : "";
    const outcome = await verifyTurnstile({
      expectedAction: speakerLoginTurnstileAction,
      expectedHostnames: getSpeakerTurnstileHostnames(env),
      request,
      secret: env.TURNSTILE_SECRET_KEY,
      token,
    });

    if (!outcome.success) {
      console.warn(
        JSON.stringify({
          errors: outcome["error-codes"] ?? [],
          hasToken: Boolean(token),
          hostname: outcome.hostname,
          message: "Speaker login Turnstile verification failed",
        }),
      );
      return json({ error: "Verification failed. Please try again." }, 400);
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const rateWindowStart = new Date(
    now.getTime() - loginRateWindowMilliseconds,
  ).toISOString();
  const cooldownStart = new Date(
    now.getTime() - loginCooldownMilliseconds,
  ).toISOString();
  const retentionStart = new Date(
    now.getTime() - loginRequestRetentionMilliseconds,
  ).toISOString();
  const emailFingerprint = await hashPrivateText(
    email,
    env.EMAIL_ENCRYPTION_KEY!,
    "email-hash",
  );
  const ipFingerprint = await hashPrivateText(
    request.headers.get("CF-Connecting-IP")?.trim() || "unknown",
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-login-ip",
  );

  await env.INTERESTS!.batch([
    env
      .INTERESTS!.prepare(
        "DELETE FROM speaker_login_requests WHERE created_at < ?1",
      )
      .bind(retentionStart),
    env
      .INTERESTS!.prepare(
        `DELETE FROM speaker_magic_links
          WHERE expires_at <= ?1
             OR (consumed_at IS NOT NULL AND consumed_at < ?2)`,
      )
      .bind(nowIso, retentionStart),
  ]);

  const [contact, emailRate, ipRate, recentDelivery] = await Promise.all([
    env
      .INTERESTS!.prepare(
        `SELECT
         contacts.email_ciphertext,
         contacts.email_iv,
         contacts.retention_until,
         contacts.delivery_status,
         access.speaker_id,
         access.access_generation,
         access.invite_expires_at
       FROM speaker_contacts AS contacts
       JOIN speaker_workspace_access AS access
         ON access.speaker_id = contacts.speaker_id
      WHERE contacts.email_fingerprint = ?1
        AND contacts.delivery_status = 'active'
        AND contacts.retention_until > ?2
        AND access.revoked_at IS NULL
        AND access.invite_expires_at > ?2
      LIMIT 1`,
      )
      .bind(emailFingerprint, nowIso)
      .first<SpeakerLoginContactRow>(),
    env
      .INTERESTS!.prepare(
        `SELECT COUNT(*) AS count
         FROM speaker_login_requests
        WHERE email_fingerprint = ?1 AND created_at >= ?2`,
      )
      .bind(emailFingerprint, rateWindowStart)
      .first<{ count: number }>(),
    env
      .INTERESTS!.prepare(
        `SELECT COUNT(*) AS count
         FROM speaker_login_requests
        WHERE ip_fingerprint = ?1 AND created_at >= ?2`,
      )
      .bind(ipFingerprint, rateWindowStart)
      .first<{ count: number }>(),
    env
      .INTERESTS!.prepare(
        `SELECT request_id
         FROM speaker_login_requests
        WHERE email_fingerprint = ?1
          AND outcome IN ('pending', 'sent')
          AND created_at >= ?2
        LIMIT 1`,
      )
      .bind(emailFingerprint, cooldownStart)
      .first<{ request_id: string }>(),
  ]);
  const throttled =
    (emailRate?.count ?? 0) >= maxLoginRequestsPerEmail ||
    (ipRate?.count ?? 0) >= maxLoginRequestsPerIp ||
    Boolean(recentDelivery);
  const requestId = crypto.randomUUID();

  if (!contact || throttled || !canonicalSpeakerIds.has(contact.speaker_id)) {
    await env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_login_requests (
         request_id,
         email_fingerprint,
         ip_fingerprint,
         outcome,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, 'suppressed', ?4, ?4)`,
      )
      .bind(requestId, emailFingerprint, ipFingerprint, nowIso)
      .run();

    return json({ accepted: true, message: genericLoginMessage }, 202);
  }

  const expiresAt = new Date(
    Math.min(
      now.getTime() + magicLinkLifetimeMilliseconds,
      Date.parse(contact.invite_expires_at),
    ),
  );

  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    await env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_login_requests (
         request_id,
         email_fingerprint,
         ip_fingerprint,
         outcome,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, 'suppressed', ?4, ?4)`,
      )
      .bind(requestId, emailFingerprint, ipFingerprint, nowIso)
      .run();
    return json({ accepted: true, message: genericLoginMessage }, 202);
  }

  const token = createToken();
  const tokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-magic-link-token",
  );

  await env.INTERESTS!.batch([
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_login_requests (
         request_id,
         email_fingerprint,
         ip_fingerprint,
         outcome,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, 'pending', ?4, ?4)`,
      )
      .bind(requestId, emailFingerprint, ipFingerprint, nowIso),
    env
      .INTERESTS!.prepare(
        `DELETE FROM speaker_magic_links
          WHERE speaker_id = ?1 AND consumed_at IS NULL`,
      )
      .bind(contact.speaker_id),
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_magic_links (
         token_hash,
         request_id,
         speaker_id,
         access_generation,
         created_at,
         expires_at,
         consumed_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)`,
      )
      .bind(
        tokenHash,
        requestId,
        contact.speaker_id,
        contact.access_generation,
        nowIso,
        expiresAt.toISOString(),
      ),
  ]);

  ctx.waitUntil(
    deliverSpeakerMagicLink({
      contact,
      env,
      expiresAt,
      publicOrigin,
      requestId,
      token,
      tokenHash,
    }),
  );

  return json({ accepted: true, message: genericLoginMessage }, 202);
}

async function deliverSpeakerMagicLink({
  contact,
  env,
  expiresAt,
  publicOrigin,
  requestId,
  token,
  tokenHash,
}: {
  contact: SpeakerLoginContactRow;
  env: Env;
  expiresAt: Date;
  publicOrigin: string;
  requestId: string;
  token: string;
  tokenHash: string;
}): Promise<void> {
  const speaker = await readCanonicalSpeaker(env, contact.speaker_id);

  if (!speaker) return;

  try {
    const email = await decryptPrivateText(
      contact.email_ciphertext,
      contact.email_iv,
      env.EMAIL_ENCRYPTION_KEY!,
    );
    const magicLinkUrl = `${publicOrigin}/speaker/#${token}`;

    await env.EMAIL!.send({
      from: { email: "info@sdlcai.org", name: "SDLCAI" },
      html: speakerMagicLinkHtml({
        expiresAt,
        magicLinkUrl,
        speakerName: speaker.content.profile.name,
      }),
      replyTo: "info@sdlcai.org",
      subject: "Sign in to your SDLCAI speaker workspace",
      text: speakerMagicLinkText({
        expiresAt,
        magicLinkUrl,
        speakerName: speaker.content.profile.name,
      }),
      to: email,
    });

    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_login_requests
          SET outcome = 'sent', updated_at = ?2
        WHERE request_id = ?1 AND outcome = 'pending'`,
      )
      .bind(requestId, new Date().toISOString())
      .run();
  } catch (error) {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown email error",
        message: "Speaker magic-link delivery failed",
        speakerId: contact.speaker_id,
      }),
    );
    const failedAt = new Date().toISOString();
    await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_login_requests
            SET outcome = 'failed', updated_at = ?2
          WHERE request_id = ?1`,
        )
        .bind(requestId, failedAt),
      env
        .INTERESTS!.prepare(
          "DELETE FROM speaker_magic_links WHERE token_hash = ?1",
        )
        .bind(tokenHash),
    ]);
  }
}

async function redeemSpeakerInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const token = readBearerToken(request);

  if (!token) {
    return json({ error: "This speaker sign-in link is invalid." }, 401);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const magicTokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-magic-link-token",
  );
  const magicLink = await env
    .INTERESTS!.prepare(
      `UPDATE speaker_magic_links
          SET consumed_at = ?2
        WHERE token_hash = ?1
          AND consumed_at IS NULL
          AND expires_at > ?2
      RETURNING speaker_id, access_generation`,
    )
    .bind(magicTokenHash, nowIso)
    .first<SpeakerMagicLinkRow>();
  let access: SpeakerAccessRow | null = null;

  if (magicLink) {
    access = await env
      .INTERESTS!.prepare(
        `SELECT speaker_id, access_generation, invite_expires_at
         FROM speaker_workspace_access
        WHERE speaker_id = ?1
          AND access_generation = ?2
          AND revoked_at IS NULL
          AND invite_expires_at > ?3`,
      )
      .bind(magicLink.speaker_id, magicLink.access_generation, nowIso)
      .first<SpeakerAccessRow>();
  }

  if (!access) {
    const invitationTokenHash = await hashToken(
      token,
      env.EMAIL_ENCRYPTION_KEY!,
      "speaker-workspace-invite-token",
    );
    access = await env
      .INTERESTS!.prepare(
        `SELECT speaker_id, access_generation, invite_expires_at
         FROM speaker_workspace_access
        WHERE invite_token_hash = ?1
          AND revoked_at IS NULL
          AND invite_expires_at > ?2`,
      )
      .bind(invitationTokenHash, nowIso)
      .first<SpeakerAccessRow>();
  }

  if (!access || !canonicalSpeakerIds.has(access.speaker_id)) {
    return json(
      { error: "This speaker sign-in link is invalid or expired." },
      401,
    );
  }

  const sessionToken = createToken();
  const sessionHash = await hashToken(
    sessionToken,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-session-token",
  );
  const inviteExpiry = Date.parse(access.invite_expires_at);
  const expiresAt = new Date(
    Math.min(now.getTime() + sessionLifetimeMilliseconds, inviteExpiry),
  );

  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    return json({ error: "This speaker sign-in link has expired." }, 401);
  }

  await env.INTERESTS!.batch([
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_workspace_sessions (
         token_hash,
         speaker_id,
         access_generation,
         created_at,
         last_seen_at,
         expires_at
       ) VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
      )
      .bind(
        sessionHash,
        access.speaker_id,
        access.access_generation,
        nowIso,
        expiresAt.toISOString(),
      ),
    env
      .INTERESTS!.prepare(
        `UPDATE speaker_contacts
          SET email_confirmed_at = COALESCE(email_confirmed_at, ?2),
              updated_at = ?2
        WHERE speaker_id = ?1`,
      )
      .bind(access.speaker_id, nowIso),
    env
      .INTERESTS!.prepare(
        "DELETE FROM speaker_workspace_sessions WHERE expires_at <= ?1",
      )
      .bind(nowIso),
  ]);

  const maxAgeSeconds = Math.max(
    1,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
  );
  const response = json({ authenticated: true });
  response.headers.append(
    "set-cookie",
    serializeSessionCookie(sessionToken, maxAgeSeconds),
  );

  return response;
}

async function endSpeakerSession(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ error: "Request origin was not accepted." }, 403);
  }

  const token = readCookie(request, speakerSessionCookie);

  if (
    token &&
    tokenPattern.test(token) &&
    env.EMAIL_ENCRYPTION_KEY &&
    env.INTERESTS
  ) {
    const tokenHash = await hashToken(
      token,
      env.EMAIL_ENCRYPTION_KEY,
      "speaker-workspace-session-token",
    );

    await env.INTERESTS.prepare(
      "DELETE FROM speaker_workspace_sessions WHERE token_hash = ?1",
    )
      .bind(tokenHash)
      .run();
  }

  const response = json({ authenticated: false });
  response.headers.append("set-cookie", clearSessionCookie());

  return response;
}

async function getSpeakerWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await authenticateSpeaker(request, env);

  if (session instanceof Response) return session;

  return json(await buildWorkspacePayload(session.speaker_id, env));
}

async function updateSpeakerWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ error: "Request origin was not accepted." }, 403);
  }

  const session = await authenticateSpeaker(request, env);

  if (session instanceof Response) return session;

  const body = await readJsonWithinLimit(request, maxWorkspaceBodyBytes);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Submit the workspace form again." }, 400);
  }

  const action = body.action;

  if (action !== "save" && action !== "submit") {
    return json(
      { error: "Choose whether to save or submit the changes." },
      400,
    );
  }

  const canonicalRecord = await readCanonicalSpeaker(env, session.speaker_id);

  if (!canonicalRecord) {
    return json({ error: "Speaker profile was not found." }, 404);
  }

  const canonical = canonicalRecord.content;
  const baseContentVersion =
    typeof body.base_content_version === "number"
      ? body.base_content_version
      : Number.NaN;

  if (baseContentVersion !== canonicalRecord.contentVersion) {
    return staleCanonicalResponse();
  }

  const validation = validateSpeakerWorkspaceContent(
    body.content,
    canonical.talks.map(({ id }) => id),
  );

  if (!validation.content) {
    return json(
      {
        error: "Review the highlighted fields.",
        field_errors: validation.errors,
      },
      400,
    );
  }

  const canonicalHash = await hashCanonicalContent(canonical);
  const now = new Date().toISOString();
  const pending = await env
    .INTERESTS!.prepare(
      `SELECT revision_id, state
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'submitted'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{
      revision_id: string;
      state: "submitted";
    }>();

  if (pending) {
    return json(
      {
        error:
          "Your submitted changes are awaiting organizer review. You can edit again after that review.",
      },
      409,
    );
  }

  const draft = await env
    .INTERESTS!.prepare(
      `SELECT revision_id, base_content_hash, base_content_version
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'draft'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{
      base_content_hash: string;
      base_content_version: number;
      revision_id: string;
    }>();

  if (
    draft &&
    (draft.base_content_hash !== canonicalHash ||
      draft.base_content_version !== canonicalRecord.contentVersion)
  ) {
    return json(
      {
        error:
          "The published profile changed after this draft began. Reload the workspace and review the latest version.",
      },
      409,
    );
  }

  const revisionId = draft?.revision_id ?? crypto.randomUUID();
  const contentJson = JSON.stringify(validation.content);

  if (draft) {
    const result = await env
      .INTERESTS!.prepare(
        `UPDATE speaker_content_revisions
          SET content_json = ?2,
              state = ?3,
              submitted_at = CASE WHEN ?3 = 'submitted' THEN ?4 ELSE NULL END,
              updated_at = ?4
        WHERE revision_id = ?1
          AND state = 'draft'
          AND base_content_version = ?5
          AND EXISTS (
            SELECT 1 FROM canonical_speaker_content
             WHERE speaker_id = ?6 AND content_version = ?5
          )`,
      )
      .bind(
        revisionId,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        now,
        baseContentVersion,
        session.speaker_id,
      )
      .run();

    if (result.meta.changes !== 1) return staleCanonicalResponse();
  } else {
    const result = await env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_content_revisions (
         revision_id,
         speaker_id,
         base_content_hash,
         base_content_version,
         content_json,
         state,
         submitted_at,
         created_at,
         updated_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8
         FROM canonical_speaker_content
        WHERE speaker_id = ?2 AND content_version = ?4`,
      )
      .bind(
        revisionId,
        session.speaker_id,
        canonicalHash,
        baseContentVersion,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        action === "submit" ? now : null,
        now,
      )
      .run();

    if (result.meta.changes !== 1) return staleCanonicalResponse();
  }

  return json({
    ...(await buildWorkspacePayload(session.speaker_id, env)),
    message:
      action === "submit"
        ? "Changes submitted for organizer review."
        : "Draft saved.",
  });
}

async function getSpeakerDinner(
  speakerId: string,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;
  const row = await env
    .INTERESTS!.prepare(
      `SELECT
       speaker_id,
       response_ciphertext,
       response_iv,
       consent_text,
       expires_at,
       responded_at,
       updated_at
     FROM speaker_dinner_responses
    WHERE speaker_id = ?1
    LIMIT 1`,
    )
    .bind(speakerId)
    .first<SpeakerDinnerRow>();
  let response: SpeakerDinnerResponseData | null = null;

  if (row) {
    try {
      response = await decryptSpeakerDinnerResponse(row, env);
    } catch {
      console.error(
        JSON.stringify({
          message: "Unable to decrypt speaker dinner response",
          speakerId,
        }),
      );
      return json({ error: "Your dinner response could not be loaded." }, 500);
    }
  }

  return json({
    closed: Date.now() > configuration.deadline,
    consent_text: speakerDinnerConsentText,
    deadline: new Date(configuration.deadline).toISOString(),
    responded_at: row?.responded_at ?? null,
    response,
  });
}

async function updateSpeakerDinner(
  request: Request,
  speakerId: string,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;

  if (Date.now() > configuration.deadline) {
    return json(
      { error: "The speaker dinner response deadline has passed." },
      410,
    );
  }

  const body = await readJsonWithinLimit(request, maxDinnerBodyBytes);

  if (body instanceof Response) return body;

  const response = validateSpeakerDinnerResponse(body);

  if (response instanceof Response) return response;

  const encryptedResponse = await encryptPrivateText(
    JSON.stringify(response),
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const hiddenDinnerTokenHash = await hashToken(
    createToken(),
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-dinner-invite-token",
  );
  const respondedAt = new Date().toISOString();

  await env
    .INTERESTS!.prepare(
      `INSERT INTO speaker_dinner_responses (
       speaker_id,
       token_hash,
       response_ciphertext,
       response_iv,
       consent_text,
       created_at,
       expires_at,
       responded_at,
       updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, ?6)
     ON CONFLICT (speaker_id) DO UPDATE SET
       response_ciphertext = excluded.response_ciphertext,
       response_iv = excluded.response_iv,
       consent_text = excluded.consent_text,
       expires_at = excluded.expires_at,
       responded_at = excluded.responded_at,
       updated_at = excluded.updated_at`,
    )
    .bind(
      speakerId,
      hiddenDinnerTokenHash,
      encryptedResponse.ciphertext,
      encryptedResponse.iv,
      speakerDinnerConsentText,
      respondedAt,
      new Date(configuration.retention).toISOString(),
    )
    .run();

  return json({
    closed: false,
    consent_text: speakerDinnerConsentText,
    deadline: new Date(configuration.deadline).toISOString(),
    message: "Your dinner response has been saved.",
    responded_at: respondedAt,
    response,
  });
}

function validateSpeakerDinnerResponse(
  value: unknown,
): SpeakerDinnerResponseData | Response {
  if (!isRecord(value) || value.consent !== true) {
    return json({ error: "Consent is required to save dinner details." }, 400);
  }

  if (
    value.attendance !== "attending" &&
    value.attendance !== "not_attending"
  ) {
    return json({ error: "Tell us whether you can attend." }, 400);
  }

  if (value.attendance === "not_attending") {
    return {
      attendance: "not_attending",
      cross_contamination: "",
      food_requirements: "",
      meal_preference: "",
    };
  }

  const mealPreference = value.meal_preference;
  const crossContamination = value.cross_contamination;
  const foodRequirements =
    typeof value.food_requirements === "string"
      ? value.food_requirements.trim()
      : "";

  if (
    mealPreference !== "omnivore" &&
    mealPreference !== "vegetarian" &&
    mealPreference !== "vegan" &&
    mealPreference !== "other"
  ) {
    return json({ error: "Choose a meal preference." }, 400);
  }

  if (
    crossContamination !== "yes" &&
    crossContamination !== "no" &&
    crossContamination !== "unsure"
  ) {
    return json(
      { error: "Tell us whether cross-contamination is a concern." },
      400,
    );
  }

  if (foodRequirements.length > 800) {
    return json(
      { error: "Keep food requirements to 800 characters or fewer." },
      400,
    );
  }

  return {
    attendance: "attending",
    cross_contamination: crossContamination,
    food_requirements: foodRequirements,
    meal_preference: mealPreference,
  };
}

async function decryptSpeakerDinnerResponse(
  row: SpeakerDinnerRow,
  env: Env,
): Promise<SpeakerDinnerResponseData | null> {
  if (row.response_ciphertext === null && row.response_iv === null) return null;

  if (row.response_ciphertext === null || row.response_iv === null) {
    throw new Error("Encrypted speaker dinner response is incomplete");
  }

  const plaintext = await decryptPrivateText(
    row.response_ciphertext,
    row.response_iv,
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const candidate: unknown = JSON.parse(plaintext);

  if (!isSpeakerDinnerResponseData(candidate)) {
    throw new Error("Encrypted speaker dinner response is invalid");
  }

  return candidate;
}

function isSpeakerDinnerResponseData(
  candidate: unknown,
): candidate is SpeakerDinnerResponseData {
  if (!isRecord(candidate)) return false;

  const attendance = candidate.attendance;
  const mealPreference = candidate.meal_preference;
  const crossContamination = candidate.cross_contamination;

  return (
    (attendance === "attending" || attendance === "not_attending") &&
    (mealPreference === "" ||
      mealPreference === "omnivore" ||
      mealPreference === "vegetarian" ||
      mealPreference === "vegan" ||
      mealPreference === "other") &&
    (crossContamination === "" ||
      crossContamination === "yes" ||
      crossContamination === "no" ||
      crossContamination === "unsure") &&
    typeof candidate.food_requirements === "string"
  );
}

async function authenticateSpeaker(
  request: Request,
  env: Env,
): Promise<SpeakerSessionRow | Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const token = readCookie(request, speakerSessionCookie);

  if (!token || !tokenPattern.test(token)) {
    return json({ error: "Sign in with your speaker invitation." }, 401);
  }

  const tokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-session-token",
  );
  const now = new Date().toISOString();
  const session = await env
    .INTERESTS!.prepare(
      `SELECT
       sessions.token_hash,
       sessions.speaker_id,
       sessions.access_generation,
       sessions.expires_at,
       access.invite_expires_at
     FROM speaker_workspace_sessions AS sessions
     JOIN speaker_workspace_access AS access
       ON access.speaker_id = sessions.speaker_id
      AND access.access_generation = sessions.access_generation
    WHERE sessions.token_hash = ?1
      AND sessions.expires_at > ?2
      AND access.invite_expires_at > ?2
      AND access.revoked_at IS NULL`,
    )
    .bind(tokenHash, now)
    .first<SpeakerSessionRow>();

  if (!session || !canonicalSpeakerIds.has(session.speaker_id)) {
    const response = json({ error: "Your speaker session has expired." }, 401);
    response.headers.append("set-cookie", clearSessionCookie());

    return response;
  }

  await env
    .INTERESTS!.prepare(
      `UPDATE speaker_workspace_sessions
        SET last_seen_at = ?2
      WHERE token_hash = ?1`,
    )
    .bind(tokenHash, now)
    .run();

  return session;
}

async function buildWorkspacePayload(
  speakerId: string,
  env: Env,
): Promise<Record<string, unknown>> {
  const canonicalRecord = await readCanonicalSpeaker(env, speakerId);

  if (!canonicalRecord) {
    throw new Error(`Canonical speaker content is missing for ${speakerId}.`);
  }

  const canonical = canonicalRecord.content;
  const revision = await env
    .INTERESTS!.prepare(
      `SELECT
       revision_id,
       base_content_hash,
       base_content_version,
       content_json,
       state,
       submitted_at,
       updated_at
     FROM speaker_content_revisions
    WHERE speaker_id = ?1 AND state IN ('draft', 'submitted')
    ORDER BY CASE state WHEN 'submitted' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1`,
    )
    .bind(speakerId)
    .first<SpeakerRevisionRow>();
  let content = canonical;

  if (revision) {
    try {
      const parsed = JSON.parse(revision.content_json) as unknown;
      const validated = validateSpeakerWorkspaceContent(
        parsed,
        canonical.talks.map(({ id }) => id),
      );

      if (validated.content) {
        content = validated.content;
      }
    } catch {
      console.error("Invalid stored speaker revision", {
        revisionId: revision.revision_id,
        speakerId,
      });
    }
  }

  return {
    authenticated: true,
    canonical,
    canonical_version: canonicalRecord.contentVersion,
    content,
    immutable: {
      photo: getCanonicalPhotoUrl(canonicalRecord),
      speaker_id: speakerId,
      talk_ids: canonical.talks.map(({ id }) => id),
      workspace_only: workspaceOnlySpeakerIds.has(speakerId),
    },
    revision: revision
      ? {
          revision_id: revision.revision_id,
          state: revision.state,
          submitted_at: revision.submitted_at,
          updated_at: revision.updated_at,
        }
      : null,
  };
}

function serializeAdminRevision(
  revision: SpeakerAdminRevisionRow,
  canonical: SpeakerWorkspaceContent,
): Record<string, unknown> {
  let proposed: SpeakerWorkspaceContent | null = null;

  try {
    const validation = validateSpeakerWorkspaceContent(
      JSON.parse(revision.content_json) as unknown,
      canonical.talks.map(({ id }) => id),
    );
    proposed = validation.content ?? null;
  } catch {
    proposed = null;
  }

  return {
    base_content_hash: revision.base_content_hash,
    base_content_version: revision.base_content_version,
    changed_fields: proposed ? getChangedFields(canonical, proposed) : [],
    content: proposed,
    review_note: revision.review_note,
    reviewed_at: revision.reviewed_at,
    revision_id: revision.revision_id,
    state: revision.state,
    submitted_at: revision.submitted_at,
    updated_at: revision.updated_at,
  };
}

function getChangedFields(
  canonical: SpeakerWorkspaceContent,
  proposed: SpeakerWorkspaceContent,
): Array<{ before: string; field: string; value: string }> {
  const changes: Array<{ before: string; field: string; value: string }> = [];

  for (const field of ["name", "role", "bio", ...socialFields] as const) {
    if (canonical.profile[field] !== proposed.profile[field]) {
      changes.push({
        before: canonical.profile[field],
        field: `profile.${field}`,
        value: proposed.profile[field],
      });
    }
  }

  const canonicalTalks = new Map(
    canonical.talks.map((talk) => [talk.id, talk]),
  );

  for (const talk of proposed.talks) {
    const current = canonicalTalks.get(talk.id);

    if (!current) continue;

    for (const field of ["title", "abstract"] as const) {
      if (current[field] !== talk[field]) {
        changes.push({
          before: current[field],
          field: `talks.${talk.id}.${field}`,
          value: talk[field],
        });
      }
    }
  }

  return changes;
}

export function validateSpeakerWorkspaceContent(
  value: unknown,
  assignedTalkIds: readonly string[],
): ValidationResult {
  const errors: Record<string, string> = {};

  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !Array.isArray(value.talks)
  ) {
    return {
      errors: { form: "The submitted profile is incomplete." },
    };
  }

  const profileValue = value.profile;
  const name = validateText(profileValue.name, "profile.name", 2, 120, errors);
  const role = validateText(profileValue.role, "profile.role", 2, 160, errors);
  const bio = validateText(profileValue.bio, "profile.bio", 40, 2_000, errors);

  if (bio) validateMarkdown(bio, "profile.bio", errors);

  const profile = {
    bio,
    devto: "",
    github: "",
    linkedin: "",
    name,
    role,
    scholar: "",
    website: "",
    x: "",
  } satisfies SpeakerProfileContent;

  for (const field of socialFields) {
    profile[field] = validateSocialUrl(profileValue[field], field, errors);
  }

  const assigned = new Set(assignedTalkIds);
  const received = new Set<string>();
  const talks: SpeakerTalkContent[] = [];

  for (const [index, talkValue] of value.talks.entries()) {
    const prefix = `talks.${index}`;

    if (!isRecord(talkValue) || typeof talkValue.id !== "string") {
      errors[`${prefix}.id`] = "Talk assignment was not recognized.";
      continue;
    }

    const id = talkValue.id.trim();

    if (!assigned.has(id) || received.has(id)) {
      errors[`${prefix}.id`] = "Talk assignment was not recognized.";
      continue;
    }

    received.add(id);
    const title = validateText(
      talkValue.title,
      `${prefix}.title`,
      4,
      200,
      errors,
    );
    const abstract = validateText(
      talkValue.abstract,
      `${prefix}.abstract`,
      20,
      2_500,
      errors,
    );

    if (abstract) validateMarkdown(abstract, `${prefix}.abstract`, errors);

    talks.push({ abstract, id, title });
  }

  for (const talkId of assigned) {
    if (!received.has(talkId)) {
      errors.talks = "Every assigned talk must be included.";
      break;
    }
  }

  if (received.size !== assigned.size) {
    errors.talks ??= "Talk assignments cannot be changed.";
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : { content: { profile, talks }, errors };
}

function validateText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
  errors: Record<string, string>,
): string {
  if (typeof value !== "string") {
    errors[field] = "This field is required.";
    return "";
  }

  const normalized = value.trim().replace(/\r\n?/gu, "\n");

  if (normalized.length < minLength || normalized.length > maxLength) {
    errors[field] =
      `Use between ${minLength} and ${maxLength.toLocaleString("en")} characters.`;
  }

  return normalized;
}

function validateMarkdown(
  value: string,
  field: string,
  errors: Record<string, string>,
): void {
  if (/<[A-Za-z!/][^>]*>/u.test(value) || /!\[[^\]]*\]\s*\(/u.test(value)) {
    errors[field] = "HTML and embedded images are not supported.";
    return;
  }

  const markdownLinkPattern =
    /\[[^\]]+\]\s*\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;

  for (const match of value.matchAll(markdownLinkPattern)) {
    if (!parseHttpsUrl(match[1])) {
      errors[field] = "Markdown links must use complete HTTPS URLs.";
      return;
    }
  }
}

function validateSocialUrl(
  value: unknown,
  field: SocialField,
  errors: Record<string, string>,
): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value !== "string") {
    errors[`profile.${field}`] = "Enter a complete HTTPS URL.";
    return "";
  }

  const normalized = value.trim();

  if (normalized.length > 2_048) {
    errors[`profile.${field}`] = "URL is too long.";
    return normalized;
  }

  const url = parseHttpsUrl(normalized);

  if (!url) {
    errors[`profile.${field}`] = "Enter a complete HTTPS URL.";
    return normalized;
  }

  if (
    field !== "website" &&
    !socialHosts[field].has(url.hostname.toLowerCase())
  ) {
    errors[`profile.${field}`] = `Enter a ${socialLabel(field)} profile URL.`;
  }

  return url.toString();
}

function socialLabel(field: Exclude<SocialField, "website">): string {
  return {
    devto: "DEV Community",
    github: "GitHub",
    linkedin: "LinkedIn",
    scholar: "Google Scholar",
    x: "X or Twitter",
  }[field];
}

function parseHttpsUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.username || url.password) return null;

    return url;
  } catch {
    return null;
  }
}

function requireAdminMutation(
  request: Request,
  expectedAction: string,
): Response | null {
  if (
    isSameOriginMutation(request) &&
    request.headers.get("x-admin-action") === expectedAction
  ) {
    return null;
  }

  return json({ error: "Admin action could not be verified." }, 403);
}

function staleCanonicalResponse(): Response {
  return json(
    {
      error:
        "The published profile changed while this editor was open. Reload and review the latest details.",
    },
    409,
  );
}

function parseFutureConfigurationDate(value: string | undefined): Date | null {
  if (!value) return null;

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return null;

  return new Date(timestamp);
}

function parsePublicOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getSpeakerDinnerConfiguration(
  env: Env,
): { deadline: number; retention: number } | null {
  const deadline = Date.parse(env.SPEAKER_DINNER_RESPONSE_DEADLINE ?? "");
  const retention = Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL ?? "");

  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(retention) ||
    retention <= deadline
  ) {
    return null;
  }

  return { deadline, retention };
}

function getSpeakerDinnerConfigurationError(env: Env): Response | null {
  const workspaceError = getConfigurationError(env);

  if (workspaceError) return workspaceError;

  if (!getSpeakerDinnerConfiguration(env)) {
    return json(
      { error: "The speaker dinner response period is not configured." },
      503,
    );
  }

  return null;
}

function getSpeakerTurnstileHostnames(env: Env): Set<string> {
  return new Set(
    (env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map(normalizeHostname)
      .filter(Boolean),
  );
}

function getSpeakerTurnstileConfigurationError(env: Env): Response | null {
  const hasSiteKey = Boolean(
    env.TURNSTILE_SITE_KEY?.trim() &&
    env.TURNSTILE_SITE_KEY !== "__TURNSTILE_SITE_KEY__",
  );
  const hasSecretKey = Boolean(env.TURNSTILE_SECRET_KEY?.trim());

  if (hasSiteKey !== hasSecretKey) {
    return json({ error: "Verification is not configured." }, 503);
  }

  if (hasSecretKey && getSpeakerTurnstileHostnames(env).size === 0) {
    return json({ error: "Verification is not configured." }, 503);
  }

  return null;
}

function isLikelyEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) &&
    !/[\r\n]/u.test(value)
  );
}

function speakerInvitationText({
  expiresAt,
  invitationUrl,
  speakerName,
}: {
  expiresAt: Date;
  invitationUrl: string;
  speakerName: string;
}): string {
  return [
    `Hello ${speakerName},`,
    "",
    "Your private SDLCAI speaker workspace is ready. Use it to review and suggest updates to your public profile, social links, talk title, and talk description, and to access your promotion graphics.",
    "",
    invitationUrl,
    "",
    `The link remains valid until ${formatEmailDate(expiresAt)}. Keep it private: anyone with the link can open your workspace.`,
    "",
    "Submitted updates are reviewed by the SDLCAI organizer before publication.",
    "",
    "Questions? Reply to this message or contact info@sdlcai.org.",
    "",
    "SDLCAI",
  ].join("\n");
}

function speakerMagicLinkText({
  expiresAt,
  magicLinkUrl,
  speakerName,
}: {
  expiresAt: Date;
  magicLinkUrl: string;
  speakerName: string;
}): string {
  return [
    `Hello ${speakerName},`,
    "",
    "Use this one-time link to sign in to your private SDLCAI speaker workspace:",
    "",
    magicLinkUrl,
    "",
    `The link expires at ${formatEmailDateTime(expiresAt)}. If you did not request it, you can ignore this message.`,
    "",
    "In the workspace you can update your profile, talk details, dinner response, promotion graphics, portrait, and topic video.",
    "",
    "Questions? Reply to this message or contact info@sdlcai.org.",
    "",
    "SDLCAI",
  ].join("\n");
}

function speakerMagicLinkHtml({
  expiresAt,
  magicLinkUrl,
  speakerName,
}: {
  expiresAt: Date;
  magicLinkUrl: string;
  speakerName: string;
}): string {
  const safeName = escapeHtml(speakerName);
  const safeUrl = escapeHtml(magicLinkUrl);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3efe7;color:#151515;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:13px;font-weight:700;text-transform:uppercase">SDLCAI / Speaker sign-in</p>
      <div style="border:1px solid #151515;background:#fff;padding:28px">
        <h1 style="margin:0 0 20px;font-size:32px;line-height:1;text-transform:uppercase">Your sign-in link</h1>
        <p style="font-size:17px;line-height:1.6">Hello ${safeName},</p>
        <p style="font-size:17px;line-height:1.6">Open your private workspace to update your profile, talk, dinner response, and promotion material.</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#151515;color:#fff;padding:14px 20px;font-weight:700;text-decoration:none;text-transform:uppercase">Sign in to speaker workspace</a></p>
        <p style="font-size:14px;line-height:1.6;color:#5d5d5d">This one-time link expires at ${escapeHtml(formatEmailDateTime(expiresAt))}. If you did not request it, you can ignore this message.</p>
      </div>
      <p style="font-size:14px;line-height:1.6">Questions? Reply to this message or contact <a href="mailto:info@sdlcai.org" style="color:#151515">info@sdlcai.org</a>.</p>
    </div>
  </body>
</html>`;
}

function speakerInvitationHtml({
  expiresAt,
  invitationUrl,
  speakerName,
}: {
  expiresAt: Date;
  invitationUrl: string;
  speakerName: string;
}): string {
  const safeName = escapeHtml(speakerName);
  const safeUrl = escapeHtml(invitationUrl);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3efe7;color:#151515;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:13px;font-weight:700;text-transform:uppercase">SDLCAI / Speaker workspace</p>
      <div style="border:1px solid #151515;background:#fff;padding:28px">
        <h1 style="margin:0 0 20px;font-size:32px;line-height:1;text-transform:uppercase">Your workspace is ready</h1>
        <p style="font-size:17px;line-height:1.6">Hello ${safeName},</p>
        <p style="font-size:17px;line-height:1.6">Review your public profile, social links, talk details, and promotion graphics in one private place.</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#151515;color:#fff;padding:14px 20px;font-weight:700;text-decoration:none;text-transform:uppercase">Open speaker workspace</a></p>
        <p style="font-size:14px;line-height:1.6;color:#5d5d5d">This private link remains valid until ${escapeHtml(formatEmailDate(expiresAt))}. Anyone with the link can open your workspace, so please do not forward it.</p>
        <p style="font-size:14px;line-height:1.6;color:#5d5d5d">Submitted updates are reviewed by the SDLCAI organizer before publication.</p>
      </div>
      <p style="font-size:14px;line-height:1.6">Questions? Reply to this message or contact <a href="mailto:info@sdlcai.org" style="color:#151515">info@sdlcai.org</a>.</p>
    </div>
  </body>
</html>`;
}

function formatEmailDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeZone: "Europe/Helsinki",
  }).format(value);
}

function formatEmailDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Helsinki",
  }).format(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

async function encryptPrivateText(
  value: string,
  keyMaterial: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importPrivateAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

async function decryptPrivateText(
  ciphertext: string,
  iv: string,
  keyMaterial: string,
): Promise<string> {
  const key = await importPrivateAesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { iv: base64Decode(iv), name: "AES-GCM" },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

async function importPrivateAesKey(keyMaterial: string): Promise<CryptoKey> {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`email-encryption:${keyMaterial}`),
  );

  return crypto.subtle.importKey("raw", derived, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

function hashPrivateText(
  value: string,
  keyMaterial: string,
  purpose: string,
): Promise<string> {
  return hashToken(value, keyMaterial, purpose);
}

export async function purgeExpiredSpeakerWorkspaceData(
  env: Env,
): Promise<void> {
  if (!env.INTERESTS) return;

  const now = new Date();
  const nowIso = now.toISOString();
  const retentionStart = new Date(
    now.getTime() - loginRequestRetentionMilliseconds,
  ).toISOString();

  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      "DELETE FROM speaker_workspace_sessions WHERE expires_at <= ?1",
    ).bind(nowIso),
    env.INTERESTS.prepare(
      `DELETE FROM speaker_magic_links
          WHERE expires_at <= ?1
             OR (consumed_at IS NOT NULL AND consumed_at < ?2)`,
    ).bind(nowIso, retentionStart),
    env.INTERESTS.prepare(
      "DELETE FROM speaker_login_requests WHERE created_at < ?1",
    ).bind(retentionStart),
  ]);
}

function getConfigurationError(env: Env): Response | null {
  if (!env.INTERESTS) {
    return json({ error: "Speaker workspace storage is not configured." }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return json(
      { error: "Speaker workspace encryption is not configured." },
      503,
    );
  }

  return null;
}

function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);

  return match?.[1] ?? null;
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");

    if (separator === -1) continue;

    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }

  return null;
}

function serializeSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${speakerSessionCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie(): string {
  return `${speakerSessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return base64UrlEncode(bytes);
}

async function hashToken(
  token: string,
  keyMaterial: string,
  purpose: string,
): Promise<string> {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${keyMaterial}`),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );

  return base64Encode(new Uint8Array(signature));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

async function readJsonWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    return json({ error: "Submit the workspace form again." }, 415);
  }

  const contentLength = request.headers.get("content-length");

  if (
    contentLength &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    return json({ error: "Submission is too large." }, 413);
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        totalBytes += value.byteLength;

        if (totalBytes > maxBytes) {
          await reader.cancel();
          return json({ error: "Submission is too large." }, 413);
        }

        chunks.push(value);
      }
    } catch {
      return json({ error: "Submit the workspace form again." }, 400);
    } finally {
      reader.releaseLock();
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return json({ error: "Submit the workspace form again." }, 400);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function secure(response: Response): Response {
  return withSpeakerWorkspaceSecurityHeaders(response);
}

function adminSecure(response: Response): Response {
  const secured = withSpeakerWorkspaceSecurityHeaders(response);
  const headers = new Headers(secured.headers);
  const vary = headers.get("vary");

  if (
    !vary
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "authorization")
  ) {
    headers.append("vary", "Authorization");
  }

  return new Response(secured.body, {
    headers,
    status: secured.status,
    statusText: secured.statusText,
  });
}
