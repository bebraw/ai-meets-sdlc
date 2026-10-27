import assert from "node:assert/strict";
import test from "node:test";
import { createEventFixture } from "./helpers/event-fixture.mjs";
import { parseVideoExportManifest } from "../site/scripts/video-export-contract.ts";

const origin = "https://sdlcai.org";
const authorization = `Basic ${Buffer.from("events-admin:events-password").toString("base64")}`;

test("event routes isolate databases, actions, credentials and backups while news stays shared", async (t) => {
  const fixture = await createEventFixture();
  t.after(() => fixture.dispose());
  const { worker, env, eventDb } = fixture;
  const get = (path, init = {}) =>
    worker.fetch(origin + path, { headers: { authorization }, ...init });
  const endpoint = (id) => `/events/${id}/api/admin/volunteers`;
  const mutate = (id, name) =>
    get(endpoint(id), {
      method: "POST",
      headers: { authorization, origin, "x-admin-action": "manage-volunteers" },
      body: new URLSearchParams({
        name,
        email: `${id}@example.test`,
        task: "Event desk",
        badge: "false",
      }),
    });

  const shared = await get("/admin/");
  assert.equal(shared.status, 200);
  assert.equal(shared.headers.get("x-sdlcai-scope"), "shared");
  const landing = await shared.text();
  assert.match(landing, /href="\/events\/2026\/admin\/"/);
  assert.match(landing, /href="\/events\/fixture-b\/admin\/"/);
  assert.match(landing, /href="\/admin\/newsletter\/"/);
  assert.doesNotMatch(landing, /Content inventory|SDLCAI \/ 2026/);
  for (const id of ["2026", "fixture-b"]) {
    const page = await get(`/events/${id}/admin/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, new RegExp(`data-event-id="${id}"`));
    assert.match(html, new RegExp(`href="/events/${id}/admin/attendees/"`));
    assert.match(html, /href="\/admin\/newsletter\/"/);
  }
  assert.equal((await get("/events/2027/admin/")).status, 404);
  const manifest = await get("/events/2026/assets/social/video/manifest.json");
  assert.equal(manifest.status, 200);
  assert.ok(parseVideoExportManifest(await manifest.json()).assets.length > 0);
  assert.equal(
    (await get("/events/fixture-b/admin/content-inventory/")).status,
    404,
  );
  assert.equal((await get("/events/fixture-b/api/admin/speakers")).status, 404);
  const denied = await worker.fetch(origin + endpoint("fixture-b"));
  assert.equal(denied.status, 401);
  const login = await worker.fetch(
    origin + "/events/fixture-b/admin/volunteers/",
    { redirect: "manual" },
  );
  assert.equal(login.status, 303);
  assert.equal(
    new URL(login.headers.get("location")).searchParams.get("next"),
    "/events/fixture-b/admin/volunteers/",
  );

  assert.equal((await mutate("2026", "Legacy volunteer")).status, 201);
  assert.deepEqual(
    (await (await get(endpoint("fixture-b"))).json()).volunteers,
    [],
  );
  assert.equal((await mutate("fixture-b", "Future volunteer")).status, 201);
  assert.deepEqual(
    (await (await get(endpoint("2026"))).json()).volunteers.map(
      (item) => item.name,
    ),
    ["Legacy volunteer"],
  );
  assert.deepEqual(
    (await (await get(endpoint("fixture-b"))).json()).volunteers.map(
      (item) => item.name,
    ),
    ["Future volunteer"],
  );
  // Compatibility URLs still point to 2026 regardless of the other open workspace.
  assert.deepEqual(
    (await (await get("/api/admin/volunteers")).json()).volunteers.map(
      (item) => item.name,
    ),
    ["Legacy volunteer"],
  );
  assert.equal(
    (await eventDb.prepare("SELECT count(*) AS n FROM organizers").first()).n,
    0,
  );
  assert.equal(
    (
      await eventDb
        .prepare("SELECT count(*) AS n FROM canonical_speaker_content")
        .first()
    ).n,
    0,
  );
  assert.equal(
    await eventDb
      .prepare(
        "SELECT name FROM sqlite_schema WHERE name = 'newsletter_subscribers'",
      )
      .first(),
    null,
  );
  for (const path of ["attendees", "attendees/catering", "badges"])
    assert.equal(
      (await get(`/events/fixture-b/api/admin/${path}`)).status,
      200,
      path,
    );

  const post = (path, action, body) =>
    get(path, {
      method: "POST",
      headers: {
        authorization,
        origin,
        "content-type": "application/json",
        "x-admin-action": action,
      },
      body: JSON.stringify(body),
    });
  const futureRoster = await (
    await get("/events/fixture-b/api/admin/attendees")
  ).json();
  const createdAttendee = await post(
    "/events/fixture-b/api/admin/attendees",
    "manage-attendees",
    {
      action: "create",
      revision: futureRoster.revision,
      attendee: {
        name: "Future attendee",
        email: "future-attendee@example.test",
        company: "Fixture",
        ticketCode: "",
        status: "active",
        badge: true,
        type: "attendee",
        diet: "",
      },
    },
  );
  assert.equal(createdAttendee.status, 200);
  const legacyExport = await (
    await get("/events/2026/api/admin/attendees")
  ).text();
  assert.doesNotMatch(legacyExport, /future-attendee@example.test/);
  const preview = await post(
    "/events/fixture-b/api/admin/attendee-messages/preview",
    "attendee-messages",
    {
      category: "operational",
      subject: "Event information",
      text_body: "Information for this event and its registered attendees.",
    },
  );
  assert.equal(preview.status, 200);
  const recipients = (await preview.json()).recipients.map(
    (person) => person.email,
  );
  assert.ok(recipients.includes("future-attendee@example.test"));
  assert.ok(!recipients.includes("2026@example.test"));
  assert.equal(
    (
      await env.INTERESTS.prepare(
        "SELECT COUNT(*) AS n FROM newsletter_subscribers",
      ).first()
    ).n,
    0,
    "registration creates no marketing consent",
  );
  const room = await post("/events/fixture-b/api/admin/qa", "", {
    action: "create-room",
    title: "Future questions",
  });
  assert.equal(room.status, 200);
  assert.match(
    (await eventDb.prepare("SELECT object_name FROM qa_rooms").first())
      .object_name,
    /^sdlcai-fixture-b:/,
  );
  assert.equal(
    await env.INTERESTS.prepare(
      "SELECT id FROM qa_rooms WHERE title = 'Future questions'",
    ).first(),
    null,
  );

  // A staff link issued for one event cannot be redeemed against the other DB.
  const grant = await get("/events/fixture-b/api/admin/attendees/access", {
    method: "POST",
    headers: {
      authorization,
      origin,
      "content-type": "application/json",
      "x-admin-action": "manage-attendees",
    },
    body: JSON.stringify({ action: "create", label: "Future desk" }),
  });
  assert.equal(grant.status, 200);
  const access = await grant.json();
  const link = access.grants[0].link;
  assert.match(link, /\/events\/fixture-b\/registration\/access\//);
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get("token");
  const redeem = (id) =>
    get(`/events/${id}/api/registration/session`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-admin-action": "manage-attendees",
      },
      body: JSON.stringify({ token }),
    });
  assert.equal((await redeem("2026")).status, 401);
  const session = await redeem("fixture-b");
  assert.equal(session.status, 200);
  assert.match(
    session.headers.get("set-cookie"),
    /sdlcai-registration-staff-fixture-b=/,
  );

  await env.INTERESTS.prepare(
    "INSERT INTO newsletter_subscribers (id,email_hash,status,consent_version,consent_text,requested_at) VALUES ('shared-one','shared-hash','unsubscribed','v1','Explicit shared consent','2026-10-01T00:00:00Z')",
  ).run();
  for (const id of ["2026", "fixture-b"]) {
    const news = await get(`/events/${id}/api/admin/newsletter`);
    assert.equal(news.status, 200);
    assert.match(await news.text(), /Explicit shared consent/);
  }
  assert.equal(
    (await fixture.scheduled({ cron: "0 3 * * *", scheduledTime: new Date() }))
      .outcome,
    "ok",
  );
  assert.ok(await env.INTEREST_BACKUPS.head("shared/newsletter/latest.json"));
  assert.ok(await env.INTEREST_BACKUPS.head("event-mailing/latest.json"));
  assert.ok(await env.FIXTURE_BACKUPS.head("event-mailing/latest.json"));
  assert.equal(
    await env.FIXTURE_BACKUPS.head("shared/newsletter/latest.json"),
    null,
  );
  const futureBackup = await (
    await env.FIXTURE_BACKUPS.get("event-mailing/latest.json")
  ).json();
  assert.doesNotMatch(
    await (await env.FIXTURE_BACKUPS.get(futureBackup.key)).text(),
    /newsletter_|shared-one/,
  );
  await eventDb
    .prepare("UPDATE event_dataset SET event_id = '2026' WHERE id = 1")
    .run();
  assert.equal(
    (await get(endpoint("fixture-b"))).status,
    503,
    "database aliases cannot bypass ownership checks",
  );
  assert.equal((await get(endpoint("2026"))).status, 200);
});
