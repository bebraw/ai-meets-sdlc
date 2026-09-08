import {
  getConfigurationError,
  decryptPrivateText,
  json,
  readJsonWithinLimit,
  maxWorkspaceBodyBytes,
  isRecord,
  staleCanonicalResponse,
  parseFutureConfigurationDate,
  normalizeEmail,
  isLikelyEmail,
  hashPrivateText,
  encryptPrivateText,
  hashToken,
  createToken,
  parsePublicOrigin,
  speakerInvitationHtml,
  speakerInvitationText,
} from "./speaker-workspace-utils.ts";
import {
  type SpeakerContactRow,
  type SpeakerAdminAccessRow,
  type SpeakerAdminRevisionRow,
  type SpeakerDinnerRow,
  type SpeakerPresentationRow,
  type SpeakerDinnerResponseData,
  type SpeakerPresentationResponseData,
  type SpeakerRevisionRow,
} from "./speaker-workspace-types.ts";
import {
  decryptSpeakerDinnerResponse,
  decryptSpeakerPresentationResponse,
} from "./speaker-responses.ts";
import { serializeAdminRevision, getChangedFields } from "./speaker-content.ts";
import {
  readCanonicalSpeakers,
  hashCanonicalContent,
  getCanonicalPhotoUrl,
  workspaceOnlySpeakerIds,
  readCanonicalSpeaker,
  type SpeakerWorkspaceContent,
} from "./canonical-content.ts";
import { readAdminSpeakerPhotos } from "./speaker-photos.ts";
import { readAdminSpeakerVideos } from "./speaker-videos.ts";
import { validateSpeakerWorkspaceContent } from "./speaker-content-validation.ts";

export async function getAdminSpeakers(env: Env): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const canonicalRecords = await readCanonicalSpeakers(env);
  const [
    contactResult,
    accessResult,
    revisionResult,
    dinnerResult,
    presentationResult,
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
    env
      .INTERESTS!.prepare(
        `SELECT
         speaker_id,
         response_ciphertext,
         response_iv,
         expires_at,
         responded_at,
         updated_at
       FROM speaker_presentation_responses
      WHERE expires_at > ?1`,
      )
      .bind(new Date().toISOString())
      .all<SpeakerPresentationRow>(),
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
  const presentations = new Map(
    presentationResult.results.map((item) => [item.speaker_id, item]),
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
      const presentationRow = presentations.get(record.speakerId);
      const canonical = record.content;
      let email: string | null = null;
      let dinner: SpeakerDinnerResponseData | null = null;
      let presentation: SpeakerPresentationResponseData | null = null;

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

      if (presentationRow) {
        try {
          presentation = await decryptSpeakerPresentationResponse(
            presentationRow,
            env,
          );
        } catch {
          console.error(
            JSON.stringify({
              message: "Unable to decrypt speaker presentation response",
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
        presentation: presentationRow
          ? {
              expires_at: presentationRow.expires_at,
              responded_at: presentationRow.responded_at,
              response: presentation,
              updated_at: presentationRow.updated_at,
            }
          : null,
        revision: revision ? serializeAdminRevision(revision, canonical) : null,
        speaker_id: record.speakerId,
        workspace_only: workspaceOnlySpeakerIds.has(record.speakerId),
        videos: videos.get(record.speakerId) ?? [],
      };
    }),
  );

  return json({ count: speakers.length, speakers });
}

export async function saveAdminSpeakerContent(
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

export async function saveSpeakerContact(
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

export async function sendSpeakerInvitation(
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

export async function reviewSpeakerRevision(
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
