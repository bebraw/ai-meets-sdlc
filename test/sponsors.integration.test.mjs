import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import {
  detectAttendeeMapping,
  importAttendeeCsv,
  prepareAttendeeCsv,
} from "../site/scripts/attendee-model.ts";
import { summarizeAttendeeDiets } from "../site/scripts/attendee-diets.ts";

test("separate Tito sponsor imports share catering and arrivals and generate live sponsor badges", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const send = (route, method = "GET", body) =>
    fixture.worker.fetch(`${origin}${route}`, {
      method,
      headers: {
        authorization: receiptAdmin,
        origin,
        "content-type": "application/json",
        "x-admin-action": "manage-attendees",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const endpoint = "/api/admin/attendees";
  const attendee = {
    name: "Regular attendee",
    email: "attendee@example.test",
    company: "",
    ticketCode: "AT-1",
    status: "active",
    badge: true,
    diet: "None",
  };
  assert.equal(
    (
      await send(endpoint, "POST", {
        source: "tito",
        revision: 0,
        attendees: [attendee],
      })
    ).status,
    200,
  );
  const csv = prepareAttendeeCsv(
    "Ticket Full Name,Ticket Email,Ticket Company Name,Ticket Reference,Void Status,What kind of food restrictions do you have?\nSponsor Zoë,sponsor@example.test,Sponsor Company,SP-1,,Vegan and gluten free",
  );
  const mapping = detectAttendeeMapping(csv.records[0].cells);
  const [sponsorInput] = importAttendeeCsv(csv.records, mapping, "sponsor");
  assert.equal(
    (
      await send(endpoint, "POST", {
        source: "tito",
        revision: 1,
        attendees: [sponsorInput],
      })
    ).status,
    200,
  );
  const getList = async () => (await send(endpoint)).json();
  const getBadges = async () => (await send("/api/admin/badges")).json();
  let roster = await getList();
  const sponsor = roster.attendees.find((p) => p.type === "sponsor");
  assert.equal(roster.attendees.length, 2);
  assert.equal(roster.attendees[0].type, "attendee");
  assert.equal(sponsor.diet, "Vegan and gluten free");
  const summary = summarizeAttendeeDiets(roster.attendees);
  assert.equal(summary.active, 2);
  assert.equal(summary.counts.find((p) => p.id === "vegan").count, 1);
  assert.equal(summary.counts.find((p) => p.id === "gluten-free").count, 1);
  assert.equal(
    (
      await send(`${endpoint}/access`, "POST", {
        action: "create",
        label: "Sponsor desk",
      })
    ).status,
    200,
  );
  const grant = (await (await send(`${endpoint}/access`)).json()).grants[0];
  const token = new URLSearchParams(new URL(grant.link).hash.slice(1)).get(
    "token",
  );
  const session = await send("/api/registration/session", "POST", { token });
  assert.equal(session.status, 200);
  const desk = await fixture.worker.fetch(
    `${origin}/api/registration/attendees`,
    {
      headers: { cookie: session.headers.get("set-cookie").split(";", 1)[0] },
    },
  );
  assert.equal(desk.status, 200);
  const deskSponsor = (await desk.json()).attendees.find(
    (p) => p.id === sponsor.id,
  );
  assert.equal(deskSponsor.type, "sponsor");
  assert.equal(Object.hasOwn(deskSponsor, "diet"), false);
  let studio = await getBadges();
  const badgeId = `attendees:${sponsor.id}`;
  assert.equal(studio.people.find((p) => p.id === badgeId).role, "sponsor");
  const signature = studio.signatures[badgeId];
  assert.doesNotMatch(
    JSON.stringify(await fixture.runSql("SELECT * FROM attendee_roster")),
    /Sponsor Zoë|sponsor@example|SP-1|Vegan/,
  );
  assert.equal(
    (
      await send("/api/registration/arrival", "POST", {
        id: sponsor.id,
        revision: 0,
        rosterRevision: roster.revision,
        action: "arrived",
      })
    ).status,
    200,
  );
  const { type, diet, ...refresh } = sponsorInput;
  assert.equal(
    (
      await send(endpoint, "POST", {
        source: "tito",
        revision: roster.revision,
        attendees: [refresh],
      })
    ).status,
    200,
  );
  roster = await getList();
  const refreshed = roster.attendees.find((p) => p.id === sponsor.id);
  assert.equal(refreshed.type, "sponsor");
  assert.equal(refreshed.diet, sponsor.diet);
  assert.ok(refreshed.arrivedAt);
  assert.equal((await getBadges()).signatures[badgeId], signature);
  assert.equal(
    (
      await send(endpoint, "PUT", {
        revision: roster.revision,
        id: sponsor.id,
        attendee: { ...sponsorInput, type: "attendee" },
      })
    ).status,
    200,
  );
  studio = await getBadges();
  assert.equal(studio.people.find((p) => p.id === badgeId).role, "attendee");
  assert.notEqual(studio.signatures[badgeId], signature);
  for (const details of [
    { ...sponsorInput, badge: false },
    { ...sponsorInput, status: "cancelled" },
  ]) {
    roster = await getList();
    assert.equal(
      (
        await send(endpoint, "PUT", {
          revision: roster.revision,
          id: sponsor.id,
          attendee: details,
        })
      ).status,
      200,
    );
    assert.ok(!(await getBadges()).people.some((p) => p.id === badgeId));
  }
});
