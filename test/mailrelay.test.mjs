import assert from "node:assert/strict";
import test from "node:test";
import { syncMailrelay, mailrelayStatus } from "../worker/mailrelay.ts";
import {
  handleNewsletterRequest,
  unsubscribeNewsletter,
  purgeNewsletterData,
} from "../worker/newsletter.ts";
import { encryptText, hashText } from "../worker/form-utils.ts";
import { mailingFixture, mailRequest } from "./helpers/mailing-fixture.mjs";

function configured(f) {
  Object.assign(f.env, {
    MAILRELAY_SYNC_ENABLED: "true",
    MAILRELAY_ACCOUNT_DOMAIN: "sdlcai-test.ipzmarketing.com",
    MAILRELAY_API_KEY: "local-test-api-key",
    MAILRELAY_GROUP_ID: "44",
  });
}
async function seed(f, email = "reader@example.test", confirmed = true) {
  const id = crypto.randomUUID();
  const encrypted = await encryptText(email, f.env.EMAIL_ENCRYPTION_KEY);
  await f.db
    .prepare(
      "INSERT INTO newsletter_subscribers(id,email_hash,email_ciphertext,email_iv,status,consent_version,consent_text,requested_at) VALUES(?,?,?,?,'pending','test-v1','Email me SDLCAI news',?)",
    )
    .bind(
      id,
      await hashText(email, f.env.EMAIL_ENCRYPTION_KEY, "newsletter-address"),
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
    )
    .run();
  if (confirmed)
    await f.db
      .prepare(
        "UPDATE newsletter_subscribers SET status='subscribed', confirmed_at=? WHERE id=?",
      )
      .bind(new Date().toISOString(), id)
      .run();
  return id;
}
const job = (f, id) =>
  f.db
    .prepare("SELECT * FROM newsletter_mailrelay_sync WHERE subscriber_id=?")
    .bind(id)
    .first();
const clearGate = (f) =>
  f.db
    .prepare(
      "UPDATE newsletter_mailrelay_control SET next_request_at='' WHERE id=1",
    )
    .run();
const remoteContact = (overrides = {}) => ({
  id: 10,
  email: "reader@example.test",
  status: "active",
  unsubscribed: false,
  bounced: false,
  reported_spam: false,
  local_ban: false,
  global_ban: false,
  groups: [{ id: 99 }, { id: 44 }],
  ...overrides,
});
function provider(t, f, options = {}) {
  const contacts = new Map(
    (options.contacts ?? []).map((row) => [row.id, structuredClone(row)]),
  );
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers["X-AUTH-TOKEN"], "local-test-api-key");
    assert.equal(init.redirect, "error");
    const target = new URL(url);
    assert.equal(target.host, "sdlcai-test.ipzmarketing.com");
    const method = init.method,
      body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: target.pathname, body });
    // Most cases exercise state transitions without waiting for real rate slots.
    if (!options.realRateGate) await clearGate(f);
    if (options.onCall) {
      const result = await options.onCall({
        method,
        target,
        body,
        contacts,
        calls,
      });
      if (result) return result;
    }
    if (method === "POST") {
      assert.equal(target.pathname, "/api/v1/subscribers/sync");
      assert.deepEqual(body, {
        email: body.email,
        status: "active",
        group_ids: [44],
        replace_groups: false,
        restore_if_deleted: false,
      });
      let contact = [...contacts.values()].find(
        (row) => row.email === body.email,
      );
      if (!contact) {
        contact = remoteContact({
          id: 10 + contacts.size,
          email: body.email,
          groups: [{ id: 44 }],
        });
        contacts.set(contact.id, contact);
      } else if (!contact.groups.some((group) => group.id === 44))
        contact.groups.push({ id: 44 });
      return Response.json(contact, { status: 200 });
    }
    if (target.pathname === "/api/v1/subscribers") {
      assert.equal(target.searchParams.get("include_groups"), "true");
      return Response.json(
        [...contacts.values()].filter(
          (row) => row.email === target.searchParams.get("q[email_eq]"),
        ),
      );
    }
    const id = Number(target.pathname.split("/").at(-1));
    const row = contacts.get(id);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    if (method === "PATCH") row.groups = body.group_ids.map((id) => ({ id }));
    return Response.json(row);
  });
  return { contacts, calls };
}

