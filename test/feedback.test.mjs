import assert from "node:assert/strict";
import test from "node:test";
import {
  handleFeedbackRequest as handle,
  purgeExpiredFeedback,
} from "../worker/feedback.ts";
import {
  feedbackNoticeVersion,
  feedbackQuestions,
} from "../shared/feedback.ts";
import { decryptText } from "../worker/form-utils.ts";
import { mailingFixture } from "./helpers/mailing-fixture.mjs";

const origin = "https://sdlcai.org";
const authorization = `Basic ${Buffer.from("feedback-admin:local-test-password").toString("base64")}`;
async function fixture(t) {
  const f = await mailingFixture(t);
  f.env.ADMIN_USERNAME = "feedback-admin";
  f.env.ADMIN_PASSWORD = "local-test-password";
  return f;
}
function captcha(t, overrides = {}) {
  return t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(init.body.get("secret"), "test-secret");
    return Response.json({
      success: true,
      action: "visitor-feedback",
      hostname: "sdlcai.org",
      ...overrides,
    });
  });
}
function answers(code = "a".repeat(64)) {
  const form = new FormData();
  for (const q of feedbackQuestions) {
    if (q.kind === "rating") form.set(q.id, "4");
    else if (q.kind === "choice" || q.kind === "multiple")
      form.set(q.id, q.options[0]);
    else
      form.set(
        q.id,
        "A useful event. <script>alert('private comment')</script>",
      );
  }
  form.set("consent", "yes");
  form.set("noticeVersion", feedbackNoticeVersion);
  form.set("receipt", code);
  form.set("cf-turnstile-response", "test-token");
  return form;
}
const request = (path, body, method = "POST", headers = {}) =>
  new Request(origin + path, {
    method,
    headers: { origin, ...headers },
    ...(body ? { body } : {}),
  });
const submit = (f, form = answers()) =>
  handle(request("/api/feedback", form), f.env);
const own = (f, code = "a".repeat(64), method = "POST") =>
  handle(
    request(
      "/api/feedback/response",
      new URLSearchParams({ receipt: code }),
      method,
    ),
    f.env,
  );
const dashboard = (f, offset = 0) =>
  handle(
    request(`/api/admin/feedback?offset=${offset}`, null, "GET", {
      authorization,
    }),
    f.env,
  );
const count = async (f) =>
  (
    await f.db
      .prepare(
        "SELECT count FROM visitor_feedback_totals WHERE question = 'responses'",
      )
      .first()
  )?.count ?? 0;

test("feedback validates origin, consent, bounded fields and Turnstile configuration, action and hostname", async (t) => {
  const f = await fixture(t),
    mock = captcha(t);
  assert.equal(
    (
      await handle(
        request("/api/feedback", answers(), "POST", {
          origin: "https://other.test",
        }),
        f.env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        new Request(origin + "/api/feedback", {
          method: "POST",
          body: answers(),
        }),
        f.env,
      )
    ).status,
    403,
  );
  for (const [key, value] of [
    ["consent", "no"],
    ["noticeVersion", "old"],
    ["overall", "6"],
    ["valuable", "unknown"],
    ["email", "must-not-store@example.test"],
    ["website", "spam"],
    ["best", "x".repeat(2001)],
    ["receipt", "short"],
  ]) {
    const form = answers();
    form.set(key, value);
    assert.equal((await submit(f, form)).status, 400, key);
  }
  const repeated = answers();
  repeated.append("overall", "5");
  assert.equal((await submit(f, repeated)).status, 400);
  const multiple = answers();
  multiple.append("valuable", multiple.get("valuable"));
  assert.equal((await submit(f, multiple)).status, 400);
  assert.equal(mock.mock.callCount(), 0);
  const oversized = await handle(
    request("/api/feedback", new URLSearchParams({ best: "x".repeat(40000) })),
    f.env,
  );
  assert.equal(oversized.status, 413);
  f.env.TURNSTILE_SECRET_KEY = "";
  assert.equal((await submit(f)).status, 503);
  f.env.TURNSTILE_SECRET_KEY = "test-secret";
  for (const overrides of [
    { action: "newsletter-signup" },
    { hostname: "other.test" },
    { success: false },
  ]) {
    mock.mock.mockImplementation(async () =>
      Response.json({
        success: true,
        action: "visitor-feedback",
        hostname: "sdlcai.org",
        ...overrides,
      }),
    );
    assert.equal((await submit(f)).status, 400);
  }
  const missingToken = answers();
  missingToken.delete("cf-turnstile-response");
  assert.equal((await submit(f, missingToken)).status, 400);
  assert.equal(await count(f), 0);
});

