import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import {
  getAdminSpeakers,
  saveSpeakerContact,
  sendSpeakerInvitation,
} from "../worker/speaker-admin.ts";
import {
  requestSpeakerLogin,
  redeemSpeakerInvitation,
} from "../worker/speaker-login.ts";
import { getAnnouncementRecipients } from "../worker/announcement-recipients.ts";
import { decryptPrivateText } from "../worker/speaker-workspace-utils.ts";

const origin = "https://sdlcai.org";
const migrations = await Promise.all(
  (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => readFile(`migrations/${n}`, "utf8")),
);
const request = (body) =>
  new Request(`${origin}/speaker/`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("speaker links tolerate delayed delivery and expire after 24 hours", async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  assert.equal((await f.save()).status, 200);
  const first = await f.login("work@example.test");
  const row = await f.db.prepare("SELECT * FROM speaker_magic_links").first();
  assert.equal(
    Date.parse(row.expires_at) - Date.parse(row.created_at),
    24 * 60 * 60 * 1000,
  );
  t.mock.timers.tick(20 * 60 * 1000);
  const second = await f.login("work@example.test");
  assert.notEqual(first, second);
  assert.equal(
    (await f.redeem(first)).status,
    200,
    "A newer request must not invalidate delayed email",
  );
  assert.equal((await f.redeem(first)).status, 401, "Each link is single-use");
  t.mock.timers.tick(24 * 60 * 60 * 1000 + 1);
  assert.equal((await f.redeem(second)).status, 401);
  t.mock.timers.reset();
});

test("either encrypted email signs in, with separate confirmation and one announcement address", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.save({ secondary_email: " Personal@Example.Test " })).status,
    200,
  );
  assert.equal(f.messages.length, 0, "Saving contact details sends no email");
  const row = await f.contact();
  assert.doesNotMatch(
    JSON.stringify(row),
    /personal@example\.test|work@example\.test/iu,
  );
  assert.equal(
    await decryptPrivateText(
      row.secondary_email_ciphertext,
      row.secondary_email_iv,
      f.env.EMAIL_ENCRYPTION_KEY,
    ),
    "personal@example.test",
  );
  const secondary = await f.login(" PERSONAL@example.test ");
  assert.equal(f.messages.at(-1).to, "personal@example.test");
  const response = await f.redeem(secondary);
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("set-cookie"),
    /HttpOnly; Secure; SameSite=Lax; Max-Age=1209600/u,
  );
  const confirmed = await f.contact();
  assert.ok(confirmed.secondary_email_confirmed_at);
  assert.equal(confirmed.email_confirmed_at, null);
  const admin = await (await getAdminSpeakers(f.env)).json();
  assert.equal(
    admin.speakers.find((s) => s.speaker_id === "mo-khazali").contact
      .secondary_email,
    "personal@example.test",
  );
  const operational = await getAnnouncementRecipients(
    f.env,
    ["mo-khazali"],
    "operational",
  );
  assert.equal(operational.recipients.length, 1);
  assert.equal(operational.recipients[0].email, "work@example.test");
  const promotion = await getAnnouncementRecipients(
    f.env,
    ["mo-khazali"],
    "promotion",
  );
  assert.equal(promotion.recipients.length, 0);
  const primary = await f.login("work@example.test");
  assert.equal(f.messages.at(-1).to, "work@example.test");
  assert.equal((await f.redeem(primary)).status, 200);
  assert.ok((await f.contact()).email_confirmed_at);
  const legacy = await sendSpeakerInvitation(
    request({ speaker_id: "mo-khazali", email: "work@example.test" }),
    f.env,
  );
  assert.equal(legacy.status, 200);
  assert.equal(f.messages.at(-1).to, "work@example.test");
  assert.ok((await f.contact()).secondary_email_confirmed_at);
});

test("contact edits preserve unchanged access and revoke old links and sessions when either address changes", async (t) => {
  const f = await fixture(t);
  await f.save({ secondary_email: "personal@example.test" });
  const token = await f.login("personal@example.test");
  assert.equal((await f.redeem(token)).status, 200);
  const generation = (await f.access()).access_generation;
  await f.save(); // Legacy clients omit the secondary field.
  assert.equal((await f.access()).access_generation, generation);
  assert.ok((await f.contact()).secondary_email_confirmed_at);
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM speaker_workspace_sessions")
        .first()
    ).n,
    1,
  );
  const primary = await f.login("work@example.test");
  await f.save({ secondary_email: "replacement@example.test" });
  assert.equal((await f.access()).access_generation, generation + 1);
  assert.equal((await f.redeem(primary)).status, 401);
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS n FROM speaker_workspace_sessions")
        .first()
    ).n,
    0,
  );
  assert.equal((await f.contact()).secondary_email_confirmed_at, null);
  assert.equal(await f.login("personal@example.test"), null);
  assert.ok(await f.login("replacement@example.test"));
  await f.save({ secondary_email: "" });
  assert.equal((await f.contact()).secondary_email_ciphertext, null);
  assert.equal((await f.contact()).secondary_email_fingerprint, null);
  assert.equal(await f.login("replacement@example.test"), null);
  await f.save({ secondary_email: "final-backup@example.test" });
  const fallback = await f.login("final-backup@example.test");
  assert.ok(fallback);
  await f.save({ email: "new-work@example.test" });
  assert.equal((await f.redeem(fallback)).status, 401);
  assert.equal(await f.login("work@example.test"), null);
  assert.equal((await f.contact()).email_confirmed_at, null);
});

