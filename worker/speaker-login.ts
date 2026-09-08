import {
  isSameOriginMutation,
  json,
  getConfigurationError,
  parsePublicOrigin,
  getSpeakerTurnstileConfigurationError,
  readJsonWithinLimit,
  maxLoginBodyBytes,
  isRecord,
  normalizeEmail,
  isLikelyEmail,
  speakerLoginTurnstileAction,
  getSpeakerTurnstileHostnames,
  loginRateWindowMilliseconds,
  loginCooldownMilliseconds,
  loginRequestRetentionMilliseconds,
  hashPrivateText,
  maxLoginRequestsPerEmail,
  maxLoginRequestsPerIp,
  genericLoginMessage,
  magicLinkLifetimeMilliseconds,
  createToken,
  hashToken,
  decryptPrivateText,
  speakerMagicLinkHtml,
  speakerMagicLinkText,
  readBearerToken,
  sessionLifetimeMilliseconds,
  serializeSessionCookie,
  readCookie,
  speakerSessionCookie,
  tokenPattern,
  clearSessionCookie,
} from "./speaker-workspace-utils.ts";
import {
  type SpeakerLoginContactRow,
  type SpeakerMagicLinkRow,
  type SpeakerAccessRow,
  type SpeakerSessionRow,
} from "./speaker-workspace-types.ts";
import { verifyTurnstile } from "./turnstile.ts";
import {
  canonicalSpeakerIds,
  readCanonicalSpeaker,
} from "./canonical-content.ts";

export async function requestSpeakerLogin(
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

export async function redeemSpeakerInvitation(
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

export async function endSpeakerSession(
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

export async function authenticateSpeaker(
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
