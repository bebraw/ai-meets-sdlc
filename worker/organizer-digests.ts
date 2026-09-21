import { decryptTextWithKey, importAesKey } from "./form-utils.ts";
import { escapeHtml, parsePublicOrigin } from "./speaker-workspace-utils.ts";
import { speakerReviewDigestDate } from "./speaker-review-digest.ts";

type DigestKind = "posters" | "data";
type DigestMessage = {
  subject: string;
  text: string;
  html: string;
  count: number;
};

// Use the most recent Monday so a missed Monday can catch up later that week.
export function dataChangeDigestWeek(now: Date): string | null {
  const date = speakerReviewDigestDate(now);
  if (!date) return null;
  const monday = new Date(`${date}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function message(
  subject: string,
  lines: string[],
  url: string,
  count: number,
): DigestMessage {
  return {
    subject,
    count,
    text: `${subject}\n\n${lines.join("\n\n")}\n\nOpen administration: ${url}`,
    html: `<!doctype html><html lang="en"><body><h1>${escapeHtml(subject)}</h1>${lines.map((line) => `<p style="white-space:pre-wrap">${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(url)}">Open administration</a></p></body></html>`,
  };
}

export async function sendPosterReviewDigest(
  env: Env,
  now = new Date(),
): Promise<void> {
  if (env.POSTER_REVIEW_DIGEST_ENABLED !== "true") return;
  const date = speakerReviewDigestDate(now);
  if (!date) return;
  await deliver(env, "posters", date, now, async (origin) => {
    if (!env.EMAIL_ENCRYPTION_KEY)
      throw new Error("Poster encryption is not configured.");
    const { results } = await env.INTERESTS.prepare(
      `SELECT id, title_ciphertext, title_iv, name_ciphertext, name_iv, status, created_at,
         COUNT(*) OVER () AS total
       FROM poster_proposals WHERE status IN ('submitted', 'shortlisted', 'waitlisted')
       ORDER BY created_at, id LIMIT 50`,
    ).all<{
      id: number;
      title_ciphertext: string;
      title_iv: string;
      name_ciphertext: string;
      name_iv: string;
      status: string;
      created_at: string;
      total: number;
    }>();
    const key = await importAesKey(env.EMAIL_ENCRYPTION_KEY);
    const count = results[0]?.total ?? 0;
    const lines = await Promise.all(
      results.map(async (row) => {
        const [title, name] = await Promise.all([
          decryptTextWithKey(row.title_ciphertext, row.title_iv, key),
          decryptTextWithKey(row.name_ciphertext, row.name_iv, key),
        ]);
        return `#${row.id}: ${title}\nPresenter: ${name}\nStatus: ${row.status}; submitted ${row.created_at.slice(0, 10)}`;
      }),
    );
    lines.unshift(
      "Proposals awaiting a final decision appear daily until accepted, declined or withdrawn. Review and contact presenters in poster administration.",
    );
    if (count > results.length)
      lines.push(
        `Showing the oldest ${results.length} of ${count} proposals. All proposals are available in administration.`,
      );
    return message(
      `SDLCAI: ${count} poster proposals awaiting a decision — ${date}`,
      lines,
      `${origin}/admin/posters/`,
      count,
    );
  });
}

const dataLabels: Record<string, string> = {
  interests: "Registration interests",
  poster_proposals: "Poster proposals",
  speaker_contacts: "Speaker contacts",
  canonical_speaker_content: "Published speaker and talk content",
  speaker_content_revisions: "Speaker content revisions",
  speaker_photo_revisions: "Speaker photos",
  speaker_video_submissions: "Speaker videos",
  speaker_presentation_responses: "Presentation responses",
  speaker_dinner_responses: "Speaker dinner responses",
  speaker_dinner_shared_responses: "Dinner guest responses",
  speaker_travel_receipts: "Travel receipts",
  volunteers: "Volunteers",
  schedule_order: "Programme order",
};

export async function sendDataChangeDigest(
  env: Env,
  now = new Date(),
): Promise<void> {
  if (env.DATA_CHANGE_DIGEST_ENABLED !== "true") return;
  const week = dataChangeDigestWeek(now);
  if (!week) return;
  await deliver(env, "data", week, now, async (origin, throughId) => {
    const { results } = await env.INTERESTS.prepare(
      `SELECT table_name, operation, COUNT(*) AS count, MIN(changed_at) AS first_at, MAX(changed_at) AS last_at
       FROM organizer_data_changes
       WHERE change_id > COALESCE((SELECT MAX(through_change_id) FROM organizer_digests
         WHERE kind = 'data' AND status IN ('sent', 'empty')), 0)
         AND change_id <= ?1
       GROUP BY table_name, operation ORDER BY table_name, operation`,
    )
      .bind(throughId)
      .all<{
        table_name: string;
        operation: string;
        count: number;
        first_at: string;
        last_at: string;
      }>();
    const count = results.reduce((sum, row) => sum + row.count, 0);
    return message(
      `SDLCAI: weekly data changes — ${week}`,
      [
        `${count} changes since the previous completed digest (or since tracking was enabled). Counts include additions, edits and deletions, including automatic cleanup.`,
        ...results.map(
          (row) =>
            `${dataLabels[row.table_name] ?? row.table_name}: ${row.count} ${row.operation}\n${row.first_at} to ${row.last_at}`,
        ),
        "Private field values are omitted. Authentication activity, email delivery records, and repository file changes are not included.",
      ],
      `${origin}/admin/`,
      count,
    );
  });
}

async function deliver(
  env: Env,
  kind: DigestKind,
  period: string,
  now: Date,
  build: (origin: string, throughId: number) => Promise<DigestMessage>,
): Promise<void> {
  const origin = parsePublicOrigin(env.PUBLIC_SITE_ORIGIN);
  if (!env.INTERESTS || !env.EMAIL || !origin)
    throw new Error("Organizer digest is not configured.");
  const timestamp = now.toISOString();
  const attempt = crypto.randomUUID();
  const claim = await env.INTERESTS.prepare(
    `INSERT INTO organizer_digests (kind, period, status, attempt_id, lease_until, created_at, updated_at, through_change_id)
     VALUES (?1, ?2, 'sending', ?3, ?4, ?5, ?5, (SELECT COALESCE(MAX(change_id), 0) FROM organizer_data_changes))
     ON CONFLICT(kind, period) DO UPDATE SET status = 'sending', attempt_id = excluded.attempt_id,
       lease_until = excluded.lease_until, updated_at = excluded.updated_at, attempts = organizer_digests.attempts + 1
     WHERE organizer_digests.status IN ('sending', 'failed') AND organizer_digests.lease_until <= ?5
       AND organizer_digests.attempts < 4`,
  )
    .bind(
      kind,
      period,
      attempt,
      new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      timestamp,
    )
    .run();
  if (claim.meta.changes !== 1) return;
  try {
    const row = await env.INTERESTS.prepare(
      "SELECT through_change_id FROM organizer_digests WHERE kind = ?1 AND period = ?2 AND attempt_id = ?3",
    )
      .bind(kind, period, attempt)
      .first<{ through_change_id: number }>();
    if (!row) throw new Error("Digest lease was lost.");
    const result = await build(origin, row.through_change_id);
    let messageId: string | null = null;
    if (result.count) {
      const { count: _count, ...email } = result;
      const sent = await env.EMAIL.send({
        ...email,
        from: { email: "info@sdlcai.org", name: "SDLCAI" },
        to: "info@sdlcai.org",
        replyTo: "info@sdlcai.org",
      });
      messageId = sent.messageId;
    }
    const completed = await env.INTERESTS.prepare(
      `UPDATE organizer_digests SET status = ?4, item_count = ?5, message_id = ?6, updated_at = ?7
       WHERE kind = ?1 AND period = ?2 AND attempt_id = ?3 AND status = 'sending'`,
    )
      .bind(
        kind,
        period,
        attempt,
        result.count ? "sent" : "empty",
        result.count,
        messageId,
        timestamp,
      )
      .run();
    if (completed.meta.changes !== 1) throw new Error("Digest lease was lost.");
    console.info("organizer_digest_completed", {
      kind,
      period,
      count: result.count,
    });
  } catch {
    await env.INTERESTS.prepare(
      "UPDATE organizer_digests SET status = 'failed', updated_at = ?4 WHERE kind = ?1 AND period = ?2 AND attempt_id = ?3 AND status = 'sending'",
    )
      .bind(kind, period, attempt, timestamp)
      .run();
    console.error("organizer_digest_failed", { kind, period });
    throw new Error(
      "Organizer digest failed; a later hourly trigger can retry.",
    );
  }
}
