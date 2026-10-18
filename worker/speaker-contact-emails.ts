import {
  encryptPrivateText,
  hashPrivateText,
  isLikelyEmail,
  json,
  normalizeEmail,
} from "./speaker-workspace-utils.ts";

interface StoredEmails {
  email_fingerprint: string;
  secondary_email_ciphertext: string | null;
  secondary_email_iv: string | null;
  secondary_email_fingerprint: string | null;
}

export async function prepareSpeakerContactEmails(
  env: Env,
  speakerId: string,
  body: Record<string, unknown>,
) {
  const email = normalizeEmail(body.email);
  if (!isLikelyEmail(email)) {
    return json({ error: "Enter a valid speaker email address." }, 400);
  }
  const fingerprint = await hashPrivateText(
    email,
    env.EMAIL_ENCRYPTION_KEY!,
    "email-hash",
  );
  const existing = await env
    .INTERESTS!.prepare(
      `SELECT email_fingerprint, secondary_email_ciphertext,
            secondary_email_iv, secondary_email_fingerprint
       FROM speaker_contacts WHERE speaker_id = ?1`,
    )
    .bind(speakerId)
    .first<StoredEmails>();
  let secondaryCiphertext = existing?.secondary_email_ciphertext ?? null;
  let secondaryIv = existing?.secondary_email_iv ?? null;
  let secondaryFingerprint = existing?.secondary_email_fingerprint ?? null;

  // Older clients only send the primary address; preserve their saved fallback.
  if (Object.hasOwn(body, "secondary_email")) {
    if (
      body.secondary_email !== null &&
      typeof body.secondary_email !== "string"
    ) {
      return json(
        { error: "Enter a valid secondary email address or leave it blank." },
        400,
      );
    }
    const secondaryEmail = normalizeEmail(body.secondary_email);
    if (secondaryEmail && !isLikelyEmail(secondaryEmail)) {
      return json(
        { error: "Enter a valid secondary email address or leave it blank." },
        400,
      );
    }
    secondaryFingerprint = secondaryEmail
      ? await hashPrivateText(
          secondaryEmail,
          env.EMAIL_ENCRYPTION_KEY!,
          "email-hash",
        )
      : null;
    const encrypted = secondaryEmail
      ? await encryptPrivateText(secondaryEmail, env.EMAIL_ENCRYPTION_KEY!)
      : null;
    secondaryCiphertext = encrypted?.ciphertext ?? null;
    secondaryIv = encrypted?.iv ?? null;
  }

  if (secondaryFingerprint === fingerprint) {
    return json(
      { error: "Use different addresses for the primary and secondary email." },
      400,
    );
  }

  const duplicate = await env
    .INTERESTS!.prepare(
      `SELECT speaker_id FROM speaker_contacts
      WHERE speaker_id <> ?1 AND (
        email_fingerprint IN (?2, ?3)
        OR secondary_email_fingerprint IN (?2, ?3)
      ) LIMIT 1`,
    )
    .bind(speakerId, fingerprint, secondaryFingerprint)
    .first();
  if (duplicate) return speakerEmailConflict();

  const encrypted = await encryptPrivateText(email, env.EMAIL_ENCRYPTION_KEY!);
  return {
    email,
    changed: Boolean(
      existing &&
      (existing.email_fingerprint !== fingerprint ||
        existing.secondary_email_fingerprint !== secondaryFingerprint),
    ),
    statement(retentionUntil: string, now: string) {
      return env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_contacts (
           speaker_id, email_ciphertext, email_iv, email_fingerprint,
           secondary_email_ciphertext, secondary_email_iv, secondary_email_fingerprint,
           retention_until, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
         ON CONFLICT (speaker_id) DO UPDATE SET
           email_ciphertext = excluded.email_ciphertext,
           email_iv = excluded.email_iv,
           email_confirmed_at = CASE
             WHEN speaker_contacts.email_fingerprint = excluded.email_fingerprint
               THEN speaker_contacts.email_confirmed_at ELSE NULL END,
           email_fingerprint = excluded.email_fingerprint,
           secondary_email_ciphertext = excluded.secondary_email_ciphertext,
           secondary_email_iv = excluded.secondary_email_iv,
           secondary_email_confirmed_at = CASE
             WHEN speaker_contacts.secondary_email_fingerprint = excluded.secondary_email_fingerprint
               THEN speaker_contacts.secondary_email_confirmed_at ELSE NULL END,
           secondary_email_fingerprint = excluded.secondary_email_fingerprint,
           retention_until = excluded.retention_until,
           delivery_status = 'active',
           updated_at = excluded.updated_at`,
        )
        .bind(
          speakerId,
          encrypted.ciphertext,
          encrypted.iv,
          fingerprint,
          secondaryCiphertext,
          secondaryIv,
          secondaryFingerprint,
          retentionUntil,
          now,
        );
    },
  };
}

function speakerEmailConflict(): Response {
  return json(
    { error: "That email address is already assigned to another speaker." },
    409,
  );
}

export async function saveSpeakerContactBatch(
  env: Env,
  statements: D1PreparedStatement[],
) {
  try {
    await env.INTERESTS!.batch(statements);
    return null;
  } catch (error) {
    // The database also checks uniqueness, covering concurrent organizer saves.
    if (
      error instanceof Error &&
      /Speaker email already assigned|UNIQUE constraint failed: speaker_contacts\.(?:secondary_)?email_fingerprint/u.test(
        error.message,
      )
    ) {
      return speakerEmailConflict();
    }
    throw error;
  }
}
