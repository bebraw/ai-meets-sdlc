import assert from "node:assert/strict";
import test from "node:test";
import {
  handleNewsletterRequest as handle,
  purgeNewsletterData,
  newsletterConsentText,
} from "../worker/newsletter.ts";
import { signMailToken } from "../worker/mail-utils.ts";
import { decryptText } from "../worker/form-utils.ts";
import {
  mailingFixture,
  mailRequest,
  origin,
} from "./helpers/mailing-fixture.mjs";

function captcha(t, overrides = {}) {
  return t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(options.body.get("secret"), "test-secret");
    return Response.json({
      success: true,
      action: "newsletter-signup",
      hostname: "sdlcai.org",
      ...overrides,
    });
  });
}
const subscribe = (f, email = "Reader@Example.test", consent = "yes") =>
  handle(
    new Request(`${origin}/api/newsletter/subscribe`, {
      method: "POST",
      headers: { origin, "cf-connecting-ip": "192.0.2.1" },
      body: new URLSearchParams({
        email,
        consent,
        "cf-turnstile-response": "test-token",
      }),
    }),
    f.env,
  );
const confirm = (f, token) =>
  handle(mailRequest("/api/newsletter/confirm", { token }), f.env);
const unsubscribe = (f, token) =>
  handle(mailRequest("/api/newsletter/unsubscribe", { token }), f.env);
const confirmationToken = (message) =>
  message.text.match(/#token=([\w-]+)/u)[1];

test("marketing flag fails closed; Turnstile config, explicit consent, action and hostname are required", async (t) => {
  const f = await mailingFixture(t),
    mock = captcha(t);
  f.env.NEWSLETTER_ENABLED = "false";
  assert.equal((await subscribe(f)).status, 404);
  assert.equal(mock.mock.callCount(), 0);
  f.env.NEWSLETTER_ENABLED = "true";
  assert.equal((await subscribe(f, "reader@example.test", "no")).status, 400);
  f.env.TURNSTILE_SECRET_KEY = "";
  assert.equal((await subscribe(f)).status, 503);
  f.env.TURNSTILE_SECRET_KEY = "test-secret";
  mock.mock.mockImplementation(async () =>
    Response.json({
      success: true,
      action: "old-interest-form",
      hostname: "sdlcai.org",
    }),
  );
  assert.equal((await subscribe(f)).status, 400);
  mock.mock.mockImplementation(async () =>
    Response.json({
      success: true,
      action: "newsletter-signup",
      hostname: "wrong.example",
    }),
  );
  assert.equal((await subscribe(f)).status, 400);
  assert.equal(f.messages.length, 0);
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers")
        .first()
    ).n,
    0,
  );
});

test("double opt-in encrypts email, records consent atomically, is single use, and unsubscribe works with flag off", async (t) => {
  const f = await mailingFixture(t);
  captcha(t);
  assert.equal((await subscribe(f)).status, 200);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].to, "reader@example.test");
  assert.match(
    f.messages[0].text,
    /https:\/\/sdlcai.org\/subscribe\/confirm\/#token=/u,
  );
  const stored = await f.db
    .prepare("SELECT * FROM newsletter_subscribers")
    .first();
  assert.equal(stored.status, "pending");
  assert.equal(stored.consent_text, newsletterConsentText);
  assert.doesNotMatch(JSON.stringify(stored), /reader@example.test|#token=/u);
  assert.equal(
    await decryptText(
      stored.email_ciphertext,
      stored.email_iv,
      f.env.EMAIL_ENCRYPTION_KEY,
    ),
    "reader@example.test",
  );
  const token = confirmationToken(f.messages[0]);
  assert.notEqual(stored.confirmation_hash, token);
  f.env.NEWSLETTER_ENABLED = "false";
  assert.equal(
    (
      await handle(
        new Request(`${origin}/api/newsletter/confirm?token=${token}`),
        f.env,
      )
    ).status,
    405,
  );
  assert.equal(
    (await f.db.prepare("SELECT status FROM newsletter_subscribers").first())
      .status,
    "pending",
  );
  const result = await confirm(f, token);
  assert.equal(result.status, 200);
  const unsubscribeToken = new URL(
    (await result.json()).unsubscribe_url,
  ).hash.slice(7);
  assert.equal((await confirm(f, token)).status, 400);
  assert.equal((await unsubscribe(f, `${unsubscribeToken}x`)).status, 400);
  assert.equal((await unsubscribe(f, unsubscribeToken)).status, 200);
  assert.equal((await unsubscribe(f, unsubscribeToken)).status, 200);
  const removed = await f.db
    .prepare("SELECT * FROM newsletter_subscribers")
    .first();
  assert.equal(removed.status, "unsubscribed");
  assert.equal(removed.email_ciphertext, null);
  assert.equal(removed.confirmation_hash, null);
  const events = await f.db
    .prepare("SELECT action FROM newsletter_consent_events ORDER BY id")
    .all();
  assert.deepEqual(
    events.results.map((row) => row.action),
    ["requested", "confirmed", "unsubscribed"],
  );
});

