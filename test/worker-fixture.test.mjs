import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerFixture } from "./helpers/worker-fixture.mjs";

test("parallel Worker fixtures isolate D1, R2, credentials, and multi-statement SQL", async (t) => {
  const fixtures = await Promise.all(
    ["first", "second"].map(async (password) => {
      const fixture = await createWorkerFixture({
        vars: {
          ADMIN_USERNAME: "fixture-admin",
          ADMIN_PASSWORD: password,
          EMAIL_ENCRYPTION_KEY: "local-fixture-encryption",
          TURNSTILE_SECRET_KEY: "",
        },
      });
      t.after(() => fixture.dispose());
      return fixture;
    }),
  );
  const [first, second] = fixtures;
  await first.runSql(
    "CREATE TABLE fixture_isolation (value TEXT); INSERT INTO fixture_isolation VALUES ('one; two');",
  );
  assert.deepEqual(await first.runSql("SELECT * FROM fixture_isolation"), [
    { value: "one; two" },
  ]);
  assert.deepEqual(
    await second.runSql(
      "SELECT name FROM sqlite_master WHERE name='fixture_isolation'",
    ),
    [],
  );
  await first.env.SOCIAL_EXPORTS.put("isolation", "first only");
  assert.equal(await second.env.SOCIAL_EXPORTS.get("isolation"), null);
  for (const [index, fixture] of fixtures.entries()) {
    const headers = {
      authorization: `Basic ${Buffer.from(`fixture-admin:${index ? "second" : "first"}`).toString("base64")}`,
    };
    assert.equal(
      (
        await fixture.worker.fetch("https://sdlcai.org/api/admin/volunteers", {
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fixtures[1 - index].worker.fetch(
          "https://sdlcai.org/api/admin/volunteers",
          { headers },
        )
      ).status,
      401,
    );
  }
});
