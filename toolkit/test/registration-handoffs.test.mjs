import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createToolkit } from "../dist/index.mjs";
import { startWeb } from "../dist/http.mjs";
import {
  importRegistrations,
  registrationExample,
} from "../dist/blocks/registration-csv.mjs";

const partialCsv = "Ticket Full Name,Ticket Reference\nAlex Kane,FN-2";

test("partial exports preserve stored data and explicit corrections take effect", () => {
  const initial = importRegistrations(registrationExample);
  const merged = importRegistrations({
    source: "tito",
    csv: partialCsv,
    previous: initial.records,
  });
  const retained = merged.records.find((p) => p.ticketCode === "FN-2");
  assert.equal(retained.status, "cancelled");
  assert.equal(retained.email, "alex@example.test");
  assert.equal(retained.company, "Diagram Lab");
  const cleared = importRegistrations({
    source: "tito",
    csv: "Ticket Full Name,Ticket Reference,Company,Email,Status\nAlex Kane,FN-2,,,paid",
    previous: merged.records,
  });
  const amended = cleared.records.find((p) => p.ticketCode === "FN-2");
  assert.equal(amended.status, "active");
  assert.equal(amended.email, "");
  assert.equal(amended.company, "");
});

test("imported tickets open reviewed badge, desk and catering actions", async (t) => {
  const kit = createToolkit({
    enabled: ["registration-import", "badges", "check-in", "catering"],
  });
  const principal = {
    actor: "test-host",
    role: "organizer",
    token: "test-organizer",
  };
  const host = await startWeb({
    toolkit: kit,
    port: 0,
    principals: [principal],
    eventLabel: "Forum",
  });
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close();
    await host.close();
    await kit.close();
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  let origin = host.origin;
  const field = (key) => page.locator('[data-path="' + key + '"]');
  const click = (name) =>
    page.getByRole("button", { name, exact: true }).click();
  async function run(operation, status = 200) {
    const pending = page.waitForResponse(
      (r) => r.url() === origin + "/api/run/" + operation,
    );
    await page.locator("#run").click();
    const response = await pending,
      body = await response.json();
    assert.equal(response.status(), status, JSON.stringify(body));
    return body.data;
  }
  async function importSample(csv = registrationExample.csv) {
    await page.goto(origin + "/#operation=registration_import_csv");
    await field("csv").waitFor();
    await click("Use example");
    await field("csv").fill(csv);
    return run("registration_import_csv");
  }

  const login = () =>
    page.request.post(origin + "/api/session", {
      headers: { origin },
      data: { token: principal.token },
    });
  await login();
  await importSample();
  await click("Prepare badges (1)");
  assert.equal(await field("people.0.name").inputValue(), "Zoë Marin");
  assert.equal(await field("people.0.role").inputValue(), "attendee");
  assert.equal(await field("people.1.name").count(), 0);
  assert.equal((await run("badges_export_pdf")).badges, 1);

  await importSample(
    registrationExample.csv.replace("Vegan", "Avoid raw apples"),
  );
  await click("Prepare catering brief (2 meals)");
  assert.equal(await field("eventName").inputValue(), "Forum");
  assert.equal(await field("people.0.diet").inputValue(), "Avoid raw apples");
  assert.equal(await field("people.1.diet").inputValue(), "");
  assert.equal(await field("people.0.name").count(), 0);
  const brief = await run("catering_prepare_brief");
  assert.equal(brief.active, 2);
  assert.equal(brief.missing, 1);
  assert.equal(brief.needsReview, 1);
  assert.equal(brief.noRestrictions, 0);
  assert.deepEqual(
    brief.groups.flatMap((group) => group.responses),
    [{ text: "Avoid raw apples", count: 1 }],
  );

  const initial = await importSample();
  await click("Open check-in roster (3 tickets, 2 active)");
  assert.equal(await field("rosterRevision").inputValue(), "0");
  assert.equal((await kit.run("checkin_roster", {})).people.length, 0);
  await kit.run("checkin_register", {
    rosterRevision: 0,
    people: [{ id: "other", name: "Additional guest" }],
  });
  await run("checkin_register", 409);
  await click("Refresh roster version for review");
  assert.equal(await field("rosterRevision").inputValue(), "1");
  assert.equal(await field("people.2.id").inputValue(), initial.records[2].id);
  assert.equal((await kit.run("checkin_roster", {})).people.length, 1);
  assert.equal((await run("checkin_register")).submitted, 3);

  const claim = initial.records[2].id;
  await kit.run("checkin_arrive", {
    id: claim,
    revision: 1,
    assignName: "Noa Hall",
  });
  const assigned = await kit.run("checkin_roster", {});
  const guest = assigned.people.find((p) => p.id === claim);
  await kit.run("checkin_register", {
    rosterRevision: assigned.rosterRevision,
    people: [
      {
        ...guest,
        email: "noa@example.test",
        company: "Desk Co",
        type: "volunteer",
      },
    ],
  });
  const current = await kit.run("checkin_roster", {});
  const repeated = await importSample(
    registrationExample.csv.replace("Zoë Marin", "Zoë Vale"),
  );
  assert.notEqual(initial.records[2].id, repeated.records[2].id);
  await click("Open check-in roster (3 tickets, 2 active)");
  assert.equal(
    await field("rosterRevision").inputValue(),
    String(current.rosterRevision),
  );
  await run("checkin_register");
  const roster = await kit.run("checkin_roster", {});
  assert.equal(roster.people.length, 4);
  assert.equal(
    roster.people.find((p) => p.id === initial.records[0].id).name,
    "Zoë Vale",
  );
  assert.equal(
    roster.people.find((p) => p.id === initial.records[1].id).status,
    "cancelled",
  );
  const arrival = roster.people.find((p) => p.id === claim);
  assert.equal(arrival.name, "Noa Hall");
  assert.equal(arrival.email, "noa@example.test");
  assert.equal(arrival.company, "Desk Co");
  assert.equal(arrival.type, "volunteer");
  assert.ok(arrival.arrivedAt);

  await importSample(partialCsv);
  await click("Open check-in roster (1 ticket)");
  await run("checkin_register");
  const alex = (await kit.run("checkin_roster", {})).people.find(
    (p) => p.ticketCode === "FN-2",
  );
  assert.equal(alex.name, "Alex Kane");
  assert.equal(alex.company, "Diagram Lab");
  assert.equal(alex.email, "alex@example.test");
  assert.equal(alex.status, "cancelled");

  // A desk role may be longer than badge lettering allows. Its badge
  // validation must not block either of the independent destinations.
  await importSample();
  await page.locator("#advanced summary").click();
  await page.locator("#input-json").fill(
    JSON.stringify({
      ...registrationExample,
      previous: initial.records.map((r) => ({
        ...r,
        type: "Volunteer supporting the technical programme",
      })),
    }),
  );
  await click("Apply JSON");
  await run("registration_import_csv");
  await page
    .getByText(/Prepare badges — Check the type on registration/)
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: /^Prepare badges/ }).count(),
    0,
  );
  await page
    .getByRole("button", { name: "Open check-in roster (3 tickets, 2 active)" })
    .waitFor();
  await page
    .getByRole("button", { name: "Prepare catering brief (2 meals)" })
    .waitFor();

  const limitedKit = createToolkit({
    enabled: ["registration-import", "catering"],
  });
  const limited = await startWeb({
    toolkit: limitedKit,
    port: 0,
    principals: [principal],
  });
  t.after(async () => {
    await limited.close();
    await limitedKit.close();
  });
  origin = limited.origin;
  await login();
  await importSample();
  await page
    .getByRole("button", { name: "Prepare catering brief (2 meals)" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Prepare badges|Open check-in roster/ })
      .count(),
    0,
  );
  // Replacing the export recalculates all destination counts.
  await field("csv").fill(registrationExample.csv.replace("refunded", "paid"));
  assert.equal(
    await page.getByRole("button", { name: /Prepare catering brief/ }).count(),
    0,
  );
  await run("registration_import_csv");
  await page
    .getByRole("button", { name: "Prepare catering brief (3 meals)" })
    .waitFor();

  // A saved link to a disabled tool must not keep the prior import runnable.
  await page.goto(origin + "/#operation=checkin_register");
  await page
    .getByText("Sign in with access to the requested action.")
    .waitFor();
  assert.equal(await page.locator("#tool").isVisible(), false);
  assert.equal(await page.locator("#run").isDisabled(), true);
  assert.equal(await field("csv").count(), 0);
  assert.equal(await page.locator("#input-json").inputValue(), "");
  await importSample();
});