test("Mailrelay is opt-in, configuration fails closed, and only confirmed subscribers sync using MonoLisa's payload", async (t) => {
  const f = await mailingFixture(t);
  const id = await seed(f);
  await seed(f, "unconfirmed@example.test", false);
  await f.roster([{ email: "attendee@example.test" }]);
  const mock = provider(t, f, { contacts: [remoteContact()] });
  assert.deepEqual(await syncMailrelay(f.env), {
    processed: false,
    reason: "disabled",
  });
  assert.equal(mock.calls.length, 0);
  configured(f);
  f.env.MAILRELAY_GROUP_ID = "0";
  assert.equal((await mailrelayStatus(f.env)).ready, false);
  await assert.rejects(syncMailrelay(f.env), /configuration_required/u);
  f.env.MAILRELAY_GROUP_ID = "44";
  f.env.MAILRELAY_ACCOUNT_DOMAIN = "https://bad.example/path";
  await assert.rejects(syncMailrelay(f.env), /configuration_required/u);
  f.env.MAILRELAY_ACCOUNT_DOMAIN = "sdlcai-test.ipzmarketing.com";
  assert.equal((await syncMailrelay(f.env)).processed, true);
  assert.equal(mock.calls.filter((row) => row.method === "POST").length, 1);
  assert.deepEqual(mock.contacts.get(10).groups, [{ id: 99 }, { id: 44 }]);
  const synced = await job(f, id);
  assert.equal(synced.state, "synced");
  assert.equal(synced.remote_id, 10);
  assert.equal(synced.email_ciphertext, null);
  assert.equal(f.messages.length, 0, "Sync never sends email");
  assert.equal((await syncMailrelay(f.env)).reason, "up_to_date");
  assert.doesNotMatch(
    JSON.stringify(await mailrelayStatus(f.env)),
    /local-test-api-key/u,
  );
  f.env.MAILRELAY_GROUP_ID = "45";
  assert.equal(
    (await mailrelayStatus(f.env)).error,
    "account_or_group_changed",
  );
  assert.equal((await syncMailrelay(f.env)).processed, false);
});

test("local opt-out removes only the SDLCAI group, works while signup is disabled, and clears temporary ciphertext", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  const mock = provider(t, f, { contacts: [remoteContact()] });
  await syncMailrelay(f.env);
  f.env.NEWSLETTER_ENABLED = "false";
  await unsubscribeNewsletter(f.env, id);
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT email_ciphertext FROM newsletter_subscribers WHERE id=?",
        )
        .bind(id)
        .first()
    ).email_ciphertext,
    null,
  );
  assert.ok(
    (await job(f, id)).email_ciphertext,
    "Encrypted address is held only for pending provider removal",
  );
  await syncMailrelay(f.env);
  assert.deepEqual(mock.contacts.get(10).groups, [{ id: 99 }]);
  assert.equal((await job(f, id)).email_ciphertext, null);
  assert.equal((await job(f, id)).state, "synced");
  const count = mock.calls.length;
  await syncMailrelay(f.env);
  assert.equal(
    mock.calls.length,
    count,
    "Completed withdrawals are idempotent",
  );
});

test("Mailrelay's live group_id membership format syncs and removes only the configured group", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  const mock = provider(t, f, {
    contacts: [remoteContact()],
    onCall: ({ method, target, contacts }) => {
      if (method !== "GET" || !target.pathname.endsWith("/10")) return;
      const contact = contacts.get(10);
      return Response.json({
        ...contact,
        groups: contact.groups.map((group) => ({
          group_id: group.id,
          name: "Group",
          assigned_at: "2026-10-12T10:00:00Z",
        })),
      });
    },
  });
  assert.equal((await syncMailrelay(f.env)).reason, "synced");
  assert.equal((await job(f, id)).state, "synced");
  await unsubscribeNewsletter(f.env, id);
  assert.equal((await syncMailrelay(f.env)).reason, "synced");
  assert.deepEqual(mock.contacts.get(10).groups, [{ id: 99 }]);
  assert.equal((await job(f, id)).email_ciphertext, null);

  const invalidId = await seed(f, "invalid-group@example.test");
  provider(t, f, {
    onCall: ({ method }) =>
      method === "GET"
        ? Response.json(
            remoteContact({
              email: "invalid-group@example.test",
              groups: [{ group_id: "44" }],
            }),
          )
        : undefined,
  });
  assert.equal((await syncMailrelay(f.env)).reason, "invalid_provider_groups");
  assert.equal((await job(f, invalidId)).state, "failed");
});

