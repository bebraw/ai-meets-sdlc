import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import { buildCateringRoster } from "../site/scripts/attendee-catering-model.ts";

test("manual attendees support protected creation, provider isolation, check-in, editing, catering mappings and badges", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const path = "/api/admin/attendees";
  const send = (url, method = "GET", body, headers = {}) =>
    worker.fetch(origin + url, {
      method,
      headers: {
        authorization: receiptAdmin,
        origin,
        "content-type": "application/json",
        "x-admin-action": "manage-attendees",
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const read = async () => (await send(path)).json();
  const input = {
    name: "Manual Zoë",
    email: "manual@example.test",
    company: "Manual Company",
    ticketCode: "",
    status: "active",
    badge: true,
    type: "sponsor",
    diet: "Private nut allergy",
    id: "client-supplied-id",
    source: "tito",
  };
  const create = { action: "create", revision: 0, attendee: input };
  for (const headers of [
    { origin: "https://elsewhere.test" },
    { "x-admin-action": "wrong" },
  ])
    assert.equal((await send(path, "POST", create, headers)).status, 403);
  assert.equal(
    (await send(path, "POST", create, { authorization: "" })).status,
    401,
  );
  assert.equal(
    (await send(path, "POST", { ...create, attendee: { ...input, email: "" } }))
      .status,
    400,
  );
  const concurrent = await Promise.all([
    send(path, "POST", create),
    send(path, "POST", create),
  ]);
  assert.deepEqual(
    concurrent.map((response) => response.status).sort(),
    [200, 409],
  );
  let list = await read();
  const person = list.attendees[0];
  assert.equal(list.attendees.length, 1);
  assert.equal(person.source, "manual");
  assert.notEqual(person.id, input.id);
  assert.equal(person.type, "sponsor");
  assert.equal(person.diet, input.diet);
  const duplicate = await send(path, "POST", {
    ...create,
    revision: list.revision,
  });
  assert.equal(duplicate.status, 400);
  assert.match((await duplicate.json()).error, /already exists/);
  assert.equal((await read()).revision, list.revision);
  assert.doesNotMatch(
    JSON.stringify(await runSql("SELECT * FROM attendee_roster")),
    /Manual Zoë|manual@example|Manual Company|Private nut allergy/,
  );
  const access = await (
    await send(path + "/access", "POST", {
      action: "create",
      label: "Manual desk",
    })
  ).json();
  const token = new URLSearchParams(
    new URL(access.grants[0].link).hash.slice(1),
  ).get("token");
  const session = await send(
    "/api/registration/session",
    "POST",
    { token },
    { authorization: "" },
  );
  assert.equal(session.status, 200);
  const staffHeaders = {
    authorization: "",
    cookie: session.headers.get("set-cookie").split(";", 1)[0],
  };
  assert.equal((await send(path, "POST", create, staffHeaders)).status, 401);
  assert.equal(
    (await send("/api/registration/attendees", "POST", create, staffHeaders))
      .status,
    405,
  );
  const desk = await (
    await send("/api/registration/attendees", "GET", undefined, staffHeaders)
  ).json();
  assert.equal(desk.attendees[0].source, "manual");
  assert.equal(Object.hasOwn(desk.attendees[0], "diet"), false);
  assert.equal(
    (
      await send(
        "/api/registration/arrival",
        "POST",
        {
          id: person.id,
          revision: 0,
          rosterRevision: list.revision,
          action: "arrived",
        },
        staffHeaders,
      )
    ).status,
    200,
  );
  list = await read();
  const arrivedAt = list.attendees[0].arrivedAt;
  assert.ok(arrivedAt);
  const corrected = {
    ...input,
    name: "Corrected Manual Zoë",
    ticketCode: "MANUAL-1",
  };
  assert.equal(
    (
      await send(path, "PUT", {
        id: person.id,
        revision: list.revision,
        attendee: corrected,
      })
    ).status,
    200,
  );
  list = await read();
  assert.equal(list.attendees[0].id, person.id);
  assert.equal(list.attendees[0].arrivedAt, arrivedAt);
  assert.equal(list.attendees[0].sourceKey, "ticket:manual-1");
  const imported = { ...corrected, name: "Provider Guest", diet: "Vegan" };
  assert.equal(
    (
      await send(path, "POST", {
        source: "tito",
        revision: list.revision,
        attendees: [imported],
      })
    ).status,
    200,
  );
  list = await read();
  assert.equal(list.attendees.length, 2);
  const manual = list.attendees.find((p) => p.id === person.id);
  assert.equal(manual.name, corrected.name);
  assert.equal(manual.diet, input.diet);
  assert.equal(manual.arrivedAt, arrivedAt);
  const catering = await (await send(path + "/catering")).json();
  assert.ok(
    buildCateringRoster(list.attendees, catering).people.some(
      (p) => p.id === "attendee:" + person.id && p.diet === input.diet,
    ),
  );
  const badges = await (await send("/api/admin/badges")).json();
  assert.ok(
    badges.people.some(
      (p) => p.id === "attendees:" + person.id && p.role === "sponsor",
    ),
  );
  assert.equal(
    (
      await send(path, "PUT", {
        id: person.id,
        revision: list.revision,
        attendee: { ...corrected, badge: false },
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await send("/api/admin/badges")).json()).people.some(
      (p) => p.id === "attendees:" + person.id,
    ),
    false,
  );
  list = await read();
  const volunteerResponse = await worker.fetch(
    origin + "/api/admin/volunteers",
    {
      method: "POST",
      headers: {
        authorization: receiptAdmin,
        origin,
        "x-admin-action": "manage-volunteers",
      },
      body: new URLSearchParams({
        name: "Volunteer Alias",
        email: "alias@example.test",
        task: "Registration",
        badge: "false",
      }),
    },
  );
  assert.equal(volunteerResponse.status, 201);
  const volunteer = (await volunteerResponse.json()).volunteer;
  const mappingData = await (await send(path + "/catering")).json();
  assert.equal(
    (
      await send(
        path + "/catering",
        "PUT",
        {
          revision: mappingData.revision,
          version: mappingData.version,
          mappings: [
            {
              sourceId: "volunteer:" + volunteer.id,
              target: "attendee:" + person.id,
            },
          ],
        },
        { "x-admin-action": "manage-attendee-catering" },
      )
    ).status,
    200,
  );
  const mapped = await read();
  assert.equal(mapped.attendees.length, 2);
  assert.equal(
    mapped.attendees.find((p) => p.id === person.id).type,
    "organizer",
  );
  assert.equal(
    mapped.attendees.find((p) => p.id === person.id).arrivedAt,
    arrivedAt,
  );
});
