import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import {
  attendeeOrderCode,
  detectAttendeeMapping,
  importAttendeeCsv,
  prepareAttendeeCsv,
} from "../site/scripts/attendee-model.ts";

test("unassigned Tito tickets support scoped atomic desk assignment, per-ticket arrivals and safe reimports", async (t) => {
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
  const csv = prepareAttendeeCsv(
    [
      "Registration Name,Registration Email,Registration Reference,Ticket Full Name,Ticket Email,Ticket Reference,Void Status",
      ...["ORDER-1", "ORDER-2", "ORDER-3", "ORDER-4", "ALT-1", "ALT-2"].map(
        (code) =>
          `Purchaser,purchaser@example.test,${code.split("-")[0]},,,${code},`,
      ),
      "Purchaser,purchaser@example.test,ORDER,Known Holder,holder@example.test,ORDER-5,",
      "Purchaser,purchaser@example.test,ALT,,,ALT-3,true",
    ].join("\n"),
  );
  const rows = importAttendeeCsv(
    csv.records,
    detectAttendeeMapping(csv.records[0].cells),
    "sponsor",
    "tito",
  );
  assert.equal(
    rows.filter((p) => p.unassigned && p.status === "active").length,
    6,
  );
  assert.equal(
    (await send(path, "POST", { source: "tito", revision: 0, attendees: rows }))
      .status,
    200,
  );
  let list = await read();
  assert.equal(list.attendees.length, 8);
  assert.equal(
    list.attendees.filter((p) => attendeeOrderCode(p) === "ORDER").length,
    5,
  );
  assert.ok(
    list.attendees
      .filter((p) => p.unassigned)
      .every((p) => !p.name && !p.email && !p.badge),
  );
  assert.equal(
    (await (await send("/api/admin/badges")).json()).people.filter((p) =>
      p.id.startsWith("attendees:"),
    ).length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(await runSql("SELECT * FROM attendee_roster")),
    /Purchaser|holder@example|ORDER-/,
  );

  const grants = await (
    await send(path + "/access", "POST", {
      action: "create",
      label: "Assignment desk",
    })
  ).json();
  const token = new URLSearchParams(
    new URL(grants.grants[0].link).hash.slice(1),
  ).get("token");
  const session = await send(
    "/api/registration/session",
    "POST",
    { token },
    { authorization: "" },
  );
  const staff = {
    authorization: "",
    cookie: session.headers.get("set-cookie").split(";", 1)[0],
  };
  const assignPath = "/api/registration/assign";
  const person = list.attendees.find((p) => p.ticketCode === "ORDER-1");
  const payload = {
    id: person.id,
    name: "Desk Zoë",
    revision: 0,
    rosterRevision: list.revision,
  };
  assert.equal((await send(assignPath, "GET", undefined, staff)).status, 405);
  assert.equal(
    (await send(assignPath, "POST", payload, { authorization: "" })).status,
    401,
  );
  assert.equal(
    (
      await send(assignPath, "POST", payload, {
        ...staff,
        origin: "https://elsewhere.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (await send(assignPath, "POST", { ...payload, name: " " }, staff)).status,
    400,
  );
  for (const ticketCode of ["ORDER-5", "ALT-3"])
    assert.equal(
      (
        await send(
          assignPath,
          "POST",
          {
            ...payload,
            id: list.attendees.find((p) => p.ticketCode === ticketCode).id,
          },
          staff,
        )
      ).status,
      409,
    );
  assert.equal(
    (
      await send(
        "/api/registration/arrival",
        "POST",
        { ...payload, action: "arrived" },
        staff,
      )
    ).status,
    409,
  );
  assert.equal(
    (await send(assignPath, "POST", { ...payload, rosterRevision: 0 }, staff))
      .status,
    409,
  );
  const concurrent = await Promise.all([
    send(assignPath, "POST", payload, staff),
    send(assignPath, "POST", { ...payload, name: "Other Holder" }, staff),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  list = await read();
  const claimed = list.attendees.find((p) => p.id === person.id);
  assert.ok(["Desk Zoë", "Other Holder"].includes(claimed.name));
  assert.equal(claimed.unassigned, false);
  assert.equal(claimed.badge, true);
  assert.equal(claimed.email, "");
  assert.ok(claimed.arrivedAt);
  assert.equal(claimed.arrivedBy, "Assignment desk");
  assert.equal(list.attendees.filter((p) => p.arrivedAt).length, 1);
  assert.equal(
    (
      await runSql(
        `SELECT * FROM attendee_arrival_events WHERE attendee_id='${person.id}'`,
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await send(
        assignPath,
        "POST",
        { ...payload, rosterRevision: list.revision },
        staff,
      )
    ).status,
    409,
  );

  assert.equal(
    (
      await send(path, "POST", {
        source: "tito",
        revision: list.revision,
        attendees: rows,
      })
    ).status,
    200,
  );
  list = await read();
  const refreshed = list.attendees.find((p) => p.id === person.id);
  assert.equal(refreshed.name, claimed.name);
  assert.equal(refreshed.unassigned, false);
  assert.equal(refreshed.arrivedAt, claimed.arrivedAt);
  assert.equal(refreshed.badge, true);
  assert.equal(list.attendees.length, 8);
  assert.equal(
    (
      await send(path, "POST", {
        source: "tito",
        revision: list.revision,
        attendees: rows.map((p) =>
          p.ticketCode === "ORDER-1"
            ? {
                ...p,
                name: "Assigned in Tito",
                email: "assigned@example.test",
                unassigned: false,
                badge: true,
              }
            : p,
        ),
      })
    ).status,
    200,
  );
  list = await read();
  assert.equal(
    list.attendees.find((p) => p.id === person.id).name,
    "Assigned in Tito",
  );
  assert.equal(
    list.attendees.find((p) => p.id === person.id).arrivedAt,
    claimed.arrivedAt,
  );

  // A failure in the arrival statement must roll back the encrypted roster write too.
  const unclaimed = list.attendees.find((p) => p.ticketCode === "ALT-1");
  await runSql(
    "CREATE TRIGGER reject_test_arrival BEFORE INSERT ON attendee_arrivals BEGIN SELECT RAISE(ABORT, 'simulated_write_failure'); END;",
  );
  const failed = {
    id: unclaimed.id,
    name: "Must Roll Back",
    revision: 0,
    rosterRevision: list.revision,
  };
  assert.equal((await send(assignPath, "POST", failed, staff)).status, 503);
  let afterFailure = await read();
  assert.equal(afterFailure.revision, list.revision);
  assert.equal(
    afterFailure.attendees.find((p) => p.id === unclaimed.id).unassigned,
    true,
  );
  assert.equal(
    afterFailure.attendees.find((p) => p.id === unclaimed.id).arrivedAt,
    null,
  );
  await runSql("DROP TRIGGER reject_test_arrival");
  await send(path + "/access", "POST", {
    action: "revoke",
    id: grants.grants[0].id,
  });
  assert.equal((await send(assignPath, "POST", failed, staff)).status, 401);
  afterFailure = await read();
  assert.equal(afterFailure.revision, list.revision);
});
