import {
  decryptText,
  encryptText,
  getExpectedTurnstileHostnames,
  getTurnstileToken,
  hashText,
  isLikelyEmail,
  jsonResponse as json,
  normalizeEmail,
  readFormDataWithinLimit,
  requireAdminAction,
  sha256Hex,
} from "./form-utils.ts";
import {
  isRecord,
  readJsonWithinLimit,
  createToken,
} from "./speaker-workspace-utils.ts";
import { verifyTurnstile } from "./turnstile.ts";
import { mailrelayStatus, syncMailrelay } from "./mailrelay.ts";
import {
  mailHtml,
  mailOrigin,
  privateMailResponse,
  signMailToken,
  verifyMailToken,
} from "./mail-utils.ts";

export const newsletterConsentVersion = "sdlcai-news-2026-10-12";
export const newsletterConsentText =
  "Email me SDLCAI news, including future events. I can unsubscribe at any time.";
export const newsletterTurnstileAction = "newsletter-signup";
export const newsletterEnabled = (env: Env) =>
  String(env.NEWSLETTER_ENABLED) === "true";
interface Subscriber {
  id: string;
  email_hash: string;
  email_ciphertext: string | null;
  email_iv: string | null;
  status: string;
  consent_version: string;
  consent_text: string;
  requested_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}
const genericSignup = () =>
  json({
    message:
      "If this address needs confirmation, an email is on its way. Check your inbox and spam folder.",
  });

