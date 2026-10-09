import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { format } from "node:util";
import { expectConsoleErrors } from "./helpers/expected-console-errors.mjs";
import { Miniflare } from "miniflare";
import {
  previewSpeakerAnnouncement,
  sendSpeakerAnnouncement,
  retrySpeakerAnnouncement,
  getSpeakerAnnouncements,
  testSpeakerAnnouncement,
} from "../worker/speaker-announcements.ts";
import {
  handleAdminDinnerGuest,
  handleAdminDinnerGuestEmail,
  readSpeakerDinnerSharedAdminItems,
} from "../worker/speaker-dinner.ts";
import {
  encryptPrivateText,
  hashPrivateText,
} from "../worker/speaker-workspace-utils.ts";

const migrations = await Promise.all(
  (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()
    .map((n) => readFile(`migrations/${n}`, "utf8")),
);
const origin = "https://sdlcai.org";
const input = {
  category: "operational",
  speaker_ids: ["mo-khazali", "ohans-emmanuel"],
  include_dinner: true,
  subject: "Event and dinner details",
  text_body: "General information for everyone attending our event.",
  speaker_text_body: "Speaker-only setup instructions.",
  dinner_text_body: "Dinner-only arrival instructions.",
  closing_text_body: "Best,\nJuho & the SDLCAI team",
};
const request = (body) =>
  new Request(origin, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const preview = async (f, body = input) =>
  (await previewSpeakerAnnouncement(request(body), f.env)).json();
const send = (f, p, body = input) =>
  sendSpeakerAnnouncement(
    request({
      ...body,
      preview_token: p.preview_token,
      confirm_recipient_count: p.recipient_count,
    }),
    f.env,
  );

test("combined audiences deduplicate normalized email, preview overlap, flag missing addresses and send the right sections privately", async (t) => {
  const f = await fixture(t);
  await f.guest("Mo's duplicate dinner RSVP", " MO@EXAMPLE.TEST ");
  await f.guest("Missing email", "");
  await f.guest("Not attending", "declined@example.test", "not_attending");
  await f.guest("Mo Khazali", "different-person@example.test");
  const p = await preview(f);
  assert.equal(p.recipient_count, 4);
  assert.deepEqual(p.audience_counts, {
    speakers_only: 1,
    dinner_only: 2,
    both: 1,
  });
  assert.equal(p.excluded.length, 1);
  assert.equal(p.excluded[0].name, "Missing email");
  assert.equal(p.variants.length, 3);
  for (const variant of p.variants) {
    assert.ok(variant.text_body.includes(input.closing_text_body));
    assert.equal(variant.text_body.split(input.closing_text_body).length, 2);
    assert.match(variant.html_body, /Best,<br>Juho &amp; the SDLCAI team/u);
    for (const section of [input.speaker_text_body, input.dinner_text_body]) {
      if (variant.text_body.includes(section))
        assert.ok(
          variant.text_body.indexOf(section) <
            variant.text_body.indexOf(input.closing_text_body),
        );
    }
    assert.doesNotMatch(
      variant.text_body,
      /Speaker information|Dinner information|Closing \/ signature/u,
    );
  }
  const speaker = p.variants.find((v) => v.label === "Speakers only");
  assert.match(speaker.text_body, /Speaker-only/u);
  assert.doesNotMatch(speaker.text_body, /Dinner-only/u);
  assert.doesNotMatch(JSON.stringify(p), /@example.test/u);
  const response = await send(f, p);
  assert.equal(response.status, 200);
  assert.equal(f.messages.length, 4);
  assert.equal(new Set(f.messages.map((m) => m.to)).size, 4);
  for (const message of f.messages) {
    assert.ok(message.text.includes(input.closing_text_body));
    assert.match(message.html, /Best,<br>Juho &amp; the SDLCAI team/u);
  }
  const mo = f.messages.find((m) => m.to === "mo@example.test");
  assert.match(mo.text, /Speaker-only/u);
  assert.match(mo.text, /Dinner-only/u);
  const ohans = f.messages.find((m) => m.to === "ohans@example.test");
  assert.match(ohans.text, /Speaker-only/u);
  assert.doesNotMatch(ohans.text, /Dinner-only/u);
  const guest = f.messages.find((m) => m.to === "guest@example.test");
  assert.doesNotMatch(guest.text, /Speaker-only/u);
  assert.match(guest.text, /Dinner-only/u);
  assert.equal(guest.cc, undefined);
  assert.equal(guest.bcc, undefined);
  const archive = await (
    await getSpeakerAnnouncements(f.env, new Request(origin))
  ).json();
  assert.equal(archive.campaigns[0].deliveries.length, 4);
  assert.equal(archive.campaigns[0].dinner_text_body, input.dinner_text_body);
  assert.equal(archive.campaigns[0].closing_text_body, input.closing_text_body);
  assert.doesNotMatch(
    JSON.stringify(archive),
    /@example.test|email_fingerprint/u,
  );
});

test("dinner-only updates include attending speakers without the speaker section; dinner cannot receive promotion", async (t) => {
  const f = await fixture(t);
  const body = { ...input, speaker_ids: [] };
  const p = await preview(f, body);
  assert.equal(p.recipient_count, 2);
  assert.deepEqual(p.audience_counts, {
    speakers_only: 0,
    dinner_only: 2,
    both: 0,
  });
  assert.equal((await send(f, p, body)).status, 200);
  assert.ok(f.messages.every((m) => !m.text.includes("Speaker-only")));
  assert.equal(
    (
      await previewSpeakerAnnouncement(
        request({ ...body, category: "promotion" }),
        f.env,
      )
    ).status,
    400,
  );
});

test("dinner aliases cannot bypass suppression, disabled operational mail or expired speaker contacts", async (t) => {
  const f = await fixture(t);
  await f.guest("Mo alias", "mo@example.test");
  for (const update of [
    "delivery_status='suppressed'",
    "operational_email_enabled=0",
    "retention_until='2000-01-01T00:00:00Z'",
  ]) {
    await f.db
      .prepare(
        `UPDATE speaker_contacts SET delivery_status='active', operational_email_enabled=1, retention_until='2099-11-30T00:00:00Z', ${update} WHERE speaker_id='mo-khazali'`,
      )
      .run();
    const p = await preview(f);
    assert.equal(p.recipient_count, 2);
    assert.ok(!p.recipients.some((r) => r.speaker_id === "mo-khazali"));
  }
  const oldEnv = {
    ...f.env,
    SPEAKER_DINNER_RETENTION_UNTIL: "2000-01-01T00:00:00Z",
  };
  const p = await (
    await previewSpeakerAnnouncement(
      request({ ...input, speaker_ids: [] }),
      oldEnv,
    )
  ).json();
  assert.equal(p.recipient_count, 0);
  assert.equal(p.excluded[0].reason, "dinner-retention-ended");
});

test("preview confirmation detects changed addresses with the same count and changed message content", async (t) => {
  const f = await fixture(t);
  const p = await preview(f);
  assert.equal(
    (
      await send(f, p, {
        ...input,
        closing_text_body: "Regards,\nJuho",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await send(f, p, {
        ...input,
        text_body: "A changed message with the same recipients.",
      })
    ).status,
    409,
  );
  const guest = (await readSpeakerDinnerSharedAdminItems(f.env))[0];
  assert.equal(
    (
      await handleAdminDinnerGuestEmail(
        request({
          response_id: guest.response_id,
          revision: guest.email_revision,
          email: "replacement@example.test",
        }),
        f.env,
      )
    ).status,
    200,
  );
  assert.equal((await preview(f)).recipient_count, p.recipient_count);
  assert.equal((await send(f, p)).status, 409);
  assert.equal(f.messages.length, 0);
});

test("concurrent and repeated submissions of a confirmed preview create one campaign", async (t) => {
  const f = await fixture(t);
  const p = await preview(f);
  const responses = await Promise.all([send(f, p), send(f, p)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await send(f, p)).status, 409);
  assert.equal(f.messages.length, p.recipient_count);
  assert.equal(
    (
      await f.db
        .prepare("SELECT COUNT(*) AS count FROM speaker_email_campaigns")
        .first()
    ).count,
    1,
  );
});

test("concurrent retries send only failures and recheck the original contact and attendance", async (t) => {
  const f = await fixture(t);
  const deliver = f.env.EMAIL.send;
  f.env.EMAIL.send = async (message) => {
    if (message.to === "guest@example.test")
      throw new Error("Simulated provider rejection");
    return deliver(message);
  };
  const guest = (await readSpeakerDinnerSharedAdminItems(f.env))[0];
  const firstPreview = await preview(f);
  const sent = await expectConsoleErrors(
    t,
    ({ campaign_id }) => [
      format("Speaker announcement delivery failed", {
        campaignId: campaign_id,
        speakerId: `dinner-guest:${guest.response_id}`,
      }),
    ],
    async () => (await send(f, firstPreview)).json(),
  );
  assert.equal(sent.failed_count, 1);
  assert.equal(f.messages.length, 2);
  f.env.EMAIL.send = deliver;
  const retries = await Promise.all([
    retrySpeakerAnnouncement(request({ campaign_id: sent.campaign_id }), f.env),
    retrySpeakerAnnouncement(request({ campaign_id: sent.campaign_id }), f.env),
  ]);
  assert.deepEqual(retries.map((r) => r.status).sort(), [200, 409]);
  assert.equal(f.messages.length, 3);
  const retried = f.messages.find(
    (message) => message.to === "guest@example.test",
  );
  assert.ok(
    retried.text.indexOf(input.dinner_text_body) <
      retried.text.indexOf(input.closing_text_body),
  );
  assert.match(retried.html, /Best,<br>Juho &amp; the SDLCAI team/u);
  assert.equal(
    (
      await retrySpeakerAnnouncement(
        request({ campaign_id: sent.campaign_id }),
        f.env,
      )
    ).status,
    409,
  );
  f.env.EMAIL.send = async () => {
    throw new Error("Simulated rejection");
  };
  const secondPreview = await preview(f);
  const second = await expectConsoleErrors(
    t,
    ({ campaign_id }) =>
      secondPreview.recipients.map(({ speaker_id }) =>
        format("Speaker announcement delivery failed", {
          campaignId: campaign_id,
          speakerId: speaker_id,
        }),
      ),
    async () => (await send(f, secondPreview)).json(),
  );
  await handleAdminDinnerGuestEmail(
    request({
      response_id: guest.response_id,
      revision: guest.email_revision,
      email: "new@example.test",
    }),
    f.env,
  );
  await f.db
    .prepare("UPDATE speaker_contacts SET operational_email_enabled=0")
    .run();
  f.env.EMAIL.send = deliver;
  assert.equal(
    (
      await retrySpeakerAnnouncement(
        request({ campaign_id: second.campaign_id }),
        f.env,
      )
    ).status,
    200,
  );
  assert.equal(
    f.messages.length,
    3,
    "changed contact and preferences are skipped instead of sending again",
  );
});

test("closing text is optional, normalized and included in the combined length limit and test messages", async (t) => {
  const f = await fixture(t);
  const { closing_text_body, ...withoutClosing } = input;
  const p = await preview(f, withoutClosing);
  assert.ok(
    p.variants.every((variant) => !variant.text_body.includes("Best,")),
  );
  assert.equal(
    (
      await previewSpeakerAnnouncement(
        request({ ...input, closing_text_body: "x".repeat(10_000) }),
        f.env,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await testSpeakerAnnouncement(
        request({
          ...input,
          closing_text_body: "  Best,\r\nJuho & the SDLCAI team  ",
          test_email: "test@example.test",
        }),
        f.env,
      )
    ).status,
    200,
  );
  assert.equal(f.messages.length, 1);
  assert.ok(f.messages[0].text.includes(closing_text_body));
  assert.ok(
    f.messages[0].text.indexOf(input.dinner_text_body) <
      f.messages[0].text.indexOf(closing_text_body),
  );
  assert.match(f.messages[0].html, /Best,<br>Juho &amp; the SDLCAI team/u);
});

test("an accepted send whose database write fails keeps its claim and cannot be resent automatically", async (t) => {
  const f = await fixture(t);
  const p = await preview(f);
  const db = f.env.INTERESTS;
  f.env.INTERESTS = {
    batch: (statements) => db.batch(statements),
    prepare(sql) {
      const statement = db.prepare(sql);
      if (sql.includes("SET status = 'sent'"))
        return {
          bind() {
            return {
              run: async () => {
                throw new Error("Simulated database outage");
              },
            };
          },
        };
      return statement;
    },
  };
  await assert.rejects(send(f, p), /database outage/u);
  f.env.INTERESTS = db;
  assert.equal(f.messages.length, 1);
  assert.equal((await send(f, p)).status, 409);
  const campaign = await db
    .prepare("SELECT campaign_id FROM speaker_email_campaigns")
    .first();
  assert.equal(
    (await retrySpeakerAnnouncement(request(campaign), f.env)).status,
    409,
  );
  assert.ok(
    (
      await db
        .prepare(
          "SELECT claim_token FROM speaker_email_deliveries WHERE attempts=1",
        )
        .first()
    ).claim_token,
  );
});

test("guest update emails are encrypted, optional, validated, revision guarded and excluded from catering data", async (t) => {
  const f = await fixture(t);
  const guest = (await readSpeakerDinnerSharedAdminItems(f.env))[0];
  assert.equal(guest.email, "guest@example.test");
  const stored = await f.db
    .prepare("SELECT * FROM speaker_dinner_shared_responses")
    .first();
  assert.doesNotMatch(JSON.stringify(stored), /guest@example.test/u);
  const body = {
    response_id: guest.response_id,
    revision: guest.email_revision,
    email: "changed@example.test",
  };
  assert.equal(
    (
      await handleAdminDinnerGuestEmail(
        request({ ...body, email: "not an email" }),
        f.env,
      )
    ).status,
    400,
  );
  const results = await Promise.all([
    handleAdminDinnerGuestEmail(request(body), f.env),
    handleAdminDinnerGuestEmail(request(body), f.env),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await handleAdminDinnerGuestEmail(
        request({ ...body, revision: 1, email: "" }),
        f.env,
      )
    ).status,
    200,
  );
  const cleared = (await readSpeakerDinnerSharedAdminItems(f.env))[0];
  assert.equal(cleared.email, null);
  assert.equal(cleared.email_revision, 2);
  assert.equal(cleared.response.email, undefined);
});

async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    script: "export default {fetch() {return new Response('ok')}}",
    compatibilityDate: "2026-04-30",
    d1Databases: ["INTERESTS"],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS");
  for (const migration of migrations)
    for (const sql of migration
      .split(/;\s*\n/u)
      .map((p) => p.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  const messages = [];
  const env = {
    INTERESTS: db,
    EMAIL_ENCRYPTION_KEY: "local-announcement-test-key",
    SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T00:00:00Z",
    SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T00:00:00Z",
    EMAIL: {
      send: async (message) => {
        messages.push(message);
        return { messageId: crypto.randomUUID() };
      },
    },
  };
  for (const [id, address] of [
    ["mo-khazali", "mo@example.test"],
    ["ohans-emmanuel", "ohans@example.test"],
  ]) {
    const encrypted = await encryptPrivateText(
      address,
      env.EMAIL_ENCRYPTION_KEY,
    );
    await db
      .prepare(
        `INSERT INTO speaker_contacts (speaker_id,email_ciphertext,email_iv,email_fingerprint,retention_until,created_at,updated_at) VALUES (?1,?2,?3,?4,'2099-11-30T00:00:00Z',?5,?5)`,
      )
      .bind(
        id,
        encrypted.ciphertext,
        encrypted.iv,
        await hashPrivateText(address, env.EMAIL_ENCRYPTION_KEY, "email-hash"),
        new Date().toISOString(),
      )
      .run();
  }
  const dinner = await encryptPrivateText(
    JSON.stringify({
      attendance: "attending",
      meal_preference: "vegan",
      food_requirements: "",
      cross_contamination: "no",
    }),
    env.EMAIL_ENCRYPTION_KEY,
  );
  await db
    .prepare(
      `INSERT INTO speaker_dinner_responses (speaker_id,token_hash,expires_at,response_ciphertext,response_iv,created_at,updated_at,consent_text,responded_at) VALUES ('mo-khazali','local-token','2099-10-26T00:00:00Z',?1,?2,?3,?3,'Test consent',?3)`,
    )
    .bind(dinner.ciphertext, dinner.iv, new Date().toISOString())
    .run();
  async function guest(name, email, attendance = "attending") {
    const response = await handleAdminDinnerGuest(
      new Request(origin, {
        method: "POST",
        body: new URLSearchParams({
          name,
          email,
          attendance,
          consent: "yes",
          meal_preference: "vegan",
          food_requirements: "",
          cross_contamination: "no",
        }),
      }),
      env,
    );
    assert.equal(response.status, 200, await response.text());
  }
  await guest("Dinner guest", "guest@example.test");
  return { db, env, messages, guest };
}
