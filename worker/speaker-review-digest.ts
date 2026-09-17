import {
  readCanonicalSpeakers,
  hashCanonicalContent,
  workspaceOnlySpeakerIds,
} from "./canonical-content.ts";
import { getChangedFields } from "./speaker-content.ts";
import { validateSpeakerWorkspaceContent } from "./speaker-content-validation.ts";
import {
  createToken,
  hashToken,
  parsePublicOrigin,
} from "./speaker-workspace-utils.ts";
import { sha256Hex } from "./form-utils.ts";
import {
  speakerReviewDigestEmail,
  type ReviewDigestItem,
} from "./speaker-review-templates.ts";
import { type SpeakerAdminRevisionRow } from "./speaker-workspace-types.ts";

export const speakerReviewDigestCron = "0 * * * *";
export const speakerReviewTokenPurpose = "speaker-revision-email-approval";
const dayMs = 24 * 60 * 60 * 1000;

export function speakerReviewDigestDate(now: Date): string | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Helsinki",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? "";
  // Hourly triggers allow retries, while the durable date key limits successful
  // delivery to one digest per Helsinki day, including daylight-saving changes.
  if (Number(value("hour")) < 9) return null;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function sendSpeakerReviewDigest(
  env: Env,
  now = new Date(),
): Promise<void> {
  if (env.SPEAKER_REVIEW_DIGEST_ENABLED !== "true") return;
  const date = speakerReviewDigestDate(now);
  if (!date) return;
  const origin = parsePublicOrigin(env.PUBLIC_SITE_ORIGIN);
  if (!env.INTERESTS || !env.EMAIL || !env.EMAIL_ENCRYPTION_KEY || !origin) {
    throw new Error("Speaker review digest is not configured.");
  }
  const timestamp = now.toISOString();
  const attemptId = crypto.randomUUID();
  const claim = await env.INTERESTS.prepare(
    `INSERT INTO speaker_review_digests
       (digest_date, status, attempt_id, lease_until, created_at, updated_at)
     VALUES (?1, 'sending', ?2, ?3, ?4, ?4)
     ON CONFLICT(digest_date) DO UPDATE SET
       status = 'sending', attempt_id = excluded.attempt_id,
       lease_until = excluded.lease_until, updated_at = excluded.updated_at,
       attempts = speaker_review_digests.attempts + 1
     WHERE speaker_review_digests.status IN ('sending', 'failed')
       AND speaker_review_digests.lease_until <= ?4
       AND speaker_review_digests.attempts < 4`,
  )
    .bind(
      date,
      attemptId,
      new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      timestamp,
    )
    .run();
  if (claim.meta.changes !== 1) return;

  try {
    const [canonical, revisions] = await Promise.all([
      readCanonicalSpeakers(env),
      env.INTERESTS.prepare(
        `SELECT revision_id, speaker_id, base_content_hash, base_content_version,
                content_json, state, submitted_at, updated_at, reviewed_at, review_note
         FROM speaker_content_revisions WHERE state = 'submitted'
         ORDER BY submitted_at, revision_id`,
      ).all<SpeakerAdminRevisionRow>(),
    ]);
    const records = new Map(
      canonical.map((record) => [record.speakerId, record]),
    );
    const items: ReviewDigestItem[] = [];
    const expiresAt = new Date(now.getTime() + 7 * dayMs).toISOString();
    for (const revision of revisions.results) {
      if (workspaceOnlySpeakerIds.has(revision.speaker_id)) continue;
      const record = records.get(revision.speaker_id);
      if (!record)
        throw new Error(
          "A submitted speaker revision has no canonical record.",
        );
      let proposed;
      try {
        proposed = validateSpeakerWorkspaceContent(
          JSON.parse(revision.content_json) as unknown,
          record.content.talks.map((talk) => talk.id),
        ).content;
      } catch {
        /* Invalid stored content is flagged for admin attention below. */
      }
      const conflict =
        !proposed ||
        record.contentVersion !== revision.base_content_version ||
        (await hashCanonicalContent(record.content)) !==
          revision.base_content_hash;
      let reviewUrl = `${origin}/admin/speakers/`;
      if (!conflict) {
        const token = createToken();
        const tokenHash = await hashToken(
          token,
          env.EMAIL_ENCRYPTION_KEY,
          speakerReviewTokenPurpose,
        );
        await env.INTERESTS.prepare(
          `INSERT INTO speaker_review_tokens
             (token_hash, digest_date, revision_id, content_hash, base_content_version, created_at, expires_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
          .bind(
            tokenHash,
            date,
            revision.revision_id,
            await sha256Hex(revision.content_json),
            revision.base_content_version,
            timestamp,
            expiresAt,
          )
          .run();
        reviewUrl = `${origin}/speaker-review/${token}`;
      }
      items.push({
        name: record.content.profile.name,
        conflict,
        reviewUrl,
        changes: proposed ? getChangedFields(record.content, proposed) : [],
      });
    }

    let messageId: string | null = null;
    if (items.length) {
      const message = speakerReviewDigestEmail(
        items,
        date,
        `${origin}/admin/speakers/`,
      );
      const result = await env.EMAIL.send({
        ...message,
        from: { email: "info@sdlcai.org", name: "SDLCAI" },
        to: "info@sdlcai.org",
        replyTo: "info@sdlcai.org",
      });
      messageId = result.messageId;
    }
    const completed = await env.INTERESTS.prepare(
      `UPDATE speaker_review_digests SET status = ?3, revision_count = ?4,
         message_id = ?5, sent_at = ?6, updated_at = ?7
       WHERE digest_date = ?1 AND attempt_id = ?2 AND status = 'sending'`,
    )
      .bind(
        date,
        attemptId,
        items.length ? "sent" : "empty",
        items.length,
        messageId,
        items.length ? timestamp : null,
        timestamp,
      )
      .run();
    if (completed.meta.changes !== 1)
      throw new Error("Digest delivery lease was lost.");
    console.info("speaker_review_digest_completed", {
      date,
      revisions: items.length,
    });
  } catch {
    // Never log exception payloads: provider errors could include private links.
    await env.INTERESTS.prepare(
      `UPDATE speaker_review_digests SET status = 'failed', updated_at = ?3
       WHERE digest_date = ?1 AND attempt_id = ?2 AND status = 'sending'`,
    )
      .bind(date, attemptId, timestamp)
      .run();
    console.error("speaker_review_digest_failed", { date });
    throw new Error(
      "Speaker review digest failed; a later hourly trigger can retry.",
    );
  }
}

export async function purgeSpeakerReviewDigests(
  env: Env,
  now = new Date(),
): Promise<void> {
  if (!env.INTERESTS) return;
  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      "DELETE FROM speaker_review_tokens WHERE expires_at <= ?1",
    ).bind(now.toISOString()),
    env.INTERESTS.prepare(
      "DELETE FROM speaker_review_digests WHERE created_at < ?1",
    ).bind(new Date(now.getTime() - 30 * dayMs).toISOString()),
  ]);
}