test("native Mailrelay unsubscribes are reconciled locally and never reactivated; bounces remain blocked", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  const mock = provider(t, f, {
    contacts: [remoteContact({ unsubscribed: true, status: "disabled" })],
  });
  await syncMailrelay(f.env);
  const row = await f.db
    .prepare(
      "SELECT status,email_ciphertext FROM newsletter_subscribers WHERE id=?",
    )
    .bind(id)
    .first();
  assert.equal(row.status, "unsubscribed");
  assert.equal(row.email_ciphertext, null);
  assert.equal(mock.contacts.get(10).unsubscribed, true);
  assert.deepEqual(mock.contacts.get(10).groups, [{ id: 99 }]);
  assert.equal((await job(f, id)).remote_status, "unsubscribed");
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM newsletter_consent_events WHERE subscriber_id=? AND action='unsubscribed'",
        )
        .bind(id)
        .first()
    ).n,
    1,
  );
  const bouncedId = await seed(f, "bounced@example.test");
  mock.contacts.set(
    11,
    remoteContact({
      id: 11,
      email: "bounced@example.test",
      bounced: true,
      status: "disabled",
    }),
  );
  await syncMailrelay(f.env);
  assert.equal((await job(f, bouncedId)).state, "blocked");
  assert.equal((await job(f, bouncedId)).remote_status, "bounced");
  assert.equal(
    (
      await f.db
        .prepare("SELECT status FROM newsletter_subscribers WHERE id=?")
        .bind(bouncedId)
        .first()
    ).status,
    "subscribed",
    "A delivery failure is not recorded as consent withdrawal",
  );
});

test("lost provider responses retry safely, an opt-out during enrollment wins, and concurrent syncs serialize", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  let failOnce = true;
  const mock = provider(t, f, {
    onCall: async ({ method, body, contacts }) => {
      if (method === "POST" && failOnce) {
        failOnce = false;
        contacts.set(10, remoteContact({ email: body.email }));
        throw new Error("Simulated lost response with private diagnostics");
      }
    },
  });
  assert.equal((await syncMailrelay(f.env)).reason, "network_error");
  assert.equal((await job(f, id)).state, "pending");
  assert.equal((await job(f, id)).error_code, "network_error");
  await unsubscribeNewsletter(f.env, id);
  assert.equal((await job(f, id)).remote_id, null);
  await syncMailrelay(f.env);
  assert.deepEqual(mock.contacts.get(10).groups, [{ id: 99 }]);
  assert.equal((await job(f, id)).state, "synced");

  const racingId = await seed(f, "racing@example.test");
  let entered, release;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const resume = new Promise((resolve) => {
    release = resolve;
  });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    await clearGate(f);
    if (init.method === "POST") {
      entered();
      await resume;
      return Response.json(
        remoteContact({ id: 12, email: "racing@example.test" }),
      );
    }
    if (init.method === "PATCH")
      return Response.json(
        remoteContact({
          id: 12,
          email: "racing@example.test",
          groups: [{ id: 99 }],
        }),
      );
    return Response.json(
      remoteContact({ id: 12, email: "racing@example.test" }),
    );
  });
  const first = syncMailrelay(f.env);
  await started;
  assert.equal((await syncMailrelay(f.env)).reason, "busy_or_cooldown");
  await unsubscribeNewsletter(f.env, racingId);
  release();
  assert.equal((await first).reason, "withdrawal_pending");
  assert.equal((await job(f, racingId)).desired_status, "unsubscribed");
  assert.equal((await job(f, racingId)).state, "pending");
  await syncMailrelay(f.env);
  assert.equal((await job(f, racingId)).state, "synced");
});

test("provider rate limits persist across requests, permanent failures require admin retry, and CSRF is enforced", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  const mock = provider(t, f, {
    onCall: () =>
      new Response("private provider response", {
        status: 429,
        headers: { "Retry-After": "300" },
      }),
  });
  assert.equal((await syncMailrelay(f.env)).reason, "http_429");
  const gate = await f.db
    .prepare("SELECT next_request_at FROM newsletter_mailrelay_control")
    .first();
  assert.ok(Date.parse(gate.next_request_at) > Date.now() + 290_000);
  assert.equal((await syncMailrelay(f.env)).reason, "busy_or_cooldown");
  assert.equal(mock.calls.length, 1);
  await clearGate(f);
  await f.db
    .prepare("UPDATE newsletter_mailrelay_sync SET next_attempt_at=''")
    .run();
  t.mock.method(globalThis, "fetch", async () => {
    await clearGate(f);
    return new Response("private address and credentials", { status: 422 });
  });
  assert.equal((await syncMailrelay(f.env)).reason, "http_422");
  assert.equal((await job(f, id)).state, "failed");
  assert.doesNotMatch(
    JSON.stringify(await job(f, id)),
    /private address|credentials/u,
  );
  const route = "/api/admin/newsletter/mailrelay";
  assert.equal(
    (
      await handleNewsletterRequest(
        mailRequest(route, { action: "retry" }),
        f.env,
      )
    ).status,
    403,
  );
  provider(t, f);
  const result = await handleNewsletterRequest(
    mailRequest(route, { action: "retry" }, "POST", "manage-newsletter"),
    f.env,
  );
  assert.equal(result.status, 200);
  assert.equal((await job(f, id)).state, "synced");
});