export async function handleNewsletterRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (
    !path.startsWith("/api/newsletter/") &&
    path !== "/api/admin/newsletter" &&
    path !== "/api/admin/newsletter/mailrelay"
  )
    return null;
  try {
    return privateMailResponse(await handle(request, env, path));
  } catch {
    console.error("newsletter_request_failed");
    return privateMailResponse(
      json(
        {
          error:
            "Subscriptions are temporarily unavailable. Please try again later.",
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
  if (path === "/api/newsletter/subscribe" && !newsletterEnabled(env))
    return json({ error: "Email subscriptions are not open yet." }, 404);
  if (!env.EMAIL_ENCRYPTION_KEY)
    return json({ error: "Subscriptions are temporarily unavailable." }, 503);
  if (path === "/api/admin/newsletter/mailrelay") {
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    const denied = requireAdminAction(request, "manage-newsletter");
    if (denied) return denied;
    const body = await readJsonWithinLimit(request, 4096);
    if (body instanceof Response) return body;
    if (
      !isRecord(body) ||
      !["start", "sync", "retry"].includes(String(body.action))
    )
      return json({ error: "Choose start, sync or retry." }, 400);
    const status = await mailrelayStatus(env);
    if (!status.ready)
      return json(
        { error: status.error ?? "Mailrelay sync is disabled." },
        409,
      );
    if (body.action === "start")
      await env.INTERESTS.prepare(
        "UPDATE newsletter_mailrelay_sync SET checked_at = NULL WHERE state IN ('synced', 'blocked') AND desired_status = 'subscribed'",
      ).run();
    if (body.action === "retry")
      await env.INTERESTS.prepare(
        "UPDATE newsletter_mailrelay_sync SET state = 'pending', next_attempt_at = '', error_code = NULL WHERE state = 'failed'",
      ).run();
    const result = await syncMailrelay(env);
    return json({ ...result, mailrelay: await mailrelayStatus(env) });
  }
  if (path === "/api/admin/newsletter") {
    if (request.method === "GET") {
      const offset = Number(
        new URL(request.url).searchParams.get("offset") ?? "0",
      );
      if (!Number.isSafeInteger(offset) || offset < 0)
        return json({ error: "Invalid offset." }, 400);
      const result = await env.INTERESTS.prepare(
        `SELECT s.*, j.state AS sync_state, j.remote_status, j.checked_at, j.error_code
         FROM newsletter_subscribers s LEFT JOIN newsletter_mailrelay_sync j ON j.subscriber_id = s.id
         ORDER BY s.requested_at DESC, s.id LIMIT 51 OFFSET ?`,
      )
        .bind(offset)
        .all<
          Subscriber & {
            sync_state: string | null;
            remote_status: string | null;
            checked_at: string | null;
            error_code: string | null;
          }
        >();
      const rows = result.results.slice(0, 50);
      const counts = await env.INTERESTS.prepare(
        "SELECT status, COUNT(*) AS count FROM newsletter_subscribers GROUP BY status",
      ).all();
      const subscribers = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          status: row.status,
          consent_version: row.consent_version,
          consent_text: row.consent_text,
          requested_at: row.requested_at,
          confirmed_at: row.confirmed_at,
          unsubscribed_at: row.unsubscribed_at,
          sync_state: row.sync_state,
          remote_status: row.remote_status,
          checked_at: row.checked_at,
          sync_error: row.error_code,
          email:
            row.email_ciphertext && row.email_iv
              ? await decryptText(
                  row.email_ciphertext,
                  row.email_iv,
                  env.EMAIL_ENCRYPTION_KEY,
                )
              : "Address removed",
        })),
      );
      const events = rows.length
        ? (
            await env.INTERESTS.prepare(
              `SELECT subscriber_id, action, consent_version, occurred_at FROM newsletter_consent_events WHERE subscriber_id IN (${rows.map(() => "?").join(",")}) ORDER BY id DESC`,
            )
              .bind(...rows.map((row) => row.id))
              .all()
          ).results
        : [];
      return json({
        enabled: newsletterEnabled(env),
        mailrelay: await mailrelayStatus(env),
        counts: counts.results,
        subscribers,
        events,
        next_offset: result.results.length > 50 ? offset + 50 : null,
      });
    }
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    const denied = requireAdminAction(request, "manage-newsletter");
    if (denied) return denied;
    const body = await readJsonWithinLimit(request, 4096);
    if (body instanceof Response) return body;
    if (
      !isRecord(body) ||
      typeof body.id !== "string" ||
      !/^[\da-f-]{36}$/u.test(body.id)
    )
      return json({ error: "Choose a subscriber." }, 400);
    await unsubscribeNewsletter(env, body.id);
    return json({ message: "Subscription removed." });
  }
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  // Token-based preference changes do not depend on the marketing flag.
  if (
    path === "/api/newsletter/confirm" ||
    path === "/api/newsletter/unsubscribe"
  ) {
    const body = await readJsonWithinLimit(request, 8192);
    if (body instanceof Response) return body;
    const token =
      isRecord(body) && typeof body.token === "string" ? body.token : "";
    if (path.endsWith("/unsubscribe")) {
      const payload = await verifyMailToken(
        token,
        env,
        "newsletter-unsubscribe",
      );
      if (!payload || typeof payload.id !== "string")
        return json(
          {
            error:
              "This unsubscribe link is invalid. Contact info@sdlcai.org for help.",
          },
          400,
        );
      await unsubscribeNewsletter(env, payload.id);
      return json({ message: "You are unsubscribed from SDLCAI news." });
    }
    if (!/^[\w-]{43}$/u.test(token)) return invalidConfirmation();
    const now = new Date().toISOString();
    const row = await env.INTERESTS.prepare(
      `UPDATE newsletter_subscribers SET status = 'subscribed', confirmed_at = ?, unsubscribed_at = NULL, confirmation_hash = NULL, confirmation_expires_at = NULL
      WHERE confirmation_hash = ? AND confirmation_expires_at > ? RETURNING id`,
    )
      .bind(now, await sha256Hex(token), now)
      .first<{ id: string }>();
    if (!row) return invalidConfirmation();
    const unsubscribe = await signMailToken(
      { id: row.id },
      env,
      "newsletter-unsubscribe",
    );
    return json({
      message:
        "Your subscription is confirmed. We'll email you SDLCAI news when there is something to share.",
      unsubscribe_url: `${mailOrigin(env)}/subscribe/unsubscribe/#token=${unsubscribe}`,
    });
  }
  if (path !== "/api/newsletter/subscribe")
    return json({ error: "Not found." }, 404);
  if (
    !env.EMAIL ||
    !env.TURNSTILE_SITE_KEY ||
    !env.TURNSTILE_SECRET_KEY ||
    !getExpectedTurnstileHostnames(env).size
  )
    return json(
      { error: "Email subscriptions are temporarily unavailable." },
      503,
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return json({ error: "Open the signup form on sdlcai.org." }, 403);
  const form = await readFormDataWithinLimit(request, 16 * 1024);
  if (form instanceof Response) return form;
  const email = normalizeEmail(form.get("email"));
  if (
    !isLikelyEmail(email) ||
    email.length > 254 ||
    form.get("consent") !== "yes"
  )
    return json(
      { error: "Enter your email and agree to receive SDLCAI news." },
      400,
    );
  const verification = await verifyTurnstile({
    request,
    token: getTurnstileToken(form),
    secret: env.TURNSTILE_SECRET_KEY,
    expectedAction: newsletterTurnstileAction,
    expectedHostnames: getExpectedTurnstileHostnames(env),
  });
  if (!verification.success)
    return json({ error: "Complete the security check and try again." }, 400);
  const nowMs = Date.now(),
    now = new Date(nowMs).toISOString();
  const ipHash = await hashText(
    request.headers.get("cf-connecting-ip") ?? "unknown",
    env.EMAIL_ENCRYPTION_KEY,
    "newsletter-signup-ip",
  );
  const window = Math.floor(nowMs / 3_600_000);
  const rate = await env.INTERESTS.prepare(
    `INSERT INTO newsletter_signup_limits(ip_hash, window_start, attempts) VALUES(?, ?, 1)
    ON CONFLICT(ip_hash) DO UPDATE SET window_start = excluded.window_start,
    attempts = CASE WHEN window_start != excluded.window_start THEN 1 ELSE attempts + 1 END
    WHERE window_start != excluded.window_start OR attempts < 10 RETURNING attempts`,
  )
    .bind(ipHash, window)
    .first();
  if (!rate)
    return json(
      { error: "Too many signup requests. Please try again in an hour." },
      429,
    );
  const encrypted = await encryptText(email, env.EMAIL_ENCRYPTION_KEY),
    token = createToken();
  const tokenHash = await sha256Hex(token);
  const row = await env.INTERESTS.prepare(
    `INSERT INTO newsletter_subscribers(id, email_hash, email_ciphertext, email_iv, status, consent_version, consent_text, requested_at, confirmation_hash, confirmation_expires_at)
    VALUES(?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    ON CONFLICT(email_hash) DO UPDATE SET email_ciphertext = excluded.email_ciphertext, email_iv = excluded.email_iv,
    consent_version = excluded.consent_version, consent_text = excluded.consent_text, requested_at = excluded.requested_at,
    confirmation_hash = excluded.confirmation_hash, confirmation_expires_at = excluded.confirmation_expires_at
    WHERE status != 'subscribed' AND requested_at < ? RETURNING id`,
  )
    .bind(
      crypto.randomUUID(),
      await hashText(email, env.EMAIL_ENCRYPTION_KEY, "newsletter-address"),
      encrypted.ciphertext,
      encrypted.iv,
      newsletterConsentVersion,
      newsletterConsentText,
      now,
      tokenHash,
      new Date(nowMs + 86_400_000).toISOString(),
      new Date(nowMs - 600_000).toISOString(),
    )
    .first<{ id: string }>();
  if (!row) return genericSignup();
  const link = `${mailOrigin(env)}/subscribe/confirm/#token=${token}`;
  const text = `Confirm your SDLCAI news subscription\n\nYou asked to receive SDLCAI news, including future events. Confirm your email address using this link within 24 hours:\n\n${link}\n\nIf you did not request this, ignore this email. You will not be subscribed.\n\nYou can unsubscribe at any time. Questions? Reply to info@sdlcai.org.\n\nSDLCAI / Toska Osuuskunta`;
  try {
    await env.EMAIL.send({
      from: { email: "info@sdlcai.org", name: "SDLCAI" },
      to: email,
      replyTo: "info@sdlcai.org",
      subject: "Confirm your SDLCAI news subscription",
      text,
      html: mailHtml(text),
    });
  } catch {
    // Invalidate only this attempt; a concurrent confirmation or newer request wins.
    await env.INTERESTS.prepare(
      "UPDATE newsletter_subscribers SET confirmation_hash = NULL, confirmation_expires_at = NULL WHERE id = ? AND confirmation_hash = ?",
    )
      .bind(row.id, tokenHash)
      .run();
    return json(
      {
        error:
          "The confirmation email could not be sent. Please try again in ten minutes.",
      },
      502,
    );
  }
  return genericSignup();
}
const invalidConfirmation = () =>
  json(
    {
      error:
        "This confirmation link has expired or was already used. Request a new one from the signup page.",
    },
    400,
  );
