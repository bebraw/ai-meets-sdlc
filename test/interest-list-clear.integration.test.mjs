import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { unstable_dev } from "wrangler";

const execFileAsync = promisify(execFile);
const origin = "https://sdlcai.org";
const authorization = `Basic ${Buffer.from("interest-admin:local-test-password").toString("base64")}`;

test("an admin can empty only the list they reviewed", async (t) => {
  const persistenceDirectory = await mkdtemp(
    path.join(tmpdir(), "sdlcai-interest-clear-"),
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

  async function subscribe(email) {
    const response = await worker.fetch(`${origin}/api/interest`, {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, consent: "yes" }),
    });
    assert.equal(response.status, 200);
  }
  const list = async () => {
    const response = await worker.fetch(`${origin}/api/admin/interests`, {
      headers: { authorization },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const clear = (body, headers = {}) =>
    worker.fetch(`${origin}/api/admin/interests`, {
      method: "DELETE",
      headers: {
        authorization,
        "content-type": "application/json",
        origin,
        "x-admin-action": "empty-interest-list",
        ...headers,
      },
      body: JSON.stringify(body),
    });

  await subscribe("one@example.com");
  await subscribe("two@example.com");
  const initial = await list();
  assert.equal(initial.count, 2);
  assert.equal(initial.version.count, 2);

  const unauthorized = await worker.fetch(`${origin}/api/admin/interests`, {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      origin,
      "x-admin-action": "empty-interest-list",
    },
    body: JSON.stringify({
      confirmation: "EMPTY",
      expected_count: 2,
      expected_max_id: initial.version.max_id,
    }),
  });
  assert.equal(unauthorized.status, 401);
  assert.equal(
    (
      await clear(
        {
          confirmation: "EMPTY",
          expected_count: 2,
          expected_max_id: initial.version.max_id,
        },
        { "x-admin-action": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await clear({
        confirmation: "wrong",
        expected_count: 2,
        expected_max_id: initial.version.max_id,
      })
    ).status,
    400,
  );

  await subscribe("three@example.com");
  assert.equal(
    (
      await clear({
        confirmation: "EMPTY",
        expected_count: 2,
        expected_max_id: initial.version.max_id,
      })
    ).status,
    409,
  );
  assert.equal((await list()).count, 3);

  const current = await list();
  const cleared = await clear({
    confirmation: "EMPTY",
    expected_count: current.version.count,
    expected_max_id: current.version.max_id,
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(await cleared.json(), { ok: true, deleted: 3 });
  assert.deepEqual((await list()).contacts, []);
  const csv = await worker.fetch(`${origin}/api/admin/interests.csv`, {
    headers: { authorization },
  });
  assert.equal(
    (await csv.text()).trim(),
    '"email","name","organization","created_at"',
  );

  const activity = await worker.fetch(
    `${origin}/api/admin/activity?actor=admin`,
    { headers: { authorization } },
  );
  assert.equal(activity.status, 200);
  const events = (await activity.json()).events;
  assert.ok(
    events.some(
      (event) =>
        event.actor_id === "interest-admin" &&
        event.category === "Interest list" &&
        event.action === "emptied",
    ),
  );
});
