import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createToolkit } from "../dist/index.mjs";

const guest = { actor: "guest-one", role: "public" };
const visitor = { actor: "guest-two", role: "attendee" };
const mod = { actor: "fran", role: "moderator" };
const mc = { actor: "alex", role: "mc" };

async function fixture(t, id, options = {}) {
  const app = createToolkit({ enabled: [id], ...options });
  t.after(() => app.close());
  const catalog = app.catalog()[0];
  const ajv = new Ajv({ strict: false });
  addFormats(ajv);
  const outputs = new Map(
    catalog.operations.map((op) => [op.name, ajv.compile(op.outputSchema)]),
  );
  const example = (name) =>
    catalog.operations.find((op) => op.name === name).example;
  return {
    app,
    async run(name, ...args) {
      const value = await app.run(name, ...args);
      const validate = outputs.get(name);
      assert.ok(validate(value), name + " " + ajv.errorsText(validate.errors));
      return value;
    },
    example,
  };
}

function codesFrom(text) {
  return Object.fromEntries(
    [...text.matchAll(/([a-z_]+) — code: ([a-zA-Z0-9_-]+)/gu)].map(
      ([, op, code]) => [op, code],
    ),
  );
}

test("Q&A separates pending and public views, serializes votes, and protects stage decisions", async (t) => {
  const { run, example } = await fixture(t, "audience-qa");
  const room = "main-stage";
  await run("qa_configure_room", example("qa_configure_room"));
  const input = example("qa_ask");
  const q = await run("qa_ask", input, guest);
  assert.equal((await run("qa_ask", input, guest)).id, q.id);
  assert.equal((await run("qa_view", { room }, visitor)).questions.length, 0);
  assert.equal((await run("qa_view", { room }, guest)).questions[0].id, q.id);
  const decision = { room, questionId: q.id, revision: 1, status: "approved" };
  await assert.rejects(run("qa_moderate", decision, visitor), { status: 403 });
  await run(
    "qa_moderate",
    { ...decision, question: "Will slides be shared?" },
    mod,
  );
  assert.equal((await run("qa_ask", input, guest)).id, q.id);
  await assert.rejects(run("qa_moderate", decision, mod), { status: 409 });
  await assert.rejects(run("qa_vote", { room, questionId: q.id }, guest), {
    status: 409,
  });
  await Promise.all([
    run("qa_vote", { room, questionId: q.id }, visitor),
    run("qa_vote", { room, questionId: q.id }, visitor),
  ]);
  assert.equal((await run("qa_view", { room }, mc)).questions[0].votes, 1);
  await run(
    "qa_present",
    { room, action: "select", revision: 1, questionId: q.id },
    mc,
  );
  assert.equal((await run("qa_view", { room }, visitor)).screen.id, q.id);
  await assert.rejects(
    run("qa_present", { room, action: "clear", revision: 1 }, mc),
    { status: 409 },
  );
  await run("qa_present", { room, action: "answered", revision: 2 }, mc);
  assert.equal((await run("qa_view", { room }, visitor)).screen, null);
});

test("survey retains aggregated ratings after expiry and subtracts a withdrawn respondent", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "toolkit-feedback-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { run, example, app } = await fixture(t, "event-feedback", {
    directory: dir,
    eventId: "survey",
    services: { verifyChallenge: async ({ token }) => token === "test-pass" },
  });
  await run("feedback_publish_form", example("feedback_publish_form"));
  const sample = { ...example("feedback_respond"), challenge: "test-pass" };
  await assert.rejects(
    run("feedback_respond", { ...sample, challenge: "fail" }, guest),
    { status: 403 },
  );
  await assert.rejects(
    run("feedback_respond", { ...sample, version: 2 }, guest),
    { status: 409 },
  );
  await assert.rejects(
    run("feedback_respond", { ...sample, answers: { value: 7 } }, guest),
    /number from 1 to 5/,
  );
  const first = await run("feedback_respond", sample, guest);
  await run(
    "feedback_respond",
    {
      ...sample,
      answers: { value: 3, recommend: 5, comment: "Keep my comment private" },
    },
    visitor,
  );
  assert.equal(
    (await run("feedback_report", {})).recommendationScores[0].score,
    0,
  );
  await assert.rejects(
    run("feedback_report", { includeResponses: true }, guest),
    { status: 403 },
  );
  await run("feedback_withdraw", { code: first.withdrawalCode }, guest);
  const report = await run("feedback_report", { includeResponses: true });
  assert.equal(report.responsesReceived, 1);
  assert.equal(report.recommendationScores[0].score, -100);
  assert.equal(report.responses[0].answers.comment, "Keep my comment private");
  const db = new DatabaseSync(join(dir, "event-survey.sqlite"));
  try {
    assert.doesNotMatch(
      db.prepare("SELECT answers FROM feedback_private").get().answers,
      /comment|Keep my comment/,
    );
    db.exec("UPDATE feedback_private SET expires=1");
  } finally {
    db.close();
  }
  await app.maintain();
  const expired = await run("feedback_report", { includeResponses: true });
  assert.deepEqual(expired.responses, []);
  assert.deepEqual(expired.totals, report.totals);
  assert.equal(expired.responsesReceived, 1);
});

