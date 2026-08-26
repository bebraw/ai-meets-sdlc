import scheduleData from "../site/data/schedule.json" with { type: "json" };
import speakersData from "../site/data/speakers.json" with { type: "json" };

type SocialField =
  | "website"
  | "linkedin"
  | "x"
  | "github"
  | "devto"
  | "scholar";

interface CanonicalSpeaker {
  bio: string;
  devto?: string;
  github?: string;
  id: string;
  linkedin?: string;
  name: string;
  photo: string;
  role: string;
  scholar?: string;
  website?: string;
  x?: string;
}

interface CanonicalTalk {
  abstract: string;
  id: string;
  speakers: string[];
  title: string;
}

interface ScheduleItem {
  talks?: CanonicalTalk[];
}

interface SpeakerProfileContent {
  bio: string;
  devto: string;
  github: string;
  linkedin: string;
  name: string;
  role: string;
  scholar: string;
  website: string;
  x: string;
}

interface SpeakerTalkContent {
  abstract: string;
  id: string;
  title: string;
}

export interface SpeakerWorkspaceContent {
  profile: SpeakerProfileContent;
  talks: SpeakerTalkContent[];
}

interface SpeakerAccessRow {
  access_generation: number;
  invite_expires_at: string;
  speaker_id: string;
}

interface SpeakerSessionRow extends SpeakerAccessRow {
  expires_at: string;
  token_hash: string;
}

interface SpeakerRevisionRow {
  base_content_hash: string;
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

interface ValidationResult {
  content?: SpeakerWorkspaceContent;
  errors: Record<string, string>;
}

const speakerSessionCookie = "__Host-sdlcai-speaker-session";
const maxWorkspaceBodyBytes = 24 * 1024;
const sessionLifetimeMilliseconds = 14 * 24 * 60 * 60 * 1000;
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
const canonicalSpeakers = speakersData.items as CanonicalSpeaker[];
const canonicalTalks = (scheduleData.items as ScheduleItem[]).flatMap(
  ({ talks = [] }) => talks,
);

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
): Promise<Response | null> {
  const url = new URL(request.url);

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

  if (url.pathname === "/api/admin/speakers/review") {
    if (request.method !== "POST") {
      return adminSecure(json({ error: "Method not allowed" }, 405));
    }

    const forbidden = requireAdminMutation(request, "review-speaker-revision");

    if (forbidden) return adminSecure(forbidden);

    return adminSecure(await reviewSpeakerRevision(request, env));
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

  const [contactResult, accessResult, revisionResult] = await Promise.all([
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
          WHEN 'approved' THEN 1
          WHEN 'draft' THEN 2
          ELSE 3
        END,
        updated_at DESC`,
      )
      .all<SpeakerAdminRevisionRow>(),
  ]);
  const contacts = new Map(
    contactResult.results.map((contact) => [contact.speaker_id, contact]),
  );
  const access = new Map(
    accessResult.results.map((item) => [item.speaker_id, item]),
  );
  const revisions = new Map<string, SpeakerAdminRevisionRow>();

  for (const revision of revisionResult.results) {
    if (!revisions.has(revision.speaker_id)) {
      revisions.set(revision.speaker_id, revision);
    }
  }

  const speakers = await Promise.all(
    canonicalSpeakers.map(async (speaker) => {
      const contact = contacts.get(speaker.id);
      const invitation = access.get(speaker.id);
      const revision = revisions.get(speaker.id);
      const canonical = getCanonicalContent(speaker.id)!;
      let email: string | null = null;

      if (contact) {
        try {
          email = await decryptPrivateText(
            contact.email_ciphertext,
            contact.email_iv,
            env.EMAIL_ENCRYPTION_KEY!,
          );
        } catch {
          console.error("Unable to decrypt speaker contact", {
            speakerId: speaker.id,
          });
        }
      }

      return {
        canonical,
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
        invitation: invitation
          ? {
              active:
                invitation.revoked_at === null &&
                Date.parse(invitation.invite_expires_at) > Date.now(),
              expires_at: invitation.invite_expires_at,
              last_sent_at: invitation.last_sent_at,
            }
          : null,
        name: speaker.name,
        revision: revision ? serializeAdminRevision(revision, canonical) : null,
        speaker_id: speaker.id,
      };
    }),
  );

  return json({ count: speakers.length, speakers });
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
  const speaker = findCanonicalSpeaker(speakerId);
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
        speakerName: speaker.name,
      }),
      replyTo: "info@sdlcai.org",
      subject: "Your SDLCAI speaker workspace",
      text: speakerInvitationText({
        expiresAt: accessUntil,
        invitationUrl,
        speakerName: speaker.name,
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
    message: `Invitation sent to ${speaker.name}.`,
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

  const canonical = getCanonicalContent(revision.speaker_id);

  if (!canonical) {
    return json({ error: "The speaker profile no longer exists." }, 409);
  }

  if ((await hashCanonicalContent(canonical)) !== revision.base_content_hash) {
    return json(
      {
        error:
          "The public profile changed after this revision was submitted. Reconcile it before reviewing.",
      },
      409,
    );
  }

  const now = new Date().toISOString();

  if (decision === "approve") {
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_content_revisions
          SET state = 'approved',
              reviewed_at = ?2,
              reviewed_by = 'admin',
              review_note = ?3,
              updated_at = ?2
        WHERE revision_id = ?1 AND state = 'submitted'`,
      )
      .bind(revisionId, now, reviewNote || null)
      .run();
  } else {
    await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
            SET state = 'rejected',
                reviewed_at = ?2,
                reviewed_by = 'admin',
                review_note = ?3,
                updated_at = ?2
          WHERE revision_id = ?1 AND state = 'submitted'`,
        )
        .bind(revisionId, now, reviewNote),
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_content_revisions (
           revision_id,
           speaker_id,
           base_content_hash,
           content_json,
           state,
           created_at,
           updated_at
         ) VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?5)`,
        )
        .bind(
          crypto.randomUUID(),
          revision.speaker_id,
          revision.base_content_hash,
          revision.content_json,
          now,
        ),
    ]);
  }

  return json({
    decision,
    message:
      decision === "approve"
        ? "Revision approved. Apply the approved JSON to Git before publishing."
        : "Changes requested. The speaker can edit the returned draft.",
    revision_id: revisionId,
    speaker_id: revision.speaker_id,
  });
}