test("addresses cannot collide across speakers, fields, or the legacy invitation path", async (t) => {
  const f = await fixture(t);
  await f.save({ secondary_email: "personal@example.test" });
  for (const body of [
    { email: "personal@example.test" },
    { secondary_email: "work@example.test" },
    { secondary_email: "personal@example.test" },
  ]) {
    assert.equal(
      (
        await f.save({
          speaker_id: "ohans-emmanuel",
          email: "other@example.test",
          ...body,
        })
      ).status,
      409,
    );
  }
  for (const secondary_email of ["work@example.test", "invalid", 123]) {
    assert.equal((await f.save({ secondary_email })).status, 400);
  }
  assert.equal(
    (
      await sendSpeakerInvitation(
        request({
          speaker_id: "ohans-emmanuel",
          email: "personal@example.test",
        }),
        f.env,
      )
    ).status,
    409,
  );
  assert.equal(f.messages.length, 0);
  await f.save({ speaker_id: "ohans-emmanuel", email: "other@example.test" });
  const fp = (await f.contact()).secondary_email_fingerprint;
  await assert.rejects(
    f.db
      .prepare(
        "UPDATE speaker_contacts SET email_fingerprint = ?1 WHERE speaker_id = 'ohans-emmanuel'",
      )
      .bind(fp)
      .run(),
    /Speaker email already assigned/u,
  );
  const primaryFp = (await f.contact()).email_fingerprint;
  await assert.rejects(
    f.db
      .prepare(
        "UPDATE speaker_contacts SET secondary_email_fingerprint = ?1 WHERE speaker_id = 'ohans-emmanuel'",
      )
      .bind(primaryFp)
      .run(),
    /Speaker email already assigned/u,
  );
});

test("fallback login obeys suppression, rate limits, retention, revocation, and the access deadline", async (t) => {
  const f = await fixture(t);
  await f.save({ secondary_email: "personal@example.test" });
  const deadline = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await f.db
    .prepare("UPDATE speaker_workspace_access SET invite_expires_at = ?1")
    .bind(deadline)
    .run();
  const token = await f.login("personal@example.test");
  assert.equal(
    (await f.db.prepare("SELECT expires_at FROM speaker_magic_links").first())
      .expires_at,
    deadline,
  );
  assert.equal(
    await f.login("personal@example.test"),
    null,
    "Cooldown applies to fallback addresses too",
  );
  await f.db.prepare("DELETE FROM speaker_login_requests").run();
  await f.db
    .prepare("UPDATE speaker_contacts SET delivery_status = 'suppressed'")
    .run();
  const suppressed = await f.loginResponse("personal@example.test");
  const unknown = await f.loginResponse("unknown@example.test");
  assert.deepEqual(
    suppressed,
    unknown,
    "The public response must not reveal mapped addresses",
  );
  await f.db
    .prepare(
      "UPDATE speaker_contacts SET delivery_status = 'active', retention_until = '2000-01-01T00:00:00Z'",
    )
    .run();
  assert.equal(await f.login("personal@example.test"), null);
  await f.db
    .prepare(
      "UPDATE speaker_contacts SET retention_until = '2099-11-30T00:00:00Z'",
    )
    .run();
  await f.db
    .prepare("UPDATE speaker_workspace_access SET revoked_at = ?1")
    .bind(new Date().toISOString())
    .run();
  assert.equal(await f.login("personal@example.test"), null);
  assert.equal((await f.redeem(token)).status, 401);
  await f.db
    .prepare(
      "UPDATE speaker_workspace_access SET revoked_at = NULL, invite_expires_at = '2000-01-01T00:00:00Z'",
    )
    .run();
  assert.equal(await f.login("personal@example.test"), null);
});

async function fixture(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch() {return new Response('ok')}}",
      compatibilityDate: "2026-04-30",
      d1Databases: ["INTERESTS"],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS");
  for (const migration of migrations) {
    await db.batch(
      unstable_splitSqlQuery(migration).map((sql) => db.prepare(sql)),
    );
  }
  const messages = [];
  const env = {
    INTERESTS: db,
    EMAIL_ENCRYPTION_KEY: "local-speaker-login-test-key",
    PUBLIC_SITE_ORIGIN: origin,
    TURNSTILE_SITE_KEY: "",
    SPEAKER_WORKSPACE_ACCESS_UNTIL: "2099-10-31T21:59:59Z",
    SPEAKER_CONTACT_RETENTION_UNTIL: "2099-11-30T21:59:59Z",
    EMAIL: {
      send: async (message) => {
        messages.push(message);
        return { messageId: crypto.randomUUID() };
      },
    },
  };
  const tasks = [];
  const f = {
    env,
    db,
    messages,
    save: (overrides = {}) =>
      saveSpeakerContact(
        request({
          speaker_id: "mo-khazali",
          email: "work@example.test",
          ...overrides,
        }),
        env,
      ),
    contact: () =>
      db
        .prepare(
          "SELECT * FROM speaker_contacts WHERE speaker_id = 'mo-khazali'",
        )
        .first(),
    access: () =>
      db
        .prepare(
          "SELECT * FROM speaker_workspace_access WHERE speaker_id = 'mo-khazali'",
        )
        .first(),
    async loginResponse(email) {
      const response = await requestSpeakerLogin(request({ email }), env, {
        waitUntil: (task) => tasks.push(task),
      });
      await Promise.all(tasks.splice(0));
      assert.equal(response.status, 202);
      return response.json();
    },
    async login(email) {
      const before = messages.length;
      await f.loginResponse(email);
      return messages.length === before
        ? null
        : new URL(
            messages
              .at(-1)
              .text.match(/https:\/\/sdlcai\.org\/speaker\/#[\w-]+/u)[0],
          ).hash.slice(1);
    },
    redeem: (token) =>
      redeemSpeakerInvitation(
        new Request(`${origin}/api/speaker/session`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        }),
        env,
      ),
  };
  return f;
}
