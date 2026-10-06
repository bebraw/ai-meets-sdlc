import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { unstable_dev } from "wrangler";

const execute = promisify(execFile);
const persistenceDirectory = await mkdtemp(
  path.join(tmpdir(), "sdlcai-qa-browser-"),
);
let worker, browser;
const authorization = `Basic ${Buffer.from("qa-browser-admin:qa-browser-password").toString("base64")}`;
const roomId = "industry-perspectives-morning";
const secondRoom = "views-from-academia";
async function findBrowser() {
  for (const candidate of [
    process.env.LAYOUT_BROWSER_PATH,
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromium.executablePath(),
  ].filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* Try the next installed browser. */
    }
  }
  throw new Error("No Chromium browser found for the QA browser check.");
}
try {
  await execute(path.resolve("node_modules/.bin/wrangler"), [
    "d1",
    "migrations",
    "apply",
    "ai-meets-sdlc-interests",
    "--local",
    "--persist-to",
    persistenceDirectory,
  ]);
  worker = await unstable_dev("worker/index.ts", {
    config: "wrangler.jsonc",
    local: true,
    logLevel: "error",
    persist: true,
    persistTo: persistenceDirectory,
    experimental: { disableExperimentalWarning: true, forceLocal: true },
    vars: {
      ADMIN_USERNAME: "qa-browser-admin",
      ADMIN_PASSWORD: "qa-browser-password",
      EMAIL_ENCRYPTION_KEY: "qa-browser-encryption",
      TURNSTILE_SITE_KEY: "",
    },
  });
  const origin = `http://127.0.0.1:${worker.port}`;
  const getAdmin = async () => {
    const response = await fetch(`${origin}/api/admin/qa`, {
      headers: { authorization },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const adminAction = async (body) => {
    const response = await fetch(`${origin}/api/admin/qa`, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 200, await response.clone().text());
  };
  await adminAction({
    action: "active-room",
    roomId,
    settingsRevision: (await getAdmin()).settings.revision,
  });
  await adminAction({ action: "status", roomId, status: "open" });
  await adminAction({
    action: "create-grant",
    label: "Moderator browser",
    role: "moderator",
  });
  await adminAction({
    action: "create-grant",
    label: "MC browser",
    role: "mc",
  });
  const grants = (await getAdmin()).grants;
  browser = await chromium.launch({ executablePath: await findBrowser() });
  const adminContext = await browser.newContext({
    extraHTTPHeaders: { authorization },
    viewport: { width: 1440, height: 900 },
  });
  const attendeeContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const voterContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const moderatorContext = await browser.newContext();
  const mcContext = await browser.newContext();
  const screenContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const admin = await adminContext.newPage(),
    attendee = await attendeeContext.newPage(),
    voter = await voterContext.newPage(),
    moderator = await moderatorContext.newPage(),
    mc = await mcContext.newPage(),
    screen = await screenContext.newPage();
  const errors = [];
  for (const page of [admin, attendee, voter, moderator, mc, screen]) {
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  const signIn = async (page, role) => {
    const link = grants.find((grant) => grant.role === role).link;
    await page.goto(`${origin}/qa/access/${new URL(link).hash}`);
    assert.equal(
      new URL(page.url()).hash,
      "",
      "The token is removed from browser history",
    );
    assert.equal(
      (await page.locator("#qa-access-token").inputValue()).length,
      43,
    );
    await page
      .getByRole("button", { name: "Continue to QA workspace" })
      .click();
    await page.waitForURL(`**/qa/${role === "mc" ? "mc" : "moderate"}/`);
  };
  await admin.goto(`${origin}/admin/qa/`);
  await attendee.goto(`${origin}/qa/`);
  await voter.goto(`${origin}/qa/`);
  await signIn(moderator, "moderator");
  await signIn(mc, "mc");
  await screen.goto(`${origin}/qa/screen/`);
  const question = "How do we verify generated code?";
  await attendee
    .getByLabel(`Question for Industry perspectives`)
    .fill(question);
  await attendee
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  try {
    await attendee
      .getByRole("heading", { name: question, exact: true })
      .waitFor();
  } catch (error) {
    console.error("Attendee QA diagnostic", {
      errors,
      notice: await attendee.locator("[data-qa-notice]").textContent(),
      connection: await attendee.locator("[data-qa-connection]").textContent(),
      snapshot: await (
        await attendeeContext.request.get(`${origin}/api/qa/snapshot`)
      ).json(),
    });
    throw error;
  }
  await moderator
    .getByRole("heading", { name: question, exact: true })
    .waitFor();
  assert.equal(
    await voter.getByRole("heading", { name: question, exact: true }).count(),
    0,
  );
  const moderationCard = moderator
    .locator("[data-qa-question]")
    .filter({ hasText: question });
  await moderationCard
    .getByRole("button", { name: "Approve", exact: true })
    .click();
  await voter.getByRole("heading", { name: question, exact: true }).waitFor();
  await voter.getByRole("button", { name: "Vote", exact: true }).click();
  await voter.getByRole("button", { name: "Voted", exact: true }).waitFor();
  await mc.getByRole("heading", { name: question, exact: true }).waitFor();
  await mc.getByRole("button", { name: "Put on screen", exact: true }).click();
  await screen.getByText(question, { exact: true }).waitFor();
  await attendee.screenshot({
    path: path.join(tmpdir(), "sdlcai-qa-mobile.png"),
    fullPage: true,
  });
  await screen.screenshot({
    path: path.join(tmpdir(), "sdlcai-qa-screen.png"),
  });
  // A saved POST must get a fresh submission identity even if its follow-up
  // HTML refresh fails, so the next question is not mistaken for a retry.
  await attendee.route("**/qa/", (route) =>
    route.request().headers()["x-qa-fragment"] === "1"
      ? route.abort()
      : route.continue(),
  );
  const offlineQuestions = [
    "Can I submit while the live refresh is interrupted?",
    "Will my next question still be saved separately?",
  ];
  for (const text of offlineQuestions) {
    await attendee.locator("#qa-question").fill(text);
    await attendee
      .getByRole("button", { name: "Send question", exact: true })
      .click();
    await attendee.waitForFunction(
      () => document.querySelector("#qa-question").value === "",
    );
  }
  await attendee.unroute("**/qa/");
  await attendee.reload();
  for (const text of offlineQuestions)
    await attendee.getByRole("heading", { name: text, exact: true }).waitFor();
  await voter.goto(`${origin}/contact/`);
  await voter.goBack();
  await voter.getByText("Live updates connected.", { exact: true }).waitFor();
  const longQuestion =
    "How can we evaluate generated software across teams while keeping the requirements clear and the results reproducible? "
      .repeat(5)
      .slice(0, 500)
      .trim();
  await adminAction({
    action: "add",
    roomId,
    text: longQuestion,
    requestId: `screen-long-question-${Date.now()}`,
  });
  await voter
    .getByRole("heading", { name: longQuestion, exact: true })
    .waitFor();
  const screenData = await getAdmin();
  await adminAction({
    action: "select",
    roomId,
    questionId: screenData.snapshot.questions.find(
      (item) => item.text === longQuestion,
    ).id,
    expectedActiveId: screenData.snapshot.activeQuestionId,
  });
  await screen.getByText(longQuestion, { exact: true }).waitFor();
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 720 },
  ]) {
    await screen.setViewportSize(viewport);
    assert.equal(
      await screen.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
      true,
      "A maximum-length question must fit the projector screen",
    );
  }
  const axeSource = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const page of [admin, attendee, moderator, mc, screen]) {
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: [
              "wcag2a",
              "wcag2aa",
              "wcag21a",
              "wcag21aa",
              "wcag22aa",
              "best-practice",
            ],
          },
          rules: { "target-size": { enabled: false } },
        })
      ).violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => node.target),
      })),
    );
    assert.deepEqual(
      violations,
      [],
      `Accessibility failed at ${new URL(page.url()).pathname}`,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "The QA page must not overflow horizontally",
    );
  }
  await attendee
    .locator("#qa-question")
    .fill("My draft should survive a session change.");
  await adminAction({
    action: "active-room",
    roomId: secondRoom,
    settingsRevision: (await getAdmin()).settings.revision,
  });
  await adminAction({ action: "status", roomId: secondRoom, status: "open" });
  await attendee
    .getByRole("button", { name: "Review new session", exact: true })
    .waitFor();
  assert.equal(
    await attendee.locator("#qa-question").inputValue(),
    "My draft should survive a session change.",
  );
  await attendee
    .getByRole("button", { name: "Review new session", exact: true })
    .click();
  await attendee.getByLabel("Question for Views from academia").waitFor();
  assert.equal(
    await attendee.locator("#qa-question").inputValue(),
    "My draft should survive a session change.",
  );
  await attendee
    .getByRole("button", { name: "Send question", exact: true })
    .click();
  await attendee
    .getByRole("heading", {
      name: "My draft should survive a session change.",
      exact: true,
    })
    .waitFor();
  await adminAction({
    action: "revoke-grant",
    grantId: grants.find((grant) => grant.role === "mc").id,
  });
  await mc.waitForURL("**/qa/access/**");
  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
  });
  const noScript = await noScriptContext.newPage();
  await noScript.goto(`${origin}/qa/`);
  await noScript
    .getByLabel("Question for Views from academia")
    .fill("Can I ask a question without JavaScript?");
  await noScript
    .getByRole("button", { name: "Send question", exact: true })
    .press("Enter");
  await noScript
    .getByRole("heading", {
      name: "Can I ask a question without JavaScript?",
      exact: true,
    })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "QA browser check passed: live moderation, voting, MC screen, reusable links, revocation, mobile layout, accessibility, drafts, and native forms.",
  );
} finally {
  await browser?.close();
  await worker?.stop();
  await rm(persistenceDirectory, { recursive: true, force: true });
}
