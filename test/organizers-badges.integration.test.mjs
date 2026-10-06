import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import { encryptText } from "../worker/form-utils.ts";
import { applyPrintPreferences } from "../site/scripts/badge-studio-model.ts";
import { defaultSettings } from "../site/scripts/badge-model.ts";
test("organizers seed the homepage while badge selection stays private; badges load current records and encrypt print preferences with stale-write protection", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const send = (route, method = "GET", body, extra = {}) =>
    worker.fetch(`${origin}/api/admin/${route}`, {
      method,
      headers: {
        authorization: receiptAdmin,
        origin,
        "content-type": "application/json",
        "x-admin-action": `manage-${route}`,
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  for (const route of ["organizers", "badges"]) {
    assert.equal(
      (await worker.fetch(`${origin}/api/admin/${route}`)).status,
      401,
    );
    const page = await worker.fetch(`${origin}/admin/${route}/`, {
      headers: { authorization: receiptAdmin },
    });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
  let response = await send("organizers");
  const people = (await response.json()).organizers;
  assert.equal(people.length, 9);
  assert.ok(people.every((p) => !p.badge && p.visible));
  const person = people[0];
  const update = {
    ...person,
    name: "Badge <test> person",
    visible: true,
    badge: true,
  };
  assert.equal(
    (
      await send("organizers", "PUT", update, {
        origin: "https://elsewhere.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send("organizers", "PUT", {
        ...update,
        photo: "javascript:alert(1)",
      })
    ).status,
    400,
  );
  response = await send("organizers", "PUT", update);
  assert.equal(response.status, 200);
  assert.equal((await send("organizers", "PUT", update)).status, 409);
  const homepage = await worker.fetch(`${origin}/`);
  const html = await homepage.text();
  assert.match(html, /Badge &lt;test&gt; person/);
  assert.doesNotMatch(html, /Badge <test>/);
  assert.equal(homepage.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await send("organizers", "PUT", {
        ...update,
        revision: 2,
        visible: false,
      })
    ).status,
    200,
  );
  assert.doesNotMatch(
    await (await worker.fetch(`${origin}/`)).text(),
    /Badge &lt;test&gt; person/,
  );
  const badge = {
    id: "test-id",
    name: "Private attendee",
    company: "Example",
    email: "private@example.test",
    role: "attendee",
    source: "tito.csv / row 2",
    included: true,
    duplicateReviewed: false,
  };
  const volunteerResponse = await worker.fetch(
    `${origin}/api/admin/volunteers`,
    {
      method: "POST",
      headers: {
        authorization: receiptAdmin,
        origin,
        "x-admin-action": "manage-volunteers",
      },
      body: new URLSearchParams({
        name: "Earlier volunteer",
        email: "volunteer@example.test",
        task: "Welcome",
      }),
    },
  );
  assert.equal(volunteerResponse.status, 201);
  const { volunteer } = await volunteerResponse.json();
  const earlierPeople = [
    badge,
    {
      ...badge,
      id: `volunteers:${volunteer.id}`,
      name: volunteer.name,
      email: volunteer.email,
      role: "organizer",
      source: "volunteers",
      included: false,
    },
  ];
  // An earlier CSV badge remains available without remaining an editable roster.
  const encrypted = await encryptText(
    JSON.stringify({ people: earlierPeople, settings: defaultSettings }),
    "isolated-receipt-test-encryption",
  );
  await runSql(
    `UPDATE badge_workspace SET ciphertext = '${encrypted.ciphertext}', iv = '${encrypted.iv}' WHERE id = 1`,
  );
  let studio = await (await send("badges")).json();
  assert.equal(studio.legacyCount, 1);
  assert.deepEqual(studio.legacyWorkspace.people, earlierPeople);
  assert.ok(studio.people.some((p) => p.id === `organizers:${person.id}`));
  assert.ok(studio.people.some((p) => p.role === "speaker"));
  assert.ok(
    !studio.people.some((p) => p.id === "speakers:workspace-test-speaker"),
  );
  const payload = {
    revision: 0,
    preferences: {
      settings: defaultSettings,
      retiredLegacyIds: [],
      overrides: [
        {
          id: badge.id,
          signature: studio.signatures[badge.id],
          name: "Private\nattendee",
          company: "Example",
          duplicateReviewed: false,
        },
      ],
    },
  };
  assert.equal(
    (await send("badges", "PUT", payload, { "x-admin-action": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (
      await send("badges", "PUT", {
        ...payload,
        preferences: {
          settings: { ...defaultSettings, diameter: 999 },
          overrides: [],
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await send("badges", "PUT", {
        revision: 0,
        workspace: { people: [badge], settings: defaultSettings },
      })
    ).status,
    400,
    "Roster writes no longer belong to the badge API",
  );
  const writes = await Promise.all([
    send("badges", "PUT", payload),
    send("badges", "PUT", payload),
  ]);
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
  studio = await (await send("badges")).json();
  assert.deepEqual(studio.preferences, payload.preferences);
  assert.equal(studio.revision, 1);
  assert.deepEqual(studio.legacyWorkspace.people, earlierPeople);
  assert.doesNotMatch(
    JSON.stringify(await runSql("SELECT * FROM badge_workspace")),
    /Private|private@example|tito.csv/,
  );
  assert.equal(
    studio.people.some((p) => p.id === `volunteers:${volunteer.id}`),
    false,
  );
  const volunteerListing = await worker.fetch(
    `${origin}/api/admin/volunteers`,
    { headers: { authorization: receiptAdmin } },
  );
  assert.equal(
    (await volunteerListing.json()).volunteers[0].badge,
    false,
    "The volunteer editor shows earlier badge exclusion choices",
  );
  const volunteerEdit = await worker.fetch(
    `${origin}/api/admin/volunteers/${volunteer.id}`,
    {
      method: "PUT",
      headers: {
        authorization: receiptAdmin,
        origin,
        "x-admin-action": "manage-volunteers",
      },
      body: new URLSearchParams({
        name: volunteer.name,
        email: volunteer.email,
        task: volunteer.task,
        revision: "1",
        badge: "true",
      }),
    },
  );
  assert.equal(volunteerEdit.status, 200);
  studio = await (await send("badges")).json();
  assert.ok(
    studio.people.some((p) => p.id === `volunteers:${volunteer.id}`),
    "An explicit volunteer choice replaces the earlier exclusion",
  );
  const attendee = {
    name: "Current registration",
    company: "Example",
    email: badge.email,
    ticketCode: "TEST-1",
    status: "active",
    badge: true,
  };
  assert.equal(
    (
      await send("attendees", "POST", {
        revision: (await (await send("attendees")).json()).revision,
        source: "tito",
        attendees: [attendee],
      })
    ).status,
    200,
  );
  studio = await (await send("badges")).json();
  assert.equal(
    studio.legacyCount,
    0,
    "An imported registration replaces its older CSV badge copy",
  );
  const registered = studio.people.find((p) => p.source === "attendees");
  assert.equal(registered.name, attendee.name);
  const preferences = {
    settings: defaultSettings,
    overrides: [
      {
        id: registered.id,
        signature: studio.signatures[registered.id],
        name: "Print name",
        company: "Print company",
        duplicateReviewed: true,
      },
    ],
  };
  assert.equal(
    (await send("badges", "PUT", { revision: 1, preferences })).status,
    200,
  );
  const roster = await (await send("attendees")).json();
  assert.equal(
    roster.attendees[0].name,
    attendee.name,
    "Badge text cannot alter registration records",
  );
  assert.equal(
    (
      await send("attendees", "PUT", {
        revision: roster.revision,
        id: roster.attendees[0].id,
        attendee: { ...attendee, name: "Corrected registration" },
      })
    ).status,
    200,
  );
  studio = await (await send("badges")).json();
  assert.equal(
    applyPrintPreferences(
      studio.people,
      studio.preferences,
      studio.signatures,
    ).find((p) => p.id === registered.id).name,
    "Corrected registration",
    "A source change invalidates stale print text and duplicate review",
  );
  assert.equal(
    (await send("badges", "PUT", { revision: 2, preferences })).status,
    409,
  );
  const updatedRoster = await (await send("attendees")).json();
  assert.equal(
    (
      await send("attendees", "PUT", {
        revision: updatedRoster.revision,
        id: roster.attendees[0].id,
        attendee: { ...attendee, status: "cancelled" },
      })
    ).status,
    200,
  );
  studio = await (await send("badges")).json();
  assert.ok(!studio.people.some((p) => p.source === "attendees"));
  assert.equal(
    studio.legacyCount,
    0,
    "Cancelling a current ticket cannot resurrect its old badge copy",
  );
  assert.equal(
    (await send("organizers", "DELETE", { id: person.id, revision: 2 })).status,
    409,
  );
  assert.equal(
    (await send("organizers", "DELETE", { id: person.id, revision: 3 })).status,
    200,
  );
  assert.equal((await send("organizers")).status, 200);
});
