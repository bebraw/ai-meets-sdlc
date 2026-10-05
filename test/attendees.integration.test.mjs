import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("encrypted attendees support scoped staff links, concurrent arrivals, source refresh, cancellation, undo and revocation", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const send = (
    path,
    method = "GET",
    body,
    credentials = { authorization: receiptAdmin },
    extra = {},
  ) =>
    worker.fetch(`${origin}${path}`, {
      method,
      redirect: "manual",
      headers: {
        origin,
        "content-type": "application/json",
        "x-admin-action": "manage-attendees",
        ...credentials,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const rosterPath = "/api/admin/attendees",
    accessPath = `${rosterPath}/access`,
    arrivalsPath = "/api/registration/arrival";
  const input = {
    name: "Private Zoë",
    email: "private@example.test",
    company: "Private Company",
    ticketCode: "SECRET-123",
    status: "active",
    badge: true,
    diet: "Allergic to raw apple; vegan and gluten free",
  };
  assert.equal((await send(rosterPath, "GET", undefined, {})).status, 401);
  assert.equal(
    (await send("/api/registration/attendees", "GET", undefined, {})).status,
    401,
  );
  assert.equal(
    (await send("/registration/", "GET", undefined, {})).status,
    303,
  );
  for (const path of ["/admin/attendees/", "/registration/access/"]) {
    const page = await send(path);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
  assert.equal(
    (
      await send(
        rosterPath,
        "POST",
        { source: "tito", revision: 0, attendees: [input] },
        undefined,
        { origin: "https://elsewhere.test" },
      )
    ).status,
    403,
  );
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      send(rosterPath, "POST", {
        source: "tito",
        revision: 0,
        attendees: [input],
      }),
    ),
  );
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  const getList = async () => (await send(rosterPath)).json();
  let list = await getList();
  const person = list.attendees[0];
  assert.equal(person.arrivalRevision, 0);
  assert.equal(person.diet, input.diet);
  const overlongDiet = await send(rosterPath, "POST", {
    source: "tito",
    revision: list.revision,
    attendees: [{ ...input, diet: "x".repeat(2001) }],
  });
  assert.equal(overlongDiet.status, 400);
  assert.equal((await getList()).revision, list.revision);
  const badImport = await send(rosterPath, "POST", {
    source: "tito",
    revision: list.revision,
    attendees: [input, input],
  });
  assert.equal(badImport.status, 400);
  assert.equal((await getList()).revision, list.revision);
  await send(accessPath, "POST", { action: "create", label: "Front desk" });
  const grant = (await (await send(accessPath)).json()).grants[0];
  const token = new URLSearchParams(new URL(grant.link).hash.slice(1)).get(
    "token",
  );
  assert.equal(token.length, 43);
  assert.equal(new URL(grant.link).search, "");
  const raw = await runSql(
    "SELECT * FROM attendee_roster; SELECT * FROM registration_access_grants",
  );
  assert.doesNotMatch(
    JSON.stringify(raw),
    /Private Zoë|private@example|SECRET-123|Private Company|Allergic to raw apple/,
  );
  assert.doesNotMatch(
    JSON.stringify(await runSql("SELECT * FROM registration_access_grants")),
    new RegExp(token),
  );
  const redeem = () => send("/api/registration/session", "POST", { token }, {});
  const sessions = await Promise.all([redeem(), redeem()]);
  for (const response of sessions) assert.equal(response.status, 200);
  const credentials = sessions.map((response) => ({
    cookie: response.headers.get("set-cookie").split(";", 1)[0],
  }));
  assert.match(
    sessions[0].headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict; Max-Age=1209600/,
  );
  assert.equal(
    (
      await send(
        "/api/registration/attendees",
        "GET",
        undefined,
        credentials[0],
      )
    ).status,
    200,
  );
  assert.equal(
    (await send(rosterPath, "GET", undefined, credentials[0])).status,
    401,
  );
  const deskList = await (
    await send("/api/registration/attendees", "GET", undefined, credentials[0])
  ).json();
  assert.equal(Object.hasOwn(deskList.attendees[0], "diet"), false);
  assert.doesNotMatch(JSON.stringify(deskList), /Allergic to raw apple/);
  assert.equal(
    (
      await send(
        accessPath,
        "POST",
        { action: "create", label: "Escalate" },
        credentials[0],
      )
    ).status,
    401,
  );
  assert.equal(
    (await send("/api/admin/qa", "GET", undefined, credentials[0])).status,
    401,
  );
  assert.equal(
    (
      await send(
        "/api/registration/attendees",
        "PUT",
        { attendee: input },
        credentials[0],
      )
    ).status,
    405,
  );
  const arrival = {
    id: person.id,
    revision: 0,
    rosterRevision: list.revision,
    action: "arrived",
  };
  assert.equal(
    (
      await send(arrivalsPath, "POST", arrival, credentials[0], {
        "x-admin-action": "wrong",
      })
    ).status,
    403,
  );
  const arrivals = await Promise.all(
    credentials.map((staff) => send(arrivalsPath, "POST", arrival, staff)),
  );
  assert.deepEqual(arrivals.map((r) => r.status).sort(), [200, 409]);
  list = await getList();
  arrival.rosterRevision = list.revision;
  assert.ok(list.attendees[0].arrivedAt);
  assert.equal(list.attendees[0].arrivedBy, "Front desk");
  const arrivedAt = list.attendees[0].arrivedAt;
  assert.equal(
    (
      await send(
        arrivalsPath,
        "POST",
        { ...arrival, revision: 1, action: "undo" },
        credentials[0],
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await send(rosterPath, "POST", {
        revision: list.revision,
        source: "tito",
        attendees: [{ ...input, name: "Corrected name", status: "cancelled" }],
      })
    ).status,
    200,
  );
  list = await getList();
  arrival.rosterRevision = list.revision;
  assert.equal(list.attendees[0].id, person.id);
  assert.equal(list.attendees[0].arrivedAt, arrivedAt);
  assert.equal(list.attendees[0].name, "Corrected name");
  assert.equal(list.attendees[0].diet, input.diet);
  assert.equal(
    (
      await send(arrivalsPath, "POST", {
        ...arrival,
        revision: 1,
        action: "undo",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await send(
        arrivalsPath,
        "POST",
        { ...arrival, revision: 2 },
        credentials[0],
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await send(rosterPath, "PUT", {
        revision: list.revision,
        id: person.id,
        attendee: (({ diet, ...legacy }) => legacy)(input),
      })
    ).status,
    200,
  );
  assert.equal(
    (await getList()).attendees[0].diet,
    input.diet,
    "Editing from an older client must preserve dietary responses",
  );
  assert.equal(
    (
      await send(rosterPath, "PUT", {
        revision: list.revision,
        id: person.id,
        attendee: input,
      })
    ).status,
    409,
  );
  arrival.rosterRevision = (await getList()).revision;
  assert.equal(
    (
      await send(
        arrivalsPath,
        "POST",
        { ...arrival, revision: 2 },
        credentials[0],
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await send(
        arrivalsPath,
        "POST",
        { ...arrival, revision: 2 },
        credentials[1],
      )
    ).status,
    409,
  );
  const history = await runSql(
    "SELECT * FROM attendee_arrival_events ORDER BY event_id",
  );
  assert.deepEqual(
    history.map((event) => event.action),
    ["arrived", "undo", "arrived"],
  );
  assert.doesNotMatch(
    JSON.stringify(history),
    /private@example|SECRET-123|Corrected name/,
  );
  assert.equal(
    (
      await send(
        "/api/registration/session",
        "DELETE",
        undefined,
        credentials[0],
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await send(
        "/api/registration/attendees",
        "GET",
        undefined,
        credentials[0],
      )
    ).status,
    401,
  );
  assert.equal(
    (await redeem()).status,
    200,
    "A staff link remains reusable after sign-out",
  );
  assert.equal(
    (await send(accessPath, "POST", { action: "revoke", id: grant.id })).status,
    200,
  );
  assert.equal((await redeem()).status, 401);
  assert.equal(
    (
      await send(
        "/api/registration/attendees",
        "GET",
        undefined,
        credentials[1],
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await send(
        arrivalsPath,
        "POST",
        { ...arrival, revision: 3 },
        credentials[1],
      )
    ).status,
    401,
  );
  assert.equal(
    (await runSql("SELECT * FROM registration_staff_sessions")).length,
    0,
  );
});