test("encrypted responses are unlinked to recipients; concurrent retries count once and require a private code or admin", async (t) => {
  const f = await fixture(t);
  captcha(t);
  const before = Date.now();
  const responses = await Promise.all([submit(f), submit(f)]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
  assert.equal(await count(f), 1);
  const row = await f.db.prepare("SELECT * FROM visitor_feedback").first();
  assert.deepEqual(Object.keys(row).sort(), [
    "ciphertext",
    "expires_at",
    "id",
    "iv",
    "receipt_hash",
  ]);
  assert.doesNotMatch(JSON.stringify(row), /private comment|a{64}|192\.0\.2/u);
  assert.equal(row.receipt_hash.length, 64);
  assert.ok(
    row.expires_at >= before + 90 * 86400000 &&
      row.expires_at <= Date.now() + 90 * 86400000,
  );
  const decrypted = JSON.parse(
    await decryptText(row.ciphertext, row.iv, f.env.EMAIL_ENCRYPTION_KEY),
  );
  assert.equal(decrypted.consent, true);
  assert.equal(decrypted.noticeVersion, feedbackNoticeVersion);
  assert.match(decrypted.answers.best, /private comment/u);
  const view = await own(f);
  assert.equal(view.status, 200);
  const payload = await view.json();
  assert.deepEqual(payload.answers, decrypted.answers);
  assert.equal(payload.id, undefined);
  assert.equal(payload.receipt_hash, undefined);
  assert.equal((await own(f, "b".repeat(64))).status, 404);
  assert.equal(
    (await handle(request("/api/admin/feedback", null, "GET"), f.env)).status,
    401,
  );
  const result = await dashboard(f);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("x-robots-tag"), /noindex/u);
  const data = await result.json();
  assert.equal(data.activeCount, 1);
  assert.equal(data.responses.length, 1);
  assert.equal(data.responses[0].receipt_hash, undefined);
  assert.equal(
    (await handle(request("/api/feedback/response", null, "GET"), f.env))
      .status,
    405,
  );
  assert.equal(f.messages.length, 0);
});

test("concurrent withdrawal removes raw answers and totals exactly once; admin deletion checks CSRF", async (t) => {
  const f = await fixture(t);
  captcha(t);
  await submit(f);
  const id = (await f.db.prepare("SELECT id FROM visitor_feedback").first()).id;
  const body = () => new URLSearchParams({ id });
  assert.equal(
    (
      await handle(
        request("/api/admin/feedback", body(), "DELETE", { authorization }),
        f.env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        request("/api/admin/feedback", body(), "DELETE", {
          authorization,
          origin: "https://other.test",
          "x-admin-action": "delete-feedback",
        }),
        f.env,
      )
    ).status,
    403,
  );
  const deleted = await Promise.all([
    own(f, "a".repeat(64), "DELETE"),
    handle(
      request("/api/admin/feedback", body(), "DELETE", {
        authorization,
        "x-admin-action": "delete-feedback",
      }),
      f.env,
    ),
  ]);
  assert.ok(deleted.every((r) => [200, 404].includes(r.status)));
  assert.equal(await count(f), 0);
  assert.equal(
    (await f.db.prepare("SELECT COUNT(*) AS n FROM visitor_feedback").first())
      .n,
    0,
  );
  assert.equal((await own(f)).status, 404);
  assert.equal(
    (
      await f.db
        .prepare("SELECT SUM(count) AS n FROM visitor_feedback_totals")
        .first()
    ).n,
    0,
  );
});

test("expiry hides raw answers immediately, cleanup removes them, and only independent totals survive", async (t) => {
  const f = await fixture(t);
  captcha(t);
  await submit(f);
  await f.db
    .prepare("UPDATE visitor_feedback SET expires_at = ?")
    .bind(Date.now() - 1)
    .run();
  assert.equal((await own(f)).status, 404);
  assert.equal((await own(f, "a".repeat(64), "DELETE")).status, 404);
  await purgeExpiredFeedback(f.env);
  assert.equal(
    (await f.db.prepare("SELECT COUNT(*) AS n FROM visitor_feedback").first())
      .n,
    0,
  );
  assert.equal(await count(f), 1);
  const dashboardData = await (await dashboard(f)).json();
  assert.equal(dashboardData.activeCount, 0);
  assert.deepEqual(dashboardData.responses, []);
  assert.doesNotMatch(
    JSON.stringify(dashboardData),
    /private comment|receipt|ciphertext|expires_at/u,
  );
});

test("admin response pagination is bounded and results access purges expired data", async (t) => {
  const f = await fixture(t);
  captcha(t);
  for (let index = 0; index < 22; index++)
    await submit(f, answers(index.toString(16).padStart(64, "0")));
  const first = await (await dashboard(f)).json(),
    second = await (await dashboard(f, 20)).json();
  assert.equal(first.responses.length, 20);
  assert.equal(first.nextOffset, 20);
  assert.equal(second.responses.length, 2);
  assert.equal(second.nextOffset, null);
  assert.equal(
    new Set([...first.responses, ...second.responses].map((item) => item.id))
      .size,
    22,
  );
  await f.db.prepare("UPDATE visitor_feedback SET expires_at = 1").run();
  assert.equal((await (await dashboard(f)).json()).activeCount, 0);
  assert.equal(
    (await f.db.prepare("SELECT COUNT(*) AS n FROM visitor_feedback").first())
      .n,
    0,
  );
  assert.equal(await count(f), 22);
});