test("attendee campaign claims are unique, uncertain sends stay uncertain, and withdrawals survive reimport", async (t) => {
  const sent = [];
  const { run } = await fixture(t, "attendee-messages", {
    services: {
      async sendMail(msg) {
        sent.push(msg);
        if (msg.to === "offline@example.test")
          throw new Error("Unknown delivery outcome");
        return { id: "message-1" };
      },
    },
  });
  const recipients = [
    "FIRST@example.test",
    "first@example.test",
    "offline@example.test",
  ];
  const group = await run("messages_set_audience", { recipients, revision: 0 });
  assert.equal(group.eligible, 2);
  const preview = await run("messages_preview", {
    subject: "Event update",
    body: "The workshop is open.",
  });
  assert.equal(sent.length, 0);
  const sender = () =>
    run("messages_send", { previewId: preview.previewId, send: true });
  await Promise.all([sender(), sender()]);
  await sender();
  assert.equal(sent.length, 2);
  const first = sent.find((r) => r.to === "first@example.test");
  await run(
    "messages_withdraw",
    { code: codesFrom(first.text).messages_withdraw },
    guest,
  );
  const audience = await run("messages_audience", {});
  assert.deepEqual(audience.emails, ["offline@example.test"]);
  const updated = await run("messages_set_audience", {
    recipients,
    revision: audience.revision,
  });
  assert.equal(updated.eligible, 1);
  const stale = await run("messages_preview", {
    subject: "Second update",
    body: "The venue changed.",
  });
  await run("messages_set_audience", {
    revision: updated.revision,
    recipients: ["new@example.test"],
  });
  await assert.rejects(
    run("messages_send", { previewId: stale.previewId, send: true }),
    { status: 409 },
  );
  assert.equal(sent.length, 2);
  const campaign = (await run("messages_history", {})).campaigns.find(
    (c) => c.id === preview.previewId,
  );
  assert.deepEqual(campaign.deliveries, {
    pending: 0,
    accepted: 1,
    unknown: 1,
    skipped: 0,
    rejected: 0,
  });
});

test("newsletter confirms address ownership across event contexts, records withdrawal, and never creates event mail eligibility", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "toolkit-subscriptions-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sent = [];
  const services = { sendMail: async (msg) => sent.push(msg) };
  const one = await fixture(t, "newsletter", {
    directory,
    eventId: "one",
    services,
  });
  const two = await fixture(t, "newsletter", {
    directory,
    eventId: "two",
    services,
  });
  const eventMail = await fixture(t, "attendee-messages", {
    directory,
    eventId: "one",
    services,
  });
  await one.run("newsletter_configure", one.example("newsletter_configure"));
  const first = await two.run(
    "newsletter_subscribe",
    one.example("newsletter_subscribe"),
    guest,
  );
  const duplicate = await two.run(
    "newsletter_subscribe",
    one.example("newsletter_subscribe"),
    guest,
  );
  assert.deepEqual(first, duplicate);
  assert.equal(sent.length, 1);
  assert.deepEqual(
    (await one.run("newsletter_subscribers", {})).subscribers,
    [],
  );
  const codes = codesFrom(sent[0].text);
  const confirmed = await one.run(
    "newsletter_confirm",
    { code: codes.newsletter_confirm },
    guest,
  );
  assert.equal(confirmed.withdrawalCode, codes.newsletter_withdraw);
  await assert.rejects(
    two.run("newsletter_confirm", { code: codes.newsletter_confirm }, guest),
    { status: 404 },
  );
  assert.deepEqual((await eventMail.run("messages_audience", {})).emails, []);
  const [member] = (await two.run("newsletter_subscribers", {})).subscribers;
  assert.equal(member.email, "listener@example.test");
  await two.run(
    "newsletter_withdraw",
    { code: confirmed.withdrawalCode },
    guest,
  );
  assert.deepEqual(
    (await one.run("newsletter_subscribers", {})).subscribers,
    [],
  );
  const history = await one.run("newsletter_changes", {});
  assert.deepEqual(
    history.changes.map((c) => [c.member, c.status, c.email]),
    [
      [member.id, "subscribed", null],
      [member.id, "withdrawn", null],
    ],
  );
});

test("editorial queue persists references, enforces revisions, and validates scheduled/published dates", async (t) => {
  const { run, example } = await fixture(t, "publication-queue");
  const draft = example("publication_save");
  const saved = await run("publication_save", draft);
  assert.equal(saved.revision, 1);
  await assert.rejects(run("publication_save", draft), { status: 409 });
  await assert.rejects(
    run("publication_save", {
      ...draft,
      revision: 1,
      status: "scheduled",
      publicationDate: "2026-02-30",
    }),
    /valid publication date/,
  );
  await assert.rejects(
    run("publication_save", {
      ...draft,
      revision: 1,
      status: "published",
      publicationDate: "2026-12-01",
    }),
    /post URL/,
  );
  const ready = await run("publication_save", {
    ...draft,
    revision: 1,
    status: "ready",
    assets: [
      {
        url: "https://example.test/graphic.png",
        alt: "Summary",
        format: "portrait",
      },
    ],
  });
  assert.equal(ready.revision, 2);
  assert.deepEqual((await run("publication_list", { status: "ready" })).items, [
    ready,
  ]);
  await assert.rejects(run("publication_list", {}, visitor), { status: 403 });
});
