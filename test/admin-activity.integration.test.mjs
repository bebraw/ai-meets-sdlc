import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { unstable_dev } from "wrangler";

const execFileAsync = promisify(execFile);
const origin = "https://sdlcai.org";
const authorization = `Basic ${Buffer.from("interest-admin:local-test-password").toString("base64")}`;

test("Basic auth on the admin page establishes a session for activity API requests", async (t) => {
  const pageHtml = await readFile("build/admin/activity/index.html", "utf8");
  assert.match(pageHtml, /<option value="all">Everyone<\/option>/);

  const persistenceDirectory = await mkdtemp(
    path.join(tmpdir(), "sdlcai-admin-activity-"),
  );
  t.after(() => rm(persistenceDirectory, { force: true, recursive: true }));
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
  const worker = await unstable_dev("worker/index.ts", {
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
  t.after(() => worker.stop());

  const page = await worker.fetch(`${origin}/admin/activity/`, {
    headers: { authorization },
  });
  assert.equal(page.status, 200);
  const session = page.headers.get("set-cookie");
  assert.match(session, /^__Host-sdlcai-admin-session=/);
  assert.match(session, /Path=\/; HttpOnly; Secure; SameSite=Strict/);

  const activity = await worker.fetch(`${origin}/api/admin/change-history`, {
    headers: { cookie: session.split(";")[0] },
  });
  assert.equal(activity.status, 200);
  assert.deepEqual(await activity.json(), { events: [], next_before: null });

  const olderPageRequest = await worker.fetch(
    `${origin}/api/admin/change-history?actor=Everyone`,
    { headers: { cookie: session.split(";")[0] } },
  );
  assert.equal(olderPageRequest.status, 200);
  assert.deepEqual(await olderPageRequest.json(), {
    events: [],
    next_before: null,
  });
});
