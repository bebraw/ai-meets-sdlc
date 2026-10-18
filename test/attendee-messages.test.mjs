import assert from "node:assert/strict";
import test from "node:test";
import { expectConsoleErrors } from "./helpers/expected-console-errors.mjs";
import {
  handleAttendeeMessages as handle,
  attendeeMessageAudience,
} from "../worker/attendee-messages.ts";
import { mailFingerprint, signMailToken } from "../worker/mail-utils.ts";
import {
  mailingFixture,
  mailRequest,
  origin,
} from "./helpers/mailing-fixture.mjs";

const endpoint = "/api/admin/attendee-messages";
const input = {
  category: "operational",
  subject: "Welcome to SDLCAI",
  text_body:
    "Find our venue and practical details at https://sdlcai.org/2026/faq/",
};
const call = (f, path, body) =>
  handle(
    mailRequest(
      `${endpoint}${path}`,
      body,
      body === undefined ? "GET" : "POST",
    ),
    f.env,
  );
const preview = async (f) => (await call(f, "/preview", input)).json();
const send = (f, p, overrides = {}) =>
  call(f, "/send", {
    ...input,
    preview_token: p.preview_token,
    confirm_recipient_count: p.recipient_count,
    ...overrides,
  });

test("shared drafts survive new reads, allow unfinished copy, and never create or send a campaign", async (t) => {
  const f = await mailingFixture(t);
  const initial = await call(f, "/draft");
  assert.equal(initial.headers.get("cache-control"), "no-store");
  const empty = (await initial.json()).draft;
  assert.equal(empty.revision, 0);
  const response = await call(f, "/draft", {
    subject: "Hi",
    text_body: "First\r\nthought",
    revision: empty.revision,
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).draft;
  assert.equal(saved.text_body, "First\nthought");
  assert.equal(saved.revision, 1);
  assert.deepEqual((await (await call(f, "/draft")).json()).draft, saved);
  assert.equal(f.messages.length, 0);
  for (const table of [
    "attendee_message_campaigns",
    "attendee_message_deliveries",
  ])
    assert.equal(
      (await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,
      0,
    );
  assert.equal(
    (await call(f, "/preview", { ...saved, category: "operational" })).status,
    400,
    "An unfinished draft cannot bypass send validation",
  );
  delete f.env.EMAIL;
  delete f.env.EMAIL_ENCRYPTION_KEY;
  assert.equal(
    (await call(f, "/draft", { ...saved, subject: "Still editable" })).status,
    200,
    "Drafting is independent of delivery configuration",
  );
});

test("draft saves require the admin action, validate copy, and reject stale concurrent edits", async (t) => {
  const f = await mailingFixture(t);
  const draft = {
    subject: "Event follow-up",
    text_body: "A work in progress",
    revision: 0,
  };
  assert.equal(
    (
      await handle(
        mailRequest(`${endpoint}/draft`, draft, "POST", "wrong-action"),
        f.env,
      )
    ).status,
    403,
  );
  for (const overrides of [
    { subject: "bad\nsubject" },
    { subject: "x".repeat(161) },
    { text_body: "x".repeat(10001) },
    { revision: -1 },
    { revision: "0" },
  ])
    assert.equal(
      (await call(f, "/draft", { ...draft, ...overrides })).status,
      400,
    );
  const competing = await Promise.all([
    call(f, "/draft", { ...draft, subject: "First tab" }),
    call(f, "/draft", { ...draft, subject: "Second tab" }),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
  const saved = (await (await call(f, "/draft")).json()).draft;
  assert.equal(saved.revision, 1);
  assert.equal(
    (await call(f, "/draft", { ...draft, subject: "Stale overwrite" })).status,
    409,
  );
  assert.equal(
    (await (await call(f, "/draft")).json()).draft.subject,
    saved.subject,
  );
});

test("active attendee messages deduplicate normalized addresses, require a fresh preview, and cannot send marketing", async (t) => {
  const f = await mailingFixture(t);
  await f.roster([
    { email: "same@example.test" },
    { email: " SAME@example.test " },
    { status: "cancelled" },
    { email: "" },
    { email: "active@example.test" },
  ]);
  const p = await preview(f);
  assert.equal(p.recipient_count, 2);
  assert.deepEqual(p.excluded, {
    cancelled: 1,
    invalid_email: 1,
    unsubscribed: 0,
    duplicate: 1,
  });
  assert.equal(
    (
      await send(f, p, {
        text_body: "Changed event message after preview was approved.",
      })
    ).status,
    409,
  );
  assert.equal((await send(f, p, { category: "promotion" })).status, 400);
  assert.equal(
    (
      await handle(
        mailRequest(`${endpoint}/preview`, input, "POST", "wrong-action"),
        f.env,
      )
    ).status,
    403,
  );
  const results = await Promise.all([send(f, p), send(f, p)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const id = (await results.find((r) => r.status === 201).json()).campaign_id;
  assert.equal(
    f.messages.length,
    0,
    "Saving reserves the audience; continuation does the bounded send",
  );
  await Promise.all([
    call(f, "/continue", { id }),
    call(f, "/continue", { id }),
  ]);
  assert.equal(f.messages.length, 2);
  assert.equal(new Set(f.messages.map((m) => m.to)).size, 2);
  for (const mail of f.messages) {
    assert.equal(
      mail.text.replace(
        /https:\/\/sdlcai.org\/event-email\/unsubscribe\/#token=\S+/u,
        "[personal unsubscribe link]",
      ),
      p.text_body,
    );
    assert.equal(typeof mail.to, "string");
    assert.equal(mail.cc, undefined);
    assert.equal(mail.bcc, undefined);
    assert.match(mail.text, /event-email\/unsubscribe\/#token=/u);
    assert.match(mail.html, /href="https:\/\/sdlcai.org\/2026\/faq\/"/u);
    assert.equal(
      mail.headers["List-Unsubscribe-Post"],
      "List-Unsubscribe=One-Click",
    );
  }
  await call(f, "/continue", { id });
  assert.equal(f.messages.length, 2);
  const history = await (await call(f, "")).json();
  assert.equal(history.campaigns[0].accepted, 2);
  assert.equal(history.campaigns[0].pending, 0);
  const deliveries = await (await call(f, `/deliveries?id=${id}`)).json();
  assert.equal(deliveries.deliveries.length, 2);
  assert.ok(
    deliveries.deliveries.every((r) => r.message_id?.startsWith("test-")),
  );
  const stored = await f.db
    .prepare("SELECT * FROM attendee_message_deliveries")
    .all();
  assert.doesNotMatch(JSON.stringify(stored.results), /@example.test/u);
});

test("unsubscribe needs a signed token and POST, survives imports, invalidates previews, and suppresses pending sends", async (t) => {
  const f = await mailingFixture(t);
  await f.roster([{}, {}]);
  const p = await preview(f);
  const token = await signMailToken(
    { email_hash: await mailFingerprint("person0@example.test", f.env) },
    f.env,
    "attendee-message-unsubscribe",
  );
  const path = "/api/attendee-messages/unsubscribe";
  assert.equal(
    (await handle(new Request(`${origin}${path}?token=${token}`), f.env))
      .status,
    405,
  );
  assert.equal(
    (await handle(mailRequest(path, { token: `${token}x` }), f.env)).status,
    400,
  );
  assert.equal((await handle(mailRequest(path, { token }), f.env)).status, 200);
  assert.equal((await send(f, p)).status, 409);
  await f.roster([{ id: "new-import-id", email: "person0@example.test" }, {}]);
  assert.equal((await attendeeMessageAudience(f.env)).recipients.length, 1);
  const next = await preview(f),
    saved = await (await send(f, next)).json();
  const token1 = await signMailToken(
    { email_hash: await mailFingerprint("person1@example.test", f.env) },
    f.env,
    "attendee-message-unsubscribe",
  );
  const oneClick = new Request(`${origin}${path}?token=${token1}`, {
    method: "POST",
    body: new URLSearchParams({ "List-Unsubscribe": "One-Click" }),
  });
  assert.equal((await handle(oneClick, f.env)).status, 200);
  assert.equal(
    (await call(f, "/continue", { id: saved.campaign_id })).status,
    200,
  );
  assert.equal(f.messages.length, 0);
  assert.equal(
    (
      await f.db
        .prepare("SELECT status FROM attendee_message_deliveries")
        .first()
    ).status,
    "skipped",
  );
});

test("resuming uses the original address fingerprint and rechecks current registration eligibility", async (t) => {
  const f = await mailingFixture(t);
  await f.roster([{}, {}, {}]);
  const p = await preview(f),
    saved = await (await send(f, p)).json();
  await f.roster([
    { status: "cancelled" },
    { email: "changed@example.test" },
    {},
  ]);
  const result = await (
    await call(f, "/continue", { id: saved.campaign_id })
  ).json();
  assert.equal(result.skipped, 2);
  assert.equal(result.accepted, 1);
  assert.deepEqual(
    f.messages.map((m) => m.to),
    ["person2@example.test"],
  );
});

test("bounded batches resume safely, retry only definitive rejections, and never retry ambiguous acceptance", async (t) => {
  const f = await mailingFixture(t);
  await f.roster(Array.from({ length: 13 }, () => ({})));
  let calls = 0;
  f.env.EMAIL.send = async (mail) => {
    calls++;
    if (mail.to === "person0@example.test" && calls <= 13)
      throw Object.assign(new Error("test rate limit"), {
        code: "E_RATE_LIMIT_EXCEEDED",
      });
    if (mail.to === "person1@example.test")
      throw new Error("Uncertain network response");
    f.messages.push(mail);
    return { messageId: `test-${calls}` };
  };
  const p = await preview(f),
    saved = await (await send(f, p)).json();
  const first = await (
    await call(f, "/continue", { id: saved.campaign_id })
  ).json();
  assert.equal(first.pending, 3);
  const second = await (
    await call(f, "/continue", { id: saved.campaign_id })
  ).json();
  assert.equal(second.pending, 0);
  assert.equal(second.failed, 1);
  assert.equal(second.unknown, 1);
  assert.equal(second.accepted, 11);
  const retry = await (
    await call(f, "/retry", { id: saved.campaign_id })
  ).json();
  assert.equal(retry.accepted, 12);
  assert.equal(retry.unknown, 1);
  assert.equal(retry.failed, 0);
  assert.equal(calls, 14);
  assert.equal(f.messages.length, 12);
  await call(f, "/retry", { id: saved.campaign_id });
  assert.equal(calls, 14);
});

test("acceptance ledger failure retains an unknown outcome and cannot duplicate the email", async (t) => {
  const f = await mailingFixture(t);
  await f.roster([{}]);
  const p = await preview(f),
    saved = await (await send(f, p)).json(),
    db = f.db;
  f.env.INTERESTS = {
    prepare(sql) {
      if (sql.includes("SET status = 'accepted'"))
        return {
          bind() {
            return {
              run() {
                throw new Error("Simulated ledger outage");
              },
            };
          },
        };
      return db.prepare(sql);
    },
  };
  const response = await expectConsoleErrors(
    t,
    ["attendee_message_request_failed"],
    () => call(f, "/continue", { id: saved.campaign_id }),
  );
  assert.equal(response.status, 503);
  assert.equal(f.messages.length, 1);
  f.env.INTERESTS = db;
  const result = await (
    await call(f, "/retry", { id: saved.campaign_id })
  ).json();
  assert.equal(result.unknown, 1);
  assert.equal(f.messages.length, 1);
});

test("test sends are separate from campaign history and message HTML escapes organizer content", async (t) => {
  const f = await mailingFixture(t);
  const result = await call(f, "/test", {
    ...input,
    test_email: "self@example.test",
    text_body:
      "An event update with <img src=x onerror=alert(1)> and https://sdlcai.org/2026/faq/",
  });
  assert.equal(result.status, 200);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].subject, "[TEST] Welcome to SDLCAI");
  assert.doesNotMatch(f.messages[0].html, /<img/u);
  assert.match(f.messages[0].html, /&lt;img/u);
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM attendee_message_campaigns")
        .first()
    ).n,
    0,
  );
});