test("pre-campaign sync checks recent contacts, deleted contacts stay deleted, and fresh local consent can restore group membership", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  const mock = provider(t, f, { contacts: [remoteContact()] });
  await syncMailrelay(f.env);
  mock.contacts.delete(10);
  assert.equal((await syncMailrelay(f.env)).reason, "up_to_date");
  const result = await handleNewsletterRequest(
    mailRequest(
      "/api/admin/newsletter/mailrelay",
      { action: "start" },
      "POST",
      "manage-newsletter",
    ),
    f.env,
  );
  assert.equal(result.status, 200);
  assert.equal((await job(f, id)).remote_status, "deleted");
  assert.equal(
    mock.calls.filter((call) => call.method === "POST").length,
    1,
    "Reconciliation does not recreate deleted contacts",
  );
  const resub = await seed(f, "returning@example.test");
  await syncMailrelay(f.env);
  await unsubscribeNewsletter(f.env, resub);
  await syncMailrelay(f.env);
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET email_ciphertext=?,email_iv=? WHERE id=?",
    )
    .bind(
      ...Object.values(
        await encryptText("returning@example.test", f.env.EMAIL_ENCRYPTION_KEY),
      ),
      resub,
    )
    .run();
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET status='subscribed',confirmed_at=? WHERE id=?",
    )
    .bind(new Date().toISOString(), resub)
    .run();
  await syncMailrelay(f.env);
  assert.equal((await job(f, resub)).state, "synced");
  assert.equal(
    (
      await f.db
        .prepare("SELECT status FROM newsletter_subscribers WHERE id=?")
        .bind(resub)
        .first()
    ).status,
    "subscribed",
  );
  assert.ok(
    [...mock.contacts.values()]
      .find((row) => row.email === "returning@example.test")
      .groups.some((row) => row.id === 44),
  );
});

test("provider removals retain recovery data until completed, never-connected opt-outs erase it immediately", async (t) => {
  const f = await mailingFixture(t);
  const neverConnected = await seed(f);
  await unsubscribeNewsletter(f.env, neverConnected);
  assert.equal((await job(f, neverConnected)).email_ciphertext, null);
  configured(f);
  const id = await seed(f, "held@example.test");
  provider(t, f);
  await syncMailrelay(f.env);
  await unsubscribeNewsletter(f.env, id);
  await f.db
    .prepare(
      "UPDATE newsletter_subscribers SET unsubscribed_at='2000-01-01T00:00:00Z' WHERE id=?",
    )
    .bind(id)
    .run();
  await purgeNewsletterData(f.env);
  assert.ok(
    await job(f, id),
    "An unfinished provider removal must not be purged",
  );
  await syncMailrelay(f.env);
  await purgeNewsletterData(f.env);
  assert.equal(await job(f, id), null);
});

test("failed reconciliation never turns into re-enrollment, and invalid provider identities fail closed", async (t) => {
  const f = await mailingFixture(t);
  configured(f);
  const id = await seed(f);
  const mock = provider(t, f, { contacts: [remoteContact()] });
  await syncMailrelay(f.env);
  await f.db
    .prepare("UPDATE newsletter_mailrelay_sync SET checked_at=NULL")
    .run();
  t.mock.method(globalThis, "fetch", async () => {
    await clearGate(f);
    throw new Error("Simulated reconciliation outage");
  });
  assert.equal((await syncMailrelay(f.env)).reason, "network_error");
  assert.equal((await job(f, id)).needs_enrollment, 0);
  await f.db
    .prepare("UPDATE newsletter_mailrelay_sync SET next_attempt_at=''")
    .run();
  const recovered = provider(t, f, {
    contacts: [remoteContact({ groups: [{ id: 99 }] })],
  });
  await syncMailrelay(f.env);
  assert.equal(
    recovered.calls.filter((row) => row.method === "POST").length,
    0,
  );
  assert.equal((await job(f, id)).remote_status, "removed_from_group");
  assert.equal(
    (
      await f.db
        .prepare("SELECT status FROM newsletter_subscribers WHERE id=?")
        .bind(id)
        .first()
    ).status,
    "unsubscribed",
  );
  const wrong = await seed(f, "another@example.test");
  provider(t, f, {
    onCall: () => Response.json(remoteContact({ email: "wrong@example.test" })),
  });
  assert.equal(
    (await syncMailrelay(f.env)).reason,
    "provider_address_mismatch",
  );
  assert.equal((await job(f, wrong)).remote_id, null);
  assert.equal((await job(f, wrong)).state, "failed");
  assert.equal(mock.calls.filter((row) => row.method === "POST").length, 1);
});
