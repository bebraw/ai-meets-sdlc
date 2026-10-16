import assert from "node:assert/strict";
import test from "node:test";
import {
  handleFeedbackRequest as handle,
  purgeExpiredFeedback,
} from "../worker/feedback.ts";
import {
  feedbackNoticeVersion,
  feedbackFormVersion,
  feedbackQuestions,
  parseFeedback,
  recommendationSummary,
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
    if (q.kind === "nps") form.set(q.id, "9");
    else if (q.kind === "rating") form.set(q.id, "4");
    else if (q.kind === "choice" || q.kind === "multiple")
      form.set(q.id, q.options[0]);
    else
      form.set(
        q.id,
        q.showWhen
          ? ""
          : "A useful event. <script>alert('private comment')</script>",
      );
  }
  form.set("consent", "yes");
  form.set("noticeVersion", feedbackNoticeVersion);
  form.set("formVersion", feedbackFormVersion);
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

test("recommendation uses integer 0–10 answers and stale questionnaires must reload", () => {
  for (let rating = 0; rating <= 10; rating++) {
    const form = answers();
    form.set("recommend", String(rating));
    assert.equal(parseFeedback(form).answers.recommend, String(rating));
  }
  for (const value of ["", "-1", "11", "7.5", "09", "likely"]) {
    const form = answers();
    form.set("recommend", value);
    assert.equal(typeof parseFeedback(form), "string", value);
  }
  const form = answers();
  form.delete("recommend");
  assert.equal(typeof parseFeedback(form), "string");
  form.delete("formVersion");
  assert.match(parseFeedback(form), /Reload/u);
  form.set("formVersion", "1");
  assert.match(parseFeedback(form), /Reload/u);
  form.set("formVersion", "2");
  assert.match(parseFeedback(form), /Reload/u);
  form.set("formVersion", "4");
  assert.equal(typeof parseFeedback(form), "string");
  form.set("formVersion", feedbackFormVersion);
  form.set("recommend", "9");
  form.append("recommend", "10");
  assert.equal(typeof parseFeedback(form), "string");
  form.delete("recommend");
  form.set("recommend", new Blob(["9"]), "rating.txt");
  assert.equal(typeof parseFeedback(form), "string");
  form.set("recommend", "9");
  form.set("formVersion", new Blob(["2"]), "version.txt");
  assert.equal(typeof parseFeedback(form), "string");
});

test("NPS uses all answered ratings in its denominator and never invents a zero for missing answers", () => {
  const rows = (ratings) =>
    ratings.map(([answer, count]) => ({
      question: "recommend",
      answer: String(answer),
      count,
    }));
  assert.deepEqual(recommendationSummary([]), {
    answered: 0,
    promoters: 0,
    passives: 0,
    detractors: 0,
    score: null,
  });
  assert.deepEqual(
    recommendationSummary([
      ...rows([
        [0, 1],
        [6, 1],
        [7, 1],
        [8, 1],
        [9, 1],
        [10, 2],
      ]),
      { question: "responses", answer: "all", count: 20 },
      ...rows([
        [11, 100],
        ["", 100],
        ["09", 100],
        [5, -1],
        [5, 0.5],
      ]),
    ]),
    { answered: 7, promoters: 3, passives: 2, detractors: 2, score: 14 },
  );
  assert.equal(recommendationSummary(rows([[0, 1]])).score, -100);
  assert.equal(recommendationSummary(rows([[10, 1]])).score, 100);
  assert.equal(
    recommendationSummary(
      rows([
        [7, 2],
        [8, 1],
      ]),
    ).score,
    0,
  );
});

test("unscored answers and None remain distinct from numeric ratings through submission and withdrawal", async (t) => {
  const f = await fixture(t);
  const mock = captcha(t);
  const obsolete = answers();
  obsolete.set("formVersion", "2");
  assert.equal((await submit(f, obsolete)).status, 400);
  assert.equal(mock.mock.callCount(), 0);
  const current = answers();
  current.set("recommend", "0");
  current.set("academic", "Did not attend these talks");
  current.set("industry", "Unable to assess");
  current.set("networking", "Did not use these opportunities");
  current.set("valuable", "None");
  current.set("return", "Definitely not");
  assert.equal((await submit(f, current)).status, 200);
  const saved = await (await own(f)).json();
  assert.equal(saved.answers.academic, "Did not attend these talks");
  assert.deepEqual(saved.answers.valuable, ["None"]);
  const rated = answers("b".repeat(64));
  rated.set("valuable", "Other");
  rated.set("valuableOther", "A private suggestion.");
  assert.equal((await submit(f, rated)).status, 200);
  let data = await (await dashboard(f)).json();
  assert.equal(await count(f), 2);
  assert.equal(
    data.totals.find((t) => t.question === "academic" && t.answer === "4")
      .count,
    1,
  );
  assert.equal(
    data.totals.find(
      (t) =>
        t.question === "academic" && t.answer === "Did not attend these talks",
    ).count,
    1,
  );
  assert.ok(!data.totals.some((t) => t.question === "valuableOther"));
  assert.deepEqual(recommendationSummary(data.totals), {
    answered: 2,
    promoters: 1,
    passives: 0,
    detractors: 1,
    score: 0,
  });
  assert.equal((await own(f, "b".repeat(64), "DELETE")).status, 200);
  data = await (await dashboard(f)).json();
  assert.equal(await count(f), 1);
  assert.equal(recommendationSummary(data.totals).score, -100);
  assert.equal((await own(f, "a".repeat(64), "DELETE")).status, 200);
  data = await (await dashboard(f)).json();
  assert.equal(recommendationSummary(data.totals).score, null);
  assert.equal(await count(f), 0);
});

test("valuable parts allows up to three, an exclusive None and optional details only with Other", () => {
  const choices = feedbackQuestions.find((q) => q.id === "valuable").options;
  for (const selected of [
    [choices[0]],
    choices.slice(0, 3),
    ["None"],
    ["Other"],
  ]) {
    const form = answers();
    form.delete("valuable");
    for (const value of selected) form.append("valuable", value);
    assert.deepEqual(parseFeedback(form).answers.valuable, selected);
  }
  for (const selected of [
    [],
    choices.slice(0, 4),
    ["None", choices[0]],
    [choices[0], choices[0]],
  ]) {
    const form = answers();
    form.delete("valuable");
    for (const value of selected) form.append("valuable", value);
    assert.equal(typeof parseFeedback(form), "string");
  }
  const form = answers();
  form.set("valuableOther", "An additional suggestion");
  assert.equal(typeof parseFeedback(form), "string");
  form.set("valuable", "Other");
  assert.equal(
    parseFeedback(form).answers.valuableOther,
    "An additional suggestion",
  );
  form.set("valuableOther", "x".repeat(2001));
  assert.equal(typeof parseFeedback(form), "string");
});

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
    ["recommend", "11"],
    ["formVersion", "4"],
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
  assert.equal(decrypted.formVersion, feedbackFormVersion);
  assert.equal(decrypted.answers.recommend, "9");
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
  assert.deepEqual(recommendationSummary(dashboardData.totals), {
    answered: 1,
    promoters: 1,
    passives: 0,
    detractors: 0,
    score: 100,
  });
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
