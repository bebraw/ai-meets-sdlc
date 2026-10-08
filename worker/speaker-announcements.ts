import {
  getConfigurationError,
  json,
  readJsonWithinLimit,
  isRecord,
  normalizeEmail,
  isLikelyEmail,
  hashPrivateText,
  escapeHtml,
} from "./speaker-workspace-utils.ts";
import {
  type SpeakerEmailCampaignRow,
  type SpeakerAnnouncementInput,
  type SpeakerAnnouncementRecipient,
} from "./speaker-workspace-types.ts";
import {
  canonicalSpeakerIds,
  readCanonicalSpeakers,
} from "./canonical-content.ts";
import { getAnnouncementRecipients } from "./announcement-recipients.ts";
import { readSpeakerDinnerSharedAdminItems } from "./speaker-dinner.ts";

export async function getSpeakerAnnouncements(
  env: Env,
  request: Request,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const offset = Number(new URL(request.url).searchParams.get("offset") ?? "0");
  if (!Number.isSafeInteger(offset) || offset < 0)
    return json({ error: "Invalid archive offset." }, 400);
  const result = await env
    .INTERESTS!.prepare(
      `SELECT
       campaign_id,
       category,
       include_dinner, speaker_text_body, dinner_text_body,
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
    ORDER BY created_at DESC, campaign_id DESC
    LIMIT 21 OFFSET ?1`,
    )
    .bind(offset)
    .all<SpeakerEmailCampaignRow>();

  const campaigns = result.results.slice(0, 20);
  const deliveries = campaigns.length
    ? await env
        .INTERESTS!.prepare(
          `SELECT campaign_id, speaker_id, source_ids, status, sent_at FROM speaker_email_deliveries
     WHERE campaign_id IN (${campaigns.map(() => "?").join(",")}) ORDER BY speaker_id`,
        )
        .bind(...campaigns.map(({ campaign_id }) => campaign_id))
        .all<{
          campaign_id: string;
          speaker_id: string;
          source_ids: string | null;
          status: string;
          sent_at: string | null;
        }>()
    : { results: [] };
  const names = new Map(
    (await readCanonicalSpeakers(env)).flatMap((s) => [
      [`speaker:${s.speakerId}`, s.content.profile.name],
      [`dinner-speaker:${s.speakerId}`, s.content.profile.name],
    ]),
  );
  if (
    deliveries.results.some((d) => d.source_ids?.includes("dinner-guest:")) &&
    Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL ?? "") > Date.now()
  ) {
    for (const guest of await readSpeakerDinnerSharedAdminItems(env))
      names.set(`dinner-guest:${guest.response_id}`, guest.name);
  }
  return json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      deliveries: deliveries.results
        .filter((delivery) => delivery.campaign_id === campaign.campaign_id)
        .map((delivery) => {
          const sources: string[] = delivery.source_ids
            ? JSON.parse(delivery.source_ids)
            : [`speaker:${delivery.speaker_id}`];
          return {
            ...delivery,
            name: [
              ...new Set(
                sources.map(
                  (source) =>
                    names.get(source) ??
                    (source.startsWith("dinner-guest:")
                      ? "Dinner guest (record removed)"
                      : source),
                ),
              ),
            ].join(" / "),
          };
        }),
    })),
    count: campaigns.length,
    next_offset: result.results.length > 20 ? offset + 20 : null,
  });
}