async function redeemSpeakerInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const token = readBearerToken(request);

  if (!token) {
    return json({ error: "This speaker invitation is invalid." }, 401);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const tokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-invite-token",
  );
  const access = await env
    .INTERESTS!.prepare(
      `SELECT speaker_id, access_generation, invite_expires_at
       FROM speaker_workspace_access
      WHERE invite_token_hash = ?1
        AND revoked_at IS NULL
        AND invite_expires_at > ?2`,
    )
    .bind(tokenHash, nowIso)
    .first<SpeakerAccessRow>();

  if (!access || !findCanonicalSpeaker(access.speaker_id)) {
    return json(
      { error: "This speaker invitation is invalid or expired." },
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
    return json({ error: "This speaker invitation has expired." }, 401);
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

  const canonical = getCanonicalContent(session.speaker_id);

  if (!canonical) {
    return json({ error: "Speaker profile was not found." }, 404);
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
      `SELECT revision_id, content_json, state
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state IN ('submitted', 'approved')
      ORDER BY CASE state WHEN 'submitted' THEN 0 ELSE 1 END
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{
      content_json: string;
      revision_id: string;
      state: "approved" | "submitted";
    }>();
  let pendingBlocksEditing = Boolean(pending);

  if (pending?.state === "approved") {
    try {
      const approvedValidation = validateSpeakerWorkspaceContent(
        JSON.parse(pending.content_json) as unknown,
        canonical.talks.map(({ id }) => id),
      );

      pendingBlocksEditing =
        !approvedValidation.content ||
        (await hashCanonicalContent(approvedValidation.content)) !==
          canonicalHash;
    } catch {
      pendingBlocksEditing = true;
    }
  }

  if (pendingBlocksEditing) {
    return json(
      {
        error:
          pending?.state === "approved"
            ? "Your changes are approved and awaiting publication. You can edit again after the updated profile is live."
            : "Your submitted changes are awaiting organizer review. You can edit again after that review.",
      },
      409,
    );
  }

  const draft = await env
    .INTERESTS!.prepare(
      `SELECT revision_id, base_content_hash
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'draft'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{ base_content_hash: string; revision_id: string }>();

  if (draft && draft.base_content_hash !== canonicalHash) {
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
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_content_revisions
          SET content_json = ?2,
              state = ?3,
              submitted_at = CASE WHEN ?3 = 'submitted' THEN ?4 ELSE NULL END,
              updated_at = ?4
        WHERE revision_id = ?1 AND state = 'draft'`,
      )
      .bind(
        revisionId,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        now,
      )
      .run();
  } else {
    await env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_content_revisions (
         revision_id,
         speaker_id,
         base_content_hash,
         content_json,
         state,
         submitted_at,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      )
      .bind(
        revisionId,
        session.speaker_id,
        canonicalHash,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        action === "submit" ? now : null,
        now,
      )
      .run();
  }

  return json({
    ...(await buildWorkspacePayload(session.speaker_id, env)),
    message:
      action === "submit"
        ? "Changes submitted for organizer review."
        : "Draft saved.",
  });
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

  if (!session || !findCanonicalSpeaker(session.speaker_id)) {
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
  const speaker = findCanonicalSpeaker(speakerId)!;
  const canonical = getCanonicalContent(speakerId)!;
  const revision = await env
    .INTERESTS!.prepare(
      `SELECT
       revision_id,
       base_content_hash,
       content_json,
       state,
       submitted_at,
       updated_at
     FROM speaker_content_revisions
    WHERE speaker_id = ?1 AND state IN ('draft', 'submitted', 'approved')
    ORDER BY
      CASE state WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
      updated_at DESC
    LIMIT 1`,
    )
    .bind(speakerId)
    .first<SpeakerRevisionRow>();
  let content = canonical;
  let activeRevision = revision;

  if (revision) {
    try {
      const parsed = JSON.parse(revision.content_json) as unknown;
      const validated = validateSpeakerWorkspaceContent(
        parsed,
        canonical.talks.map(({ id }) => id),
      );

      if (validated.content) {
        if (
          revision.state === "approved" &&
          (await hashCanonicalContent(validated.content)) ===
            (await hashCanonicalContent(canonical))
        ) {
          activeRevision = null;
        } else {
          content = validated.content;
        }
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
    content,
    immutable: {
      photo: speaker.photo,
      speaker_id: speakerId,
      talk_ids: canonical.talks.map(({ id }) => id),
    },
    revision: activeRevision
      ? {
          revision_id: activeRevision.revision_id,
          state: activeRevision.state,
          submitted_at: activeRevision.submitted_at,
          updated_at: activeRevision.updated_at,
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

function getCanonicalContent(
  speakerId: string,
): SpeakerWorkspaceContent | null {
  const speaker = findCanonicalSpeaker(speakerId);

  if (!speaker) return null;

  return {
    profile: {
      bio: speaker.bio,
      devto: speaker.devto ?? "",
      github: speaker.github ?? "",
      linkedin: speaker.linkedin ?? "",
      name: speaker.name,
      role: speaker.role,
      scholar: speaker.scholar ?? "",
      website: speaker.website ?? "",
      x: speaker.x ?? "",
    },
    talks: canonicalTalks
      .filter(({ speakers }) => speakers.includes(speakerId))
      .map(({ abstract, id, title }) => ({ abstract, id, title })),
  };
}

function findCanonicalSpeaker(speakerId: string): CanonicalSpeaker | undefined {
  return canonicalSpeakers.find(({ id }) => id === speakerId);
}

async function hashCanonicalContent(
  content: SpeakerWorkspaceContent,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(content)),
  );

  return base64UrlEncode(new Uint8Array(digest));
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
