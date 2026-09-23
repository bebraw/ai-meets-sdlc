import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { unstable_dev } from "wrangler";

const execFileAsync = promisify(execFile);
const activityPath = "/api/admin/change-history";
const authorization = `Basic ${Buffer.from("interest-admin:local-test-password").toString("base64")}`;

async function findBrowser() {
  for (const candidate of [
    process.env.LAYOUT_BROWSER_PATH,
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    chromium.executablePath(),
  ].filter(Boolean)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }
  throw new Error("No Chromium browser found for the activity browser check.");
}

const persistenceDirectory = await mkdtemp(
  path.join(tmpdir(), "sdlcai-activity-browser-"),
);
let worker;
let browser;

try {
  await execFileAsync(
    path.resolve("node_modules/.bin/wrangler"),
    [
      "d1",
      "migrations",
      "apply",
      "ai-meets-sdlc-interests",
      "--local",
      "--persist-to",
      persistenceDirectory,
    ],
    { cwd: process.cwd() },
  );
  worker = await unstable_dev("worker/index.ts", {
    config: "wrangler.jsonc",
    experimental: { disableExperimentalWarning: true, forceLocal: true },
    local: true,
    logLevel: "error",
    persist: true,
    persistTo: persistenceDirectory,
    vars: {
      ADMIN_PASSWORD: "local-test-password",
      ADMIN_USERNAME: "interest-admin",
      EMAIL_ENCRYPTION_KEY: "local-test-encryption-key",
      TURNSTILE_SITE_KEY: "",
    },
  });
  browser = await chromium.launch({ executablePath: await findBrowser() });
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization },
  });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${worker.port}`;
  const isActivityResponse = (response) =>
    new URL(response.url()).pathname === activityPath;

  const initialResponse = page.waitForResponse(isActivityResponse);
  await page.goto(`${origin}/admin/activity/`);
  const initial = await initialResponse;
  assert.equal(initial.status(), 200);
  assert.equal(new URL(initial.url()).searchParams.has("actor"), false);
  await page.waitForFunction(() =>
    document
      .querySelector("[data-activity-status]")
      ?.textContent?.startsWith("No activity matches these filters yet."),
  );

  await page
    .getByRole("combobox", { name: "Who changed it" })
    .selectOption("speaker");
  const filteredResponse = page.waitForResponse(isActivityResponse);
  await page.getByRole("button", { name: "Filter" }).click();
  const filtered = await filteredResponse;
  assert.equal(filtered.status(), 200);
  assert.equal(new URL(filtered.url()).searchParams.get("actor"), "speaker");

  await page.route(`**${activityPath}*`, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: '{"error":"Invalid filter"}',
    }),
  );
  await page.getByRole("button", { name: "Filter" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-activity-status]")
      ?.textContent?.includes("HTTP 400"),
  );
  console.log("Admin activity browser check passed.");
} finally {
  await browser?.close();
  await worker?.stop();
  await rm(persistenceDirectory, { force: true, recursive: true });
}