export async function previewSpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  const prepared = await prepareSpeakerAnnouncement(request, env);

  if (prepared instanceof Response) return prepared;

  const { excluded, input, recipients } = prepared;
  const both = recipients.filter((r) => r.groups.length === 2).length;
  const variants = [
    { label: "Speakers only", groups: ["speakers"] as const },
    { label: "Dinner only", groups: ["dinner"] as const },
    { label: "Speakers and dinner", groups: ["speakers", "dinner"] as const },
  ]
    .filter((v) =>
      recipients.some((r) => r.groups.join(",") === v.groups.join(",")),
    )
    .map((v) => ({
      label: v.label,
      html_body: renderAnnouncementHtml(
        "{{speaker name}}",
        announcementBody(input, v.groups),
      ),
      text_body: renderAnnouncementText(
        "{{speaker name}}",
        announcementBody(input, v.groups),
      ),
    }));

  return json({
    excluded,
    preview_token: await announcementToken(
      env,
      crypto.randomUUID(),
      input,
      recipients,
      excluded,
    ),
    audience_counts: {
      speakers_only:
        recipients.filter((r) => r.groups.includes("speakers")).length - both,
      dinner_only:
        recipients.filter((r) => r.groups.includes("dinner")).length - both,
      both,
    },
    variants,
    html_body: renderAnnouncementHtml("{{speaker name}}", input.textBody),
    recipient_count: recipients.length,
    recipients: recipients.map(({ name, speakerId, groups }) => ({
      name,
      speaker_id: speakerId,
      groups,
    })),
    subject: input.subject,
    text_body: renderAnnouncementText("{{speaker name}}", input.textBody),
  });
}

export async function testSpeakerAnnouncement(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.EMAIL) {
    return json(
      { error: "Speaker announcement email is not configured." },
      503,
    );
  }

  const body = await readJsonWithinLimit(request, 64 * 1024);

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
        groups: ["speakers", "dinner"],
        sourceIds: [],
        emailFingerprint: "",
      },
      `[TEST] ${parsed.subject}`,
      announcementBody(parsed, ["speakers", "dinner"]),
    );
  } catch (error) {
    console.error("Speaker announcement test delivery failed", {
      error: error instanceof Error ? error.message : "Unknown email error",
    });
    return json({ error: "The test message could not be sent." }, 502);
  }

  return json({ message: "Test message sent." });
}

