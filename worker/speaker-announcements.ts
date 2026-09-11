import {
  getConfigurationError,
  json,
  readJsonWithinLimit,
  isRecord,
  normalizeEmail,
  isLikelyEmail,
  decryptPrivateText,
  escapeHtml,
} from "./speaker-workspace-utils.ts";
import {
  type SpeakerEmailCampaignRow,
  type SpeakerAnnouncementInput,
  type SpeakerAnnouncementRecipient,
  type SpeakerEmailCategory,
  type SpeakerContactRow,
} from "./speaker-workspace-types.ts";
import {
  canonicalSpeakerIds,
  readCanonicalSpeakers,
} from "./canonical-content.ts";

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
          `SELECT campaign_id, speaker_id, status, sent_at FROM speaker_email_deliveries
     WHERE campaign_id IN (${campaigns.map(() => "?").join(",")}) ORDER BY speaker_id`,
        )
        .bind(...campaigns.map(({ campaign_id }) => campaign_id))
        .all<{
          campaign_id: string;
          speaker_id: string;
          status: string;
          sent_at: string | null;
        }>()
    : { results: [] };
  return json({
    campaigns: campaigns.map((campaign) => ({
      ...campaign,
      deliveries: deliveries.results.filter(
        (delivery) => delivery.campaign_id === campaign.campaign_id,
      ),
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
    else if (category === "promotion" && !contact.email_confirmed_at)
      reason = "unconfirmed";
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
