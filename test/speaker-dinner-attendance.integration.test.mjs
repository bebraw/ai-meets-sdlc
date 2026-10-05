import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

const futureDinner = {
  SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
  SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
};

test("organizer attendance preserves original dinner details, updates all private views and exports, and rejects stale saves", async (t) => {
  const fixture = await createReceiptFixture({ vars: futureDinner });
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const path = "/api/admin/speaker-dinner/attendance";
  const headers = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "manage-speaker-dinner-attendance",
  };
  const send = (body, extra = {}) =>
    worker.fetch(origin + path, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  const read = async () =>
    (
      await (
        await worker.fetch(origin + "/api/admin/speaker-dinner", { headers })
      ).json()
    ).speakers;
  const csv = async () =>
    (
      await worker.fetch(origin + "/api/admin/speaker-dinner.csv", { headers })
    ).text();
  const item = async (id = "mo-khazali") =>
    (await read()).find((speaker) => speaker.speaker_id === id);
  const change = async (attendance, id = "mo-khazali") =>
    send({
      speaker_id: id,
      revision: (await item(id)).dinner_revision,
      attendance,
    });
  const speakerHeaders = {
    cookie: cookies.get("mo-khazali"),
    origin,
    "content-type": "application/json",
  };
  const original = {
    attendance: "attending",
    meal_preference: "vegan",
    food_requirements: "Private nut allergy",
    cross_contamination: "yes",
  };
  const ownSave = () =>
    worker.fetch(origin + "/api/speaker/dinner", {
      method: "POST",
      headers: speakerHeaders,
      body: JSON.stringify({ ...original, consent: true }),
    });
  assert.equal((await ownSave()).status, 200);
  const before = await item();
  const storedBefore = (
    await runSql(
      "SELECT * FROM speaker_dinner_responses WHERE speaker_id = 'mo-khazali'",
    )
  )[0];
  const request = {
    speaker_id: "mo-khazali",
    attendance: "not_attending",
    revision: before.dinner_revision,
  };
  assert.equal((await send(request, { authorization: "" })).status, 401);
  assert.equal(
    (await send(request, { origin: "https://elsewhere.test" })).status,
    403,
  );
  assert.equal(
    (await send(request, { "x-admin-action": "wrong" })).status,
    403,
  );
  assert.equal((await send({ ...request, attendance: "maybe" })).status, 400);
  assert.equal(
    (await send({ ...request, speaker_id: "unknown-person" })).status,
    400,
  );
  const results = await Promise.all([send(request), send(request)]);
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [200, 409],
  );
  const declined = await item();
  assert.equal(declined.attendance_override, "not_attending");
  assert.equal(declined.response.attendance, "not_attending");
  assert.equal(declined.response.food_requirements, original.food_requirements);
  assert.equal(declined.responded_at, before.responded_at);
  const storedAfter = (
    await runSql(
      "SELECT * FROM speaker_dinner_responses WHERE speaker_id = 'mo-khazali'",
    )
  )[0];
  assert.equal(
    storedAfter.response_ciphertext,
    storedBefore.response_ciphertext,
  );
  assert.equal(storedAfter.consent_text, storedBefore.consent_text);
  assert.ok(storedAfter.attendance_override_ciphertext);
  assert.doesNotMatch(
    JSON.stringify(storedAfter),
    /not_attending|Private nut allergy/,
  );
  assert.doesNotMatch(await csv(), /Mo Khazali|Private nut allergy/);
  const workspace = await (
    await worker.fetch(origin + "/api/speaker/dinner", {
      headers: speakerHeaders,
    })
  ).json();
  assert.equal(workspace.attendance_source, "admin");
  assert.equal(workspace.response.attendance, "not_attending");
  const adminSpeakers = await (
    await worker.fetch(origin + "/api/admin/speakers", { headers })
  ).json();
  const adminDinner = adminSpeakers.speakers.find(
    (speaker) => speaker.speaker_id === "mo-khazali",
  ).dinner;
  assert.equal(adminDinner.attendance_source, "admin");
  assert.equal(adminDinner.response.attendance, "not_attending");
  assert.equal((await change(null)).status, 200);
  assert.deepEqual((await item()).response, original);
  assert.equal((await item()).attendance_override, null);
  assert.match(await csv(), /Mo Khazali.*speaker response/);
  assert.match(await csv(), /Private nut allergy/);

  // No RSVP is fabricated when an organizer records plans for a nonrespondent.
  assert.equal((await change("attending", "ohans-emmanuel")).status, 200);
  const manual = await item("ohans-emmanuel");
  assert.equal(manual.responded_at, null);
  assert.equal(manual.response.meal_preference, "");
  assert.match(await csv(), /Ohans Emmanuel.*attendance set by admin/);
  const noConsent = (
    await runSql(
      "SELECT consent_text, responded_at FROM speaker_dinner_responses WHERE speaker_id = 'ohans-emmanuel'",
    )
  )[0];
  assert.equal(noConsent.consent_text, null);
  assert.equal(noConsent.responded_at, null);
  assert.equal((await change(null, "ohans-emmanuel")).status, 200);
  assert.equal((await item("ohans-emmanuel")).response, null);

  // A later speaker update supersedes an organizer setting and invalidates its old revision.
  assert.equal((await change("not_attending")).status, 200);
  const stale = await item();
  assert.equal((await ownSave()).status, 200);
  assert.equal((await item()).attendance_override, null);
  assert.equal(
    (
      await send({
        speaker_id: "mo-khazali",
        revision: stale.dinner_revision,
        attendance: "not_attending",
      })
    ).status,
    409,
  );

  // Older personal links read the same effective status and can also replace it.
  const invitationData = new URLSearchParams({ speaker_id: "mo-khazali" });
  const invite = await worker.fetch(
    origin + "/api/admin/speaker-dinner/invite",
    {
      method: "POST",
      headers: {
        authorization: receiptAdmin,
        origin,
        "x-admin-action": "rotate-speaker-dinner-invite",
      },
      body: invitationData,
    },
  );
  const invitePayload = await invite.json();
  assert.equal(invite.status, 201, JSON.stringify(invitePayload));
  const token = new URL(invitePayload.invite_url).hash.slice(1);
  assert.equal((await change("not_attending")).status, 200);
  const legacyHeaders = { authorization: `Bearer ${token}`, origin };
  const legacy = await (
    await worker.fetch(origin + "/api/speaker-dinner", {
      headers: legacyHeaders,
    })
  ).json();
  assert.equal(legacy.response.attendance, "not_attending");
  const form = new URLSearchParams({ ...original, consent: "yes" });
  assert.equal(
    (
      await worker.fetch(origin + "/api/speaker-dinner", {
        method: "POST",
        headers: legacyHeaders,
        body: form,
      })
    ).status,
    200,
  );
  assert.equal((await item()).attendance_override, null);
  const events = await (
    await worker.fetch(
      origin + "/api/admin/activity?actor=admin&speaker=mo-khazali",
      { headers },
    )
  ).json();
  assert.ok(
    events.events.some(
      (event) =>
        event.category === "Dinner attendance" && event.action === "updated",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /Private nut allergy|not_attending/,
  );
});

test("organizers can correct dinner attendance after the RSVP deadline", async (t) => {
  const fixture = await createReceiptFixture({
    vars: {
      ...futureDinner,
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2000-10-05T20:59:59Z",
    },
  });
  t.after(() => fixture.dispose());
  const response = await fixture.worker.fetch(
    origin + "/api/admin/speaker-dinner/attendance",
    {
      method: "POST",
      headers: {
        authorization: receiptAdmin,
        origin,
        "content-type": "application/json",
        "x-admin-action": "manage-speaker-dinner-attendance",
      },
      body: JSON.stringify({
        speaker_id: "mo-khazali",
        attendance: "not_attending",
        revision: 0,
      }),
    },
  );
  assert.equal(response.status, 200);
  const list = await (
    await fixture.worker.fetch(origin + "/api/admin/speaker-dinner", {
      headers: { authorization: receiptAdmin },
    })
  ).json();
  assert.equal(
    list.speakers.find((speaker) => speaker.speaker_id === "mo-khazali")
      .response.attendance,
    "not_attending",
  );
});
