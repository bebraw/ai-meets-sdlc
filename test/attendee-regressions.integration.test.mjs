import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import { encryptText } from "../worker/form-utils.ts";
import { defaultSettings } from "../site/scripts/badge-model.ts";

function requests(worker) {
  return (
    path,
    method = "GET",
    body,
    credentials = { authorization: receiptAdmin },
  ) =>
    worker.fetch(`${origin}${path}`, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        "x-admin-action": path.includes("badges")
          ? "manage-badges"
          : "manage-attendees",
        ...credentials,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

test("stale ticket confirmations fail and identity corrections preserve IDs, arrivals and badge choices on re-import", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const send = requests(fixture.worker);
  const endpoint = "/api/admin/attendees";
  const input = {
    name: "Original holder",
    email: "coded@example.test",
    company: "",
    ticketCode: "OLD-CODE",
    status: "active",
    badge: true,
  };
  const emailOnly = {
    ...input,
    name: "Email holder",
    email: "old@example.test",
    ticketCode: "",
  };
  assert.equal(
    (
      await send(endpoint, "POST", {
        revision: 0,
        source: "tito",
        attendees: [input, emailOnly],
      })
    ).status,
    200,
  );
  await send(`${endpoint}/access`, "POST", {
    action: "create",
    label: "Regression desk",
  });
  const grant = (await (await send(`${endpoint}/access`)).json()).grants[0];
  const token = new URLSearchParams(new URL(grant.link).hash.slice(1)).get(
    "token",
  );
  const session = await send(
    "/api/registration/session",
    "POST",
    { token },
    {},
  );
  const staff = { cookie: session.headers.get("set-cookie").split(";", 1)[0] };
  const displayed = await (
    await send("/api/registration/attendees", "GET", undefined, staff)
  ).json();
  const person = displayed.attendees[0];
  const arrival = {
    id: person.id,
    revision: person.arrivalRevision,
    action: "arrived",
  };
  assert.equal(
    (await send("/api/registration/arrival", "POST", arrival, staff)).status,
    400,
    "Old clients cannot bypass the roster comparison",
  );
  const corrected = {
    ...input,
    name: "Replacement holder",
    ticketCode: "NEW-CODE",
    badge: false,
  };
  assert.equal(
    (
      await send(endpoint, "PUT", {
        revision: displayed.revision,
        id: person.id,
        attendee: corrected,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await send(
        "/api/registration/arrival",
        "POST",
        { ...arrival, rosterRevision: displayed.revision },
        staff,
      )
    ).status,
    409,
  );
  let list = await (await send(endpoint)).json();
  assert.equal(list.attendees[0].arrivedAt, null);
  assert.deepEqual(
    await fixture.runSql("SELECT * FROM attendee_arrival_events"),
    [],
  );
  assert.equal(
    (
      await send(
        "/api/registration/arrival",
        "POST",
        { ...arrival, rosterRevision: list.revision },
        staff,
      )
    ).status,
    200,
  );
  list = await (await send(endpoint)).json();
  const arrivedAt = list.attendees[0].arrivedAt;
  assert.equal(list.attendees[0].sourceKey, "ticket:new-code");
  assert.equal(
    (
      await send(endpoint, "POST", {
        revision: list.revision,
        source: "tito",
        attendees: [{ ...corrected, badge: true }],
      })
    ).status,
    200,
  );
  list = await (await send(endpoint)).json();
  assert.equal(list.attendees.length, 2);
  assert.equal(list.attendees[0].id, person.id);
  assert.equal(list.attendees[0].arrivedAt, arrivedAt);
  assert.equal(list.attendees[0].badge, false);
  const emailPerson = list.attendees[1];
  const newEmail = { ...emailOnly, email: "new@example.test" };
  assert.equal(
    (
      await send(endpoint, "PUT", {
        revision: list.revision,
        id: emailPerson.id,
        attendee: newEmail,
      })
    ).status,
    200,
  );
  list = await (await send(endpoint)).json();
  assert.equal(list.attendees[1].sourceKey, "email:new@example.test");
  assert.equal(
    (
      await send(endpoint, "POST", {
        revision: list.revision,
        source: "tito",
        attendees: [newEmail],
      })
    ).status,
    200,
  );
  list = await (await send(endpoint)).json();
  assert.equal(list.attendees.length, 2);
  assert.equal(list.attendees[1].id, emailPerson.id);
  assert.equal(
    (
      await send(endpoint, "PUT", {
        revision: list.revision,
        id: emailPerson.id,
        attendee: { ...newEmail, ticketCode: corrected.ticketCode },
      })
    ).status,
    400,
  );
  assert.equal((await (await send(endpoint)).json()).revision, list.revision);
});

test("the full attendee roster prints alongside earlier badges and team, and legacy retirement is private and reversible", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const send = requests(fixture.worker);
  const earlierPeople = Array.from({ length: 2000 }, (_, i) => ({
    id: `earlier-${i}`,
    name: `Earlier person ${i}`,
    company: "",
    email: "",
    role: "attendee",
    source: "Manual",
    included: true,
    duplicateReviewed: false,
  }));
  const encrypted = await encryptText(
    JSON.stringify({ people: earlierPeople, settings: defaultSettings }),
    "isolated-receipt-test-encryption",
  );
  // CLI seeding embeds literals, so keep each statement below D1's SQL limit.
  // Application writes bind the complete ciphertext as a parameter.
  await fixture.runSql(
    `UPDATE badge_workspace SET ciphertext = '', iv = '${encrypted.iv}' WHERE id = 1`,
  );
  for (let offset = 0; offset < encrypted.ciphertext.length; offset += 32000) {
    await fixture.runSql(
      `UPDATE badge_workspace SET ciphertext = ciphertext || '${encrypted.ciphertext.slice(offset, offset + 32000)}' WHERE id = 1`,
    );
  }
  const attendees = Array.from({ length: 2000 }, (_, i) => ({
    name: `Current person ${i}`,
    company: "",
    email: "",
    ticketCode: `CODE-${i}`,
    status: "active",
    badge: true,
  }));
  assert.equal(
    (
      await send("/api/admin/attendees", "POST", {
        revision: 0,
        source: "tito",
        attendees,
      })
    ).status,
    200,
  );
  let response = await send("/api/admin/badges");
  assert.equal(response.status, 200);
  let studio = await response.json();
  assert.equal(
    studio.people.filter((p) => p.source === "attendees").length,
    2000,
  );
  assert.equal(studio.legacyCount, 2000);
  assert.ok(studio.people.length > 4000);
  const sourcePeople = studio.people.filter((p) => p.source !== "Manual");
  const preferences = {
    settings: defaultSettings,
    retiredLegacyIds: earlierPeople.map((p) => p.id),
    overrides: sourcePeople.map((p) => ({
      id: p.id,
      signature: studio.signatures[p.id],
      name: `${p.name}\nProof`,
      company: p.company,
      duplicateReviewed: false,
    })),
  };
  assert.ok(preferences.overrides.length > 2000);
  assert.equal(
    (
      await send("/api/admin/badges", "PUT", {
        revision: studio.revision,
        preferences: { ...preferences, retiredLegacyIds: [sourcePeople[0].id] },
      })
    ).status,
    400,
    "Canonical inclusion cannot be changed by retirement",
  );
  assert.equal(
    (
      await send("/api/admin/badges", "PUT", {
        revision: studio.revision,
        preferences,
      })
    ).status,
    200,
  );
  studio = await (await send("/api/admin/badges")).json();
  assert.equal(studio.legacyCount, 0);
  assert.ok(studio.people.every((p) => p.source !== "Manual"));
  assert.equal(
    studio.legacyWorkspace.people.length,
    2000,
    "The original list remains exportable",
  );
  assert.deepEqual(
    studio.preferences.retiredLegacyIds,
    preferences.retiredLegacyIds,
  );
  assert.equal(
    (
      await send("/api/admin/badges", "PUT", {
        revision: studio.revision,
        preferences: { ...preferences, retiredLegacyIds: [] },
      })
    ).status,
    200,
  );
  studio = await (await send("/api/admin/badges")).json();
  assert.equal(studio.legacyCount, 2000);
  assert.equal(
    (await (await send("/api/admin/attendees")).json()).attendees.length,
    2000,
  );
});
