import {
  isLikelyEmail,
  jsonResponse as json,
  requireAdminAction,
  sha256Hex,
} from "./form-utils.ts";
import { isRecord, readJsonWithinLimit } from "./speaker-workspace-utils.ts";
import { readEventAttendeeRoster } from "./event-attendees.ts";
import {
  mailFingerprint,
  mailHtml,
  mailOrigin,
  privateMailResponse,
  signMailToken,
  verifyMailToken,
} from "./mail-utils.ts";

interface Recipient {
  email: string;
  email_hash: string;
  names: string[];
}
interface Campaign {
  id: string;
  subject: string;
  text_body: string;
  created_at: string;
}
type Copy = { subject: string; text_body: string };
const endpoint = "/api/admin/attendee-messages";
const unsubscribePath = "/api/attendee-messages/unsubscribe";

export async function attendeeMessageAudience(
  env: Env,
): Promise<{ recipients: Recipient[]; excluded: Record<string, number> }> {
  const roster = await readEventAttendeeRoster(env);
  const preferences = await env.INTERESTS.prepare(
    "SELECT email_hash FROM attendee_message_preferences",
  ).all<{ email_hash: string }>();
  const suppressed = new Set(preferences.results.map((row) => row.email_hash));
  const excluded = {
    cancelled: 0,
    invalid_email: 0,
    unsubscribed: 0,
    duplicate: 0,
  };
  const byEmail = new Map<string, Recipient>();
  for (const person of roster.people.sort((a, b) => a.id.localeCompare(b.id))) {
    if (person.status !== "active") {
      excluded.cancelled++;
      continue;
    }
    const email = person.email.trim().toLowerCase();
    if (email.length > 254 || !isLikelyEmail(email)) {
      excluded.invalid_email++;
      continue;
    }
    const hash = await mailFingerprint(email, env);
    if (suppressed.has(hash)) {
      excluded.unsubscribed++;
      continue;
    }
    const existing = byEmail.get(hash);
    if (existing) {
      excluded.duplicate++;
      if (!existing.names.includes(person.name))
        existing.names.push(person.name);
    } else byEmail.set(hash, { email, email_hash: hash, names: [person.name] });
  }
  return {
    recipients: [...byEmail.values()].sort((a, b) =>
      a.email_hash.localeCompare(b.email_hash),
    ),
    excluded,
  };
}
export async function handleAttendeeMessages(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (
    path !== unsubscribePath &&
    path !== endpoint &&
    !path.startsWith(`${endpoint}/`)
  )
    return null;
  try {
    return privateMailResponse(await handle(request, env, path));
  } catch {
    console.error("attendee_message_request_failed");
    return privateMailResponse(
      json(
        {
          error:
            "The message service is unavailable. Check history before continuing a send.",
        },
        503,
      ),
    );
  }
}
async function handle(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (!env.EMAIL_ENCRYPTION_KEY)
    return json({ error: "Email is not configured." }, 503);
  if (path === unsubscribePath) return unsubscribe(request, env);
  if (request.method === "GET" && path === endpoint) {
    const offset = Number(
      new URL(request.url).searchParams.get("offset") ?? "0",
    );
    if (!Number.isSafeInteger(offset) || offset < 0)
      return json({ error: "Invalid history offset." }, 400);
    const campaigns = await env.INTERESTS.prepare(
      "SELECT id, subject, text_body, created_at FROM attendee_message_campaigns ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET ?",
    )
      .bind(offset)
      .all<Campaign>();
    const rows = campaigns.results.slice(0, 20);
    const audience = await attendeeMessageAudience(env);
    const list = await Promise.all(
      rows.map(async (campaign) => ({
        ...campaign,
        ...(await campaignCounts(env, campaign.id)),
      })),
    );
    return json({
      campaigns: list,
      recipient_count: audience.recipients.length,
      excluded: audience.excluded,
      next_offset: campaigns.results.length > 20 ? offset + 20 : null,
    });
  }
  if (request.method === "GET" && path === `${endpoint}/deliveries`) {
    const url = new URL(request.url),
      id = url.searchParams.get("id") ?? "",
      offset = Number(url.searchParams.get("offset") ?? "0");
    if (
      !/^[\da-f-]{36}$/u.test(id) ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      return json({ error: "Invalid message." }, 400);
    const deliveries = await env.INTERESTS.prepare(
      "SELECT email_hash, status, attempts, updated_at, message_id FROM attendee_message_deliveries WHERE campaign_id = ? ORDER BY email_hash LIMIT 51 OFFSET ?",
    )
      .bind(id, offset)
      .all<{ email_hash: string }>();
    // Addresses remain in the encrypted roster; the ledger stores a keyed fingerprint only.
    const roster = await readEventAttendeeRoster(env),
      addresses = new Map<string, string>();
    for (const person of roster.people)
      if (person.email)
        addresses.set(await mailFingerprint(person.email, env), person.email);
    return json({
      deliveries: deliveries.results.slice(0, 50).map((row) => ({
        ...row,
        email: addresses.get(row.email_hash) ?? "Address no longer in roster",
      })),
      next_offset: deliveries.results.length > 50 ? offset + 50 : null,
    });
  }
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  const denied = requireAdminAction(request, "attendee-messages");
  if (denied) return denied;
  const body = await readJsonWithinLimit(request, 32 * 1024);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return json({ error: "Complete the message." }, 400);
  if (path === `${endpoint}/continue` || path === `${endpoint}/retry`) {
    if (typeof body.id !== "string" || !/^[\da-f-]{36}$/u.test(body.id))
      return json({ error: "Choose a saved message." }, 400);
    const campaign = await env.INTERESTS.prepare(
      "SELECT id, subject, text_body, created_at FROM attendee_message_campaigns WHERE id = ?",
    )
      .bind(body.id)
      .first<Campaign>();
    if (!campaign) return json({ error: "Message not found." }, 404);
    if (path.endsWith("/retry"))
      await env.INTERESTS.prepare(
        "UPDATE attendee_message_deliveries SET status = 'pending' WHERE campaign_id = ? AND status = 'failed'",
      )
        .bind(campaign.id)
        .run();
    return processAttendeeMessageBatch(env, campaign);
  }
  const input = parseCopy(body);
  if (!input)
    return json(
      {
        error:
          "Use a subject of 4–160 characters and a message of 20–10,000 characters. Choose event communications only.",
      },
      400,
    );
  if (path === `${endpoint}/test`) {
    if (!env.EMAIL)
      return json({ error: "Email sending is not configured." }, 503);
    const email =
      typeof body.test_email === "string"
        ? body.test_email.trim().toLowerCase()
        : "";
    if (!isLikelyEmail(email) || email.length > 254)
      return json({ error: "Enter a valid test address." }, 400);
    const recipient = {
      email,
      email_hash: await mailFingerprint(email, env),
      names: ["Test recipient"],
    };
    const text = await renderText(env, recipient, input.text_body);
    try {
      await deliver(env, email, `[TEST] ${input.subject}`, text);
    } catch {
      return json(
        {
          error:
            "The provider did not confirm acceptance of this test. Check the recipient inbox before trying again.",
        },
        502,
      );
    }
    return json({
      message:
        "The email provider accepted the test message. Check your inbox and spam folder.",
    });
  }
  const audience = await attendeeMessageAudience(env);
  const snapshot = await sha256Hex(
    JSON.stringify({
      input,
      recipients: audience.recipients,
      excluded: audience.excluded,
    }),
  );
  if (path === `${endpoint}/preview`) {
    const preview = await signMailToken(
      {
        nonce: crypto.randomUUID(),
        snapshot,
        expires: Date.now() + 2 * 3_600_000,
      },
      env,
      "attendee-message-preview",
    );
    return json({
      preview_token: preview,
      recipient_count: audience.recipients.length,
      recipients: audience.recipients.map((r) => ({
        email: r.email,
        names: r.names,
      })),
      excluded: audience.excluded,
      text_body: eventMessageText(
        input.text_body,
        "[personal unsubscribe link]",
      ),
    });
  }
  if (path !== `${endpoint}/send`) return json({ error: "Not found." }, 404);
  if (!env.EMAIL)
    return json({ error: "Email sending is not configured." }, 503);
  const token =
    typeof body.preview_token === "string" ? body.preview_token : "";
  const payload = await verifyMailToken(token, env, "attendee-message-preview");
  if (
    !payload ||
    payload.snapshot !== snapshot ||
    typeof payload.expires !== "number" ||
    payload.expires < Date.now() ||
    body.confirm_recipient_count !== audience.recipients.length
  )
    return json(
      {
        error:
          "The preview expired, or the message or audience changed. Preview again before sending.",
      },
      409,
    );
  if (!audience.recipients.length)
    return json({ error: "There are no eligible recipients." }, 400);
  const existing = await env.INTERESTS.prepare(
    "SELECT id FROM attendee_message_campaigns WHERE preview_token = ?",
  )
    .bind(token)
    .first<{ id: string }>();
  if (existing)
    return json(
      {
        error:
          "This preview already has a saved send. Continue it from history.",
        campaign_id: existing.id,
      },
      409,
    );
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  // One atomic insert reserves the preview and the full audience. Replays cannot create duplicate campaigns.
  try {
    await env.INTERESTS.batch([
      env.INTERESTS.prepare(
        "INSERT INTO attendee_message_campaigns(id, preview_token, subject, text_body, created_at) VALUES(?, ?, ?, ?, ?)",
      ).bind(id, token, input.subject, input.text_body, now),
      // JSON keeps this a single statement even for the full registration roster.
      env.INTERESTS.prepare(
        "INSERT INTO attendee_message_deliveries(campaign_id, email_hash, status, updated_at) SELECT ?, value, 'pending', ? FROM json_each(?)",
      ).bind(
        id,
        now,
        JSON.stringify(audience.recipients.map((r) => r.email_hash)),
      ),
    ]);
  } catch (error) {
    if (
      await env.INTERESTS.prepare(
        "SELECT id FROM attendee_message_campaigns WHERE preview_token = ?",
      )
        .bind(token)
        .first()
    )
      return json(
        { error: "This preview is already saved. Check message history." },
        409,
      );
    throw error;
  }
  return json({ campaign_id: id, ...(await campaignCounts(env, id)) }, 201);
}
function parseCopy(body: Record<string, unknown>): Copy | null {
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text_body =
    typeof body.text_body === "string"
      ? body.text_body.trim().replace(/\r\n?/gu, "\n")
      : "";
  if (
    body.category !== "operational" ||
    subject.length < 4 ||
    subject.length > 160 ||
    /[\r\n\x00-\x1f\x7f]/u.test(subject) ||
    text_body.length < 20 ||
    text_body.length > 10000
  )
    return null;
  return { subject, text_body };
}
async function campaignCounts(env: Env, id: string) {
  const rows = await env.INTERESTS.prepare(
    "SELECT status, COUNT(*) AS count FROM attendee_message_deliveries WHERE campaign_id = ? GROUP BY status",
  )
    .bind(id)
    .all<{ status: string; count: number }>();
  return Object.fromEntries(
    ["pending", "accepted", "failed", "unknown", "skipped"].map((status) => [
      status,
      rows.results.find((r) => r.status === status)?.count ?? 0,
    ]),
  );
}
export async function processAttendeeMessageBatch(
  env: Env,
  campaign: Campaign,
): Promise<Response> {
  if (!env.EMAIL)
    return json({ error: "Email sending is not configured." }, 503);
  const audience = await attendeeMessageAudience(env),
    eligible = new Map(audience.recipients.map((r) => [r.email_hash, r]));
  const pending = await env.INTERESTS.prepare(
    "SELECT email_hash FROM attendee_message_deliveries WHERE campaign_id = ? AND status = 'pending' ORDER BY email_hash LIMIT 10",
  )
    .bind(campaign.id)
    .all<{ email_hash: string }>();
  for (const row of pending.results) {
    const recipient = eligible.get(row.email_hash);
    const now = new Date().toISOString();
    // An atomic claim prevents concurrent continuation requests from sending twice.
    // Unknown is persisted BEFORE calling the provider: interrupted/ambiguous sends never auto-retry.
    const claimed = await env.INTERESTS.prepare(
      "UPDATE attendee_message_deliveries SET status = ?, attempts = attempts + 1, updated_at = ? WHERE campaign_id = ? AND email_hash = ? AND status = 'pending' RETURNING email_hash",
    )
      .bind(recipient ? "unknown" : "skipped", now, campaign.id, row.email_hash)
      .first();
    if (!claimed || !recipient) continue;
    // Recheck suppression after claiming; imports and preference changes remain authoritative.
    if (
      await env.INTERESTS.prepare(
        "SELECT email_hash FROM attendee_message_preferences WHERE email_hash = ?",
      )
        .bind(row.email_hash)
        .first()
    ) {
      await env.INTERESTS.prepare(
        "UPDATE attendee_message_deliveries SET status = 'skipped' WHERE campaign_id = ? AND email_hash = ?",
      )
        .bind(campaign.id, row.email_hash)
        .run();
      continue;
    }
    let result: EmailSendResult;
    try {
      const text = await renderText(env, recipient, campaign.text_body);
      result = await deliver(env, recipient.email, campaign.subject, text);
    } catch (error) {
      // Only definitive provider rejections can safely be retried. Network errors remain unknown.
      const code =
        isRecord(error) && typeof error.code === "string" ? error.code : "";
      const status = [
        "E_RECIPIENT_SUPPRESSED",
        "E_RATE_LIMIT_EXCEEDED",
        "E_DAILY_LIMIT_EXCEEDED",
        "E_SENDER_NOT_VERIFIED",
        "E_RECIPIENT_NOT_ALLOWED",
        "E_SENDER_DOMAIN_NOT_AVAILABLE",
        "E_VALIDATION_ERROR",
        "E_CONTENT_TOO_LARGE",
        "E_HEADER_NOT_ALLOWED",
        "E_HEADER_USE_API_FIELD",
        "E_HEADER_VALUE_INVALID",
        "E_HEADER_VALUE_TOO_LONG",
      ].includes(code)
        ? "failed"
        : "unknown";
      await env.INTERESTS.prepare(
        "UPDATE attendee_message_deliveries SET status = ?, updated_at = ? WHERE campaign_id = ? AND email_hash = ?",
      )
        .bind(status, new Date().toISOString(), campaign.id, row.email_hash)
        .run();
      continue;
    }
    await env.INTERESTS.prepare(
      "UPDATE attendee_message_deliveries SET status = 'accepted', message_id = ?, updated_at = ? WHERE campaign_id = ? AND email_hash = ?",
    )
      .bind(
        result.messageId ?? null,
        new Date().toISOString(),
        campaign.id,
        row.email_hash,
      )
      .run();
  }
  return json({
    campaign_id: campaign.id,
    ...(await campaignCounts(env, campaign.id)),
  });
}
async function renderText(env: Env, recipient: Recipient, body: string) {
  const token = await signMailToken(
    { email_hash: recipient.email_hash },
    env,
    "attendee-message-unsubscribe",
  );
  return eventMessageText(
    body,
    `${mailOrigin(env)}/event-email/unsubscribe/#token=${token}`,
  );
}
function eventMessageText(body: string, unsubscribeUrl: string): string {
  return `${body}\n\nSDLCAI / Toska Osuuskunta\nQuestions? Reply to info@sdlcai.org.\nYou received this because you registered for SDLCAI 2026.\nUnsubscribe from SDLCAI 2026 event emails:\n${unsubscribeUrl}`;
}
async function deliver(
  env: Env,
  email: string,
  subject: string,
  text: string,
): Promise<EmailSendResult> {
  const token = await signMailToken(
    { email_hash: await mailFingerprint(email, env) },
    env,
    "attendee-message-unsubscribe",
  );
  return env.EMAIL.send({
    from: { email: "info@sdlcai.org", name: "SDLCAI" },
    to: email,
    replyTo: "info@sdlcai.org",
    subject,
    text,
    html: mailHtml(text),
    headers: {
      "List-Unsubscribe": `<${mailOrigin(env)}${unsubscribePath}?token=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
async function unsubscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST")
    return json(
      { error: "Use the unsubscribe button in your email preferences page." },
      405,
    );
  let token: string;
  if (request.headers.get("content-type")?.includes("application/json")) {
    const body = await readJsonWithinLimit(request, 8192);
    if (body instanceof Response) return body;
    token = isRecord(body) && typeof body.token === "string" ? body.token : "";
  } else {
    // RFC 8058 clients POST to the header URL. A GET by a link scanner never unsubscribes.
    const { readFormDataWithinLimit } = await import("./form-utils.ts");
    const form = await readFormDataWithinLimit(request, 1024);
    if (form instanceof Response) return form;
    if (form.get("List-Unsubscribe") !== "One-Click")
      return json({ error: "Invalid unsubscribe request." }, 400);
    token = new URL(request.url).searchParams.get("token") ?? "";
  }
  const payload = await verifyMailToken(
    token,
    env,
    "attendee-message-unsubscribe",
  );
  if (
    !payload ||
    typeof payload.email_hash !== "string" ||
    !/^[\w-]{43}$/u.test(payload.email_hash)
  )
    return json(
      {
        error:
          "This unsubscribe link is invalid. Contact info@sdlcai.org for help.",
      },
      400,
    );
  await env.INTERESTS.prepare(
    "INSERT OR IGNORE INTO attendee_message_preferences(email_hash, unsubscribed_at) VALUES(?, ?)",
  )
    .bind(payload.email_hash, new Date().toISOString())
    .run();
  return json({
    message:
      "You are unsubscribed from SDLCAI 2026 event emails. This does not cancel your registration.",
  });
}
