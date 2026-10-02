import assert from "node:assert/strict";
import test from "node:test";
import { qaParticipant } from "../worker/qa-auth.ts";

const env = { EMAIL_ENCRYPTION_KEY: "qa-auth-unit-secret" };
test("anonymous QA cookies are signed, bounded, and secure on HTTPS", async () => {
  const first = await qaParticipant(new Request("https://sdlcai.org/qa/"), env);
  assert.match(
    first.cookie,
    /HttpOnly; SameSite=Strict; Max-Age=64800; Secure$/,
  );
  const pair = first.cookie.split(";")[0];
  const second = await qaParticipant(
    new Request("https://sdlcai.org/qa/", { headers: { cookie: pair } }),
    env,
  );
  assert.equal(second.id, first.id);
  assert.equal(second.cookie, undefined);
  const forged = pair.replace(first.id, "x".repeat(43));
  const reset = await qaParticipant(
    new Request("https://sdlcai.org/qa/", { headers: { cookie: forged } }),
    env,
  );
  assert.notEqual(reset.id, "x".repeat(43));
  assert.ok(reset.cookie);
  const expired = pair.replace(/v1\.\d{10}\./, "v1.1000000000.");
  assert.ok(
    (
      await qaParticipant(
        new Request("https://sdlcai.org/qa/", { headers: { cookie: expired } }),
        env,
      )
    ).cookie,
  );
});
