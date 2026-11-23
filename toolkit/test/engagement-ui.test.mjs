import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createToolkit } from "../index.mjs";
import { startWeb } from "../http.mjs";

test("participant UI displays the published consent and questions, and the stage shows only the MC selection", async (t) => {
  const sent = [];
  const app = createToolkit({
    enabled: ["audience-qa", "event-feedback", "newsletter"],
    services: { sendMail: async (m) => sent.push(m) },
  });
  t.after(() => app.close());
  const form = {
    title: "Field Notes visitor survey",
    consent: "I agree to share my feedback about Field Notes.",
    retentionDays: 30,
    revision: 0,
    questions: [
      {
        id: "recommend",
        kind: "recommendation",
        label: "Would you recommend Field Notes?",
        required: true,
      },
      { id: "comment", kind: "text", label: "What could we improve?" },
    ],
  };
  await app.run("feedback_publish_form", form);
  await app.run("newsletter_configure", {
    revision: 0,
    title: "Field Notes news",
    consent: "Send me future Field Notes announcements.",
  });
  await app.run("qa_configure_room", {
    room: "main-stage",
    revision: 0,
    status: "open",
    title: "Main stage",
  });
  const q = await app.run(
    "qa_ask",
    {
      room: "main-stage",
      question: "When are the talks available?",
      requestId: "example",
    },
    { role: "public", actor: "speaker-a" },
  );
  await app.run("qa_moderate", {
    room: "main-stage",
    questionId: q.id,
    revision: 1,
    status: "approved",
  });
  await app.run("qa_present", {
    room: "main-stage",
    questionId: q.id,
    revision: 1,
    action: "select",
  });
  await app.run(
    "qa_ask",
    {
      room: "main-stage",
      question: "Private pending suggestion",
      requestId: "private",
    },
    { role: "public", actor: "speaker-b" },
  );
  const http = await startWeb({ toolkit: app, port: 0 });
  t.after(() => http.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(http.origin + "/#operation=feedback_respond");
  const consent = page.getByRole("checkbox", { name: form.consent });
  await consent.waitFor();
  assert.equal(await consent.isChecked(), false);
  await page.getByLabel("Would you recommend Field Notes?").fill("10");
  await page.getByLabel("What could we improve?").fill("More breaks.");
  await consent.check();
  await page.locator("#run").click();
  await page.getByRole("heading", { name: "Feedback received" }).waitFor();
  assert.ok(await page.locator("#result section code").innerText());
  assert.equal(
    (await app.run("feedback_report", {})).recommendationScores[0].score,
    100,
  );

  await page.goto(http.origin + "/#operation=newsletter_subscribe");
  await page.getByLabel("Email", { exact: true }).fill("visitor@example.test");
  await page
    .getByRole("checkbox", {
      name: "Send me future Field Notes announcements.",
    })
    .check();
  await page.locator("#run").click();
  await page.getByRole("heading", { name: "Check your inbox" }).waitFor();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "visitor@example.test");

  await page.goto(http.origin + "/#operation=qa_screen");
  await page.getByLabel("Session room").waitFor();
  await page.locator("#run").click();
  const stage = page.locator(".qa-stage");
  await stage.waitFor();
  assert.match(await stage.innerText(), /When are the talks available/);
  assert.doesNotMatch(await stage.innerText(), /Private pending suggestion/);
});