export async function unsubscribeNewsletter(
  env: Env,
  id: string,
): Promise<void> {
  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      `UPDATE newsletter_subscribers SET status = 'unsubscribed', email_ciphertext = NULL, email_iv = NULL, confirmation_hash = NULL, confirmation_expires_at = NULL,
    unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE id = ?`,
    ).bind(new Date().toISOString(), id),
    env.INTERESTS.prepare(
      `UPDATE newsletter_mailrelay_sync SET state = 'synced', email_ciphertext = NULL, email_iv = NULL, remote_status = 'never_synced'
       WHERE subscriber_id = ? AND desired_status = 'unsubscribed' AND NOT EXISTS(SELECT 1 FROM newsletter_mailrelay_control WHERE scope IS NOT NULL)`,
    ).bind(id),
  ]);
}
export async function purgeNewsletterData(env: Env): Promise<void> {
  const now = Date.now();
  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      "DELETE FROM newsletter_subscribers WHERE status = 'pending' AND requested_at < ?",
    ).bind(new Date(now - 7 * 86_400_000).toISOString()),
    env.INTERESTS.prepare(
      `DELETE FROM newsletter_subscribers WHERE status = 'unsubscribed' AND unsubscribed_at < ? AND (confirmation_expires_at IS NULL OR confirmation_expires_at < ?)
       AND NOT EXISTS(SELECT 1 FROM newsletter_mailrelay_sync j WHERE j.subscriber_id = newsletter_subscribers.id AND j.state IN ('pending', 'failed'))`,
    ).bind(
      new Date(now - 365 * 86_400_000).toISOString(),
      new Date(now).toISOString(),
    ),
    // A resubscribe request can temporarily store an unsubscribed address. Remove it after expiry.
    env.INTERESTS.prepare(
      "UPDATE newsletter_subscribers SET email_ciphertext = NULL, email_iv = NULL, confirmation_hash = NULL, confirmation_expires_at = NULL WHERE status = 'unsubscribed' AND confirmation_expires_at < ?",
    ).bind(new Date(now).toISOString()),
    env.INTERESTS.prepare(
      "DELETE FROM newsletter_signup_limits WHERE window_start <= ?",
    ).bind(Math.floor(now / 3_600_000) - 24),
  ]);
}
