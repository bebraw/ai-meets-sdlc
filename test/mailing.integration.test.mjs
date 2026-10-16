import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerFixture } from "./helpers/worker-fixture.mjs";

const origin = "https://sdlcai.org";
const vars = {
  ADMIN_USERNAME: "mail-admin",
  ADMIN_PASSWORD: "local-mail-test-password",
  EMAIL_ENCRYPTION_KEY: "isolated-mail-test-key",
  TURNSTILE_SITE_KEY: "local-test-site-key",
  TURNSTILE_SECRET_KEY: "local-test-secret",
  PUBLIC_SITE_ORIGIN: origin,
};
const authorization = `Basic ${Buffer.from(`${vars.ADMIN_USERNAME}:${vars.ADMIN_PASSWORD}`).toString("base64")}`;

test("mailing admin routes require organizer authentication; feature flag gates public HTML and signup", async (t) => {
  const f = await createWorkerFixture({
    vars: { ...vars, NEWSLETTER_ENABLED: "false" },
  });
  t.after(() => f.dispose());
  for (const path of [
    "/api/admin/attendee-messages",
    "/api/admin/attendee-messages/draft",
    "/api/admin/attendee-messages/deliveries",
    "/api/admin/newsletter",
    "/api/admin/newsletter/mailrelay",
  ]) {
    assert.equal((await f.worker.fetch(origin + path)).status, 401);
  }
  for (const path of ["/admin/attendee-messages/", "/admin/newsletter/"]) {
    assert.equal(
      (await f.worker.fetch(origin + path, { redirect: "manual" })).status,
      303,
    );
    const page = await f.worker.fetch(origin + path, {
      headers: { authorization },
    });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
  const home = await (await f.worker.fetch(origin)).text();
  assert.doesNotMatch(home, /data-newsletter-entry|href="\/subscribe\/"/u);
  const closed = await f.worker.fetch(origin + "/subscribe/");
  assert.equal(closed.headers.get("cache-control"), "no-store");
  const html = await closed.text();
  assert.match(html, /subscriptions are not open yet/u);
  assert.doesNotMatch(html, /data-newsletter-form/u);
  const signup = await f.worker.fetch(origin + "/api/newsletter/subscribe", {
    method: "POST",
    body: new URLSearchParams({
      email: "attendee@example.test",
      consent: "yes",
    }),
  });
  assert.equal(signup.status, 404);
  const preview = await f.worker.fetch(
    origin + "/api/admin/attendee-messages/preview",
    {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-admin-action": "attendee-messages",
      },
      body: JSON.stringify({
        category: "operational",
        subject: "Event information",
        text_body: "Welcome to the event. Here are the practical details.",
      }),
    },
  );
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).recipient_count, 0);
  for (const path of [
    "/subscribe/confirm/",
    "/subscribe/unsubscribe/",
    "/event-email/unsubscribe/",
  ]) {
    const page = await f.worker.fetch(origin + path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
});

test("enabling signup reveals entries and protected form, without enabling marketing campaigns", async (t) => {
  const f = await createWorkerFixture({
    vars: { ...vars, NEWSLETTER_ENABLED: "true" },
  });
  t.after(() => f.dispose());
  assert.match(
    await (await f.worker.fetch(origin)).text(),
    /href="\/subscribe\/"/u,
  );
  const html = await (await f.worker.fetch(origin + "/subscribe/")).text();
  assert.match(html, /data-newsletter-form/u);
  assert.match(html, /data-action="newsletter-signup"/u);
  assert.match(html, /data-sitekey="local-test-site-key"/u);
  assert.doesNotMatch(html, /data-newsletter-disabled/u);
  const newsletter = await f.worker.fetch(origin + "/api/admin/newsletter", {
    headers: { authorization },
  });
  assert.equal((await newsletter.json()).enabled, true);
  const promotion = await f.worker.fetch(
    origin + "/api/admin/attendee-messages/preview",
    {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-admin-action": "attendee-messages",
      },
      body: JSON.stringify({
        category: "promotion",
        subject: "Future event promotion",
        text_body: "Come to our next event and purchase your tickets now.",
      }),
    },
  );
  assert.equal(promotion.status, 400);
});