test("concurrent requests send one confirmation, expire correctly, and resubscription requires fresh confirmation", async (t) => {
  const f = await mailingFixture(t);
  captcha(t);
  await Promise.all([subscribe(f), subscribe(f)]);
  assert.equal(f.messages.length, 1);
  const old = confirmationToken(f.messages[0]);
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET confirmation_expires_at = '2000-01-01T00:00:00Z'",
    )
    .run();
  assert.equal((await confirm(f, old)).status, 400);
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET requested_at = '2000-01-01T00:00:00Z'",
    )
    .run();
  await subscribe(f);
  const fresh = confirmationToken(f.messages[1]);
  assert.equal((await confirm(f, old)).status, 400);
  const confirmed = await (await confirm(f, fresh)).json();
  await subscribe(f);
  assert.equal(
    f.messages.length,
    2,
    "Active subscribers are not sent repeated confirmations",
  );
  await unsubscribe(f, new URL(confirmed.unsubscribe_url).hash.slice(7));
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET requested_at = '2000-01-01T00:00:00Z'",
    )
    .run();
  await subscribe(f);
  assert.equal(
    (await f.db.prepare("SELECT status FROM newsletter_subscribers").first())
      .status,
    "unsubscribed",
  );
  assert.equal((await confirm(f, fresh)).status, 400);
  assert.equal(
    (await confirm(f, confirmationToken(f.messages[2]))).status,
    200,
  );
});

test("signup rate limits, rejected mail, and daily retention cleanup preserve consent boundaries", async (t) => {
  const f = await mailingFixture(t);
  captcha(t);
  for (let i = 0; i < 10; i++)
    assert.equal((await subscribe(f, `reader${i}@example.test`)).status, 200);
  assert.equal((await subscribe(f, "reader11@example.test")).status, 429);
  await f.db.prepare("DELETE FROM newsletter_signup_limits").run();
  f.env.EMAIL.send = async () => {
    throw new Error("Local simulated rejection");
  };
  assert.equal((await subscribe(f, "failed@example.test")).status, 502);
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT confirmation_hash FROM newsletter_subscribers ORDER BY requested_at DESC LIMIT 1",
        )
        .first()
    ).confirmation_hash,
    null,
  );
  const row = await f.db
    .prepare("SELECT id FROM newsletter_subscribers LIMIT 1")
    .first();
  const wrongScope = await signMailToken(
    { id: row.id },
    f.env,
    "attendee-message-unsubscribe",
  );
  assert.equal((await unsubscribe(f, wrongScope)).status, 400);
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET requested_at = '2000-01-01T00:00:00Z'",
    )
    .run();
  await purgeNewsletterData(f.env);
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers")
        .first()
    ).n,
    0,
  );
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM newsletter_consent_events")
        .first()
    ).n,
    0,
  );
});

test("admin subscriber management is CSRF guarded and removes the address with marketing disabled", async (t) => {
  const f = await mailingFixture(t);
  captcha(t);
  await subscribe(f);
  const row = await f.db
    .prepare("SELECT id FROM newsletter_subscribers")
    .first();
  f.env.NEWSLETTER_ENABLED = "false";
  const data = await (
    await handle(mailRequest("/api/admin/newsletter", undefined, "GET"), f.env)
  ).json();
  assert.equal(data.enabled, false);
  assert.equal(data.subscribers[0].email, "reader@example.test");
  assert.equal(data.events[0].action, "requested");
  assert.equal(data.subscribers[0].confirmation_hash, undefined);
  assert.equal(
    (await handle(mailRequest("/api/admin/newsletter", { id: row.id }), f.env))
      .status,
    403,
  );
  assert.equal(
    (
      await handle(
        mailRequest(
          "/api/admin/newsletter",
          { id: row.id },
          "POST",
          "manage-newsletter",
        ),
        f.env,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.db
        .prepare("SELECT email_ciphertext FROM newsletter_subscribers")
        .first()
    ).email_ciphertext,
    null,
  );
});