export async function sendSpeakerAnnouncement(
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

  const { body, input, recipients, excluded } = prepared;
  const confirmedCount = body.confirm_recipient_count;
  const token =
    typeof body.preview_token === "string" ? body.preview_token : "";
  const nonce = token.split(".")[0] ?? "";

  if (
    !Number.isSafeInteger(confirmedCount) ||
    confirmedCount !== recipients.length ||
    !/^[0-9a-f-]{36}$/u.test(nonce) ||
    token !== (await announcementToken(env, nonce, input, recipients, excluded))
  ) {
    return json(
      {
        error:
          "The message or recipient list changed. Preview again and confirm the new recipients.",
      },
      409,
    );
  }

  if (recipients.length === 0) {
    return json({ error: "No eligible recipients were selected." }, 400);
  }

  const campaignId = crypto.randomUUID();
  const now = new Date().toISOString();
  const previewHtml = renderAnnouncementHtml(
    "{{speaker name}}",
    input.textBody,
  );
  const inserted = await env
    .INTERESTS!.prepare(
      `INSERT OR IGNORE INTO speaker_email_campaigns (
         campaign_id,
         category,
         subject,
         text_body,
         html_body,
         status,
         recipient_count,
         created_at, include_dinner, speaker_text_body, dinner_text_body, confirmation_token
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'sending', ?6, ?7, ?8, ?9, ?10, ?11) RETURNING campaign_id`,
    )
    .bind(
      campaignId,
      input.category,
      input.subject,
      input.textBody,
      previewHtml,
      recipients.length,
      now,
      input.includeDinner ? 1 : 0,
      input.speakerTextBody,
      input.dinnerTextBody,
      token,
    )
    .first();
  if (!inserted)
    return json(
      {
        error:
          "This preview has already been sent or is sending. Check the message history.",
      },
      409,
    );
  await env.INTERESTS!.batch([
    ...recipients.map((recipient) =>
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_email_deliveries (
           campaign_id,
           speaker_id,
           status,
           attempts,
           updated_at, source_ids, email_fingerprint
         ) VALUES (?1, ?2, 'pending', 0, ?3, ?4, ?5)`,
        )
        .bind(
          campaignId,
          recipient.speakerId,
          now,
          JSON.stringify(recipient.sourceIds),
          recipient.emailFingerprint,
        ),
    ),
  ]);

  for (const recipient of recipients) {
    await attemptCampaignDelivery(
      env,
      campaignId,
      recipient,
      input.subject,
      announcementBody(input, recipient.groups),
    );
  }

  const outcome = await finalizeCampaign(env, campaignId);

  return json({
    campaign_id: campaignId,
    message:
      outcome.failed_count === 0
        ? `Announcement sent separately to ${outcome.sent_count} recipients.`
        : `Sent ${outcome.sent_count}; ${outcome.failed_count} deliveries can be retried.`,
    ...outcome,
  });
}

export async function retrySpeakerAnnouncement(
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
       include_dinner, speaker_text_body, dinner_text_body,
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
  const claimed = await env.INTERESTS.prepare(
    `UPDATE speaker_email_campaigns SET status = 'sending', completed_at = NULL
    WHERE campaign_id = ?1 AND status IN ('failed', 'partial') RETURNING campaign_id`,
  )
    .bind(campaignId)
    .first();
  if (!claimed)
    return json(
      { error: "A retry is already running. Refresh the message history." },
      409,
    );

  const failedResult = await env
    .INTERESTS!.prepare(
      `SELECT speaker_id, source_ids, email_fingerprint
       FROM speaker_email_deliveries
      WHERE campaign_id = ?1 AND status = 'failed'`,
    )
    .bind(campaignId)
    .all<{
      speaker_id: string;
      source_ids: string | null;
      email_fingerprint: string | null;
    }>();
  const sources = failedResult.results.flatMap((row) =>
    row.source_ids
      ? (JSON.parse(row.source_ids) as string[])
      : [`speaker:${row.speaker_id}`],
  );
  const eligible = await getAnnouncementRecipients(
    env,
    [
      ...new Set(
        sources.filter((s) => s.startsWith("speaker:")).map((s) => s.slice(8)),
      ),
    ],
    campaign.category,
    campaign.include_dinner === 1,
  );

  for (const row of failedResult.results) {
    const speakerId = row.speaker_id;
    const originalSources: string[] = row.source_ids
      ? JSON.parse(row.source_ids)
      : [`speaker:${speakerId}`];
    const recipient = eligible.recipients.find(
      (r) =>
        (row.email_fingerprint
          ? r.emailFingerprint === row.email_fingerprint
          : r.speakerId === speakerId) &&
        r.sourceIds.some((s) => originalSources.includes(s)),
    );

    if (!recipient) {
      await env
        .INTERESTS!.prepare(
          `UPDATE speaker_email_deliveries
            SET status = 'skipped',
                last_error_code = 'no-longer-eligible',
                updated_at = ?3
          WHERE campaign_id = ?1 AND speaker_id = ?2 AND status = 'failed' AND claim_token IS NULL`,
        )
        .bind(campaignId, speakerId, new Date().toISOString())
        .run();
      continue;
    }
    recipient.speakerId = speakerId;
    const groups = [
      ...new Set(
        recipient.sourceIds
          .filter((s) => originalSources.includes(s))
          .map((s) =>
            s.startsWith("speaker:")
              ? ("speakers" as const)
              : ("dinner" as const),
          ),
      ),
    ];

    await attemptCampaignDelivery(
      env,
      campaignId,
      recipient,
      campaign.subject,
      announcementBody(
        {
          textBody: campaign.text_body,
          speakerTextBody: campaign.speaker_text_body,
          dinnerTextBody: campaign.dinner_text_body,
        },
        groups,
      ),
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

  const body = await readJsonWithinLimit(request, 64 * 1024);

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
    parsed.includeDinner,
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

  const uniqueSpeakerIds = [...new Set(speakerIds)].sort();
  const includeDinner = body.include_dinner === true;
  const speakerTextBody =
    typeof body.speaker_text_body === "string"
      ? body.speaker_text_body.trim().replace(/\r\n?/gu, "\n")
      : "";
  const dinnerTextBody =
    typeof body.dinner_text_body === "string"
      ? body.dinner_text_body.trim().replace(/\r\n?/gu, "\n")
      : "";
  if (speakerTextBody.length + dinnerTextBody.length + textBody.length > 10000)
    return {
      error: "Keep the combined message to 10,000 characters or fewer.",
    };
  if (includeDinner && category !== "operational")
    return {
      error: "Dinner recipients can receive operational event updates only.",
    };

  if (
    (uniqueSpeakerIds.length === 0 && !includeDinner) ||
    uniqueSpeakerIds.length > canonicalSpeakerIds.size ||
    uniqueSpeakerIds.some((speakerId) => !canonicalSpeakerIds.has(speakerId))
  ) {
    return { error: "Select at least one valid speaker." };
  }

  return {
    category,
    includeDinner,
    speakerTextBody,
    dinnerTextBody,
    speakerIds: uniqueSpeakerIds,
    subject,
    textBody,
  };
}

async function attemptCampaignDelivery(
  env: Env,
  campaignId: string,
  recipient: SpeakerAnnouncementRecipient,
  subject: string,
  textBody: string,
): Promise<void> {
  const now = new Date().toISOString();
  const claimToken = crypto.randomUUID();
  const claimed = await env.INTERESTS.prepare(
    `UPDATE speaker_email_deliveries SET claim_token = ?3, attempts = attempts + 1, updated_at = ?4
    WHERE campaign_id = ?1 AND speaker_id = ?2 AND status IN ('pending', 'failed') AND claim_token IS NULL RETURNING speaker_id`,
  )
    .bind(campaignId, recipient.speakerId, claimToken, now)
    .first();
  if (!claimed) return;

  try {
    await deliverSpeakerEmail(env, recipient, subject, textBody);
  } catch {
    console.error("Speaker announcement delivery failed", {
      campaignId,
      speakerId: recipient.speakerId,
    });
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_email_deliveries
          SET status = 'failed',
              claim_token = NULL,
              last_error_code = 'delivery-error',
              updated_at = ?3
        WHERE campaign_id = ?1
          AND speaker_id = ?2
          AND claim_token = ?4`,
      )
      .bind(campaignId, recipient.speakerId, now, claimToken)
      .run();
    return;
  }
  // Keep the claim if recording an accepted send fails: an uncertain send must not be retried.
  await env.INTERESTS.prepare(
    `UPDATE speaker_email_deliveries SET status = 'sent', claim_token = NULL,
    last_error_code = NULL, sent_at = ?3, updated_at = ?3 WHERE campaign_id = ?1 AND speaker_id = ?2 AND claim_token = ?4`,
  )
    .bind(campaignId, recipient.speakerId, new Date().toISOString(), claimToken)
    .run();
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
       SUM(CASE WHEN status = 'failed' AND claim_token IS NULL THEN 1 ELSE 0 END) AS failed_count,
       SUM(CASE WHEN status = 'pending' OR claim_token IS NOT NULL THEN 1 ELSE 0 END) AS pending_count,
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

function announcementBody(
  input: Pick<
    SpeakerAnnouncementInput,
    "textBody" | "speakerTextBody" | "dinnerTextBody"
  >,
  groups: readonly string[],
): string {
  return [
    input.textBody,
    groups.includes("speakers") && input.speakerTextBody
      ? `Speaker information\n${input.speakerTextBody}`
      : "",
    groups.includes("dinner") && input.dinnerTextBody
      ? `Dinner information\n${input.dinnerTextBody}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function announcementToken(
  env: Env,
  nonce: string,
  input: SpeakerAnnouncementInput,
  recipients: SpeakerAnnouncementRecipient[],
  excluded: Array<{ reason: string; speaker_id: string }>,
): Promise<string> {
  const snapshot = JSON.stringify({
    nonce,
    input,
    recipients: recipients.map((r) => ({
      email: r.emailFingerprint,
      name: r.name,
      groups: r.groups,
      sources: r.sourceIds,
    })),
    excluded,
  });
  return `${nonce}.${await hashPrivateText(snapshot, env.EMAIL_ENCRYPTION_KEY, "announcement-preview")}`;
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
      <p style="margin:0 0 24px;font-size:13px;font-weight:700;text-transform:uppercase">SDLCAI / Event update</p>
      <div style="border:1px solid #151515;background:#fff;padding:28px">
        <p style="font-size:17px;line-height:1.6">Hello ${escapeHtml(speakerName)},</p>
        ${paragraphs}
      </div>
      <p style="font-size:14px;line-height:1.6">Questions? Reply to this message or contact <a href="mailto:info@sdlcai.org" style="color:#151515">info@sdlcai.org</a>.</p>
    </div>
  </body>
</html>`;
}
