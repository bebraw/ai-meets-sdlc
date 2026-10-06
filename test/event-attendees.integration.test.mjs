import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import { buildCateringRoster } from "../site/scripts/attendee-catering-model.ts";

test("accepted presenters and volunteers join check-in and catering live, with dinner diets, stable arrivals and stale-source protection", async (t) => {
  const fixture = await createReceiptFixture({
    vars: {
      POSTER_PROPOSAL_DEADLINE: "2099-09-27T20:59:59Z",
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
      SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
      TURNSTILE_SECRET_KEY: "",
    },
  });
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const send = (path, method = "GET", body, action = "manage-attendees") =>
    worker.fetch(origin + path, {
      method,
      headers: {
        authorization: receiptAdmin,
        origin,
        "x-admin-action": action,
        ...(body instanceof URLSearchParams
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : {
            body: body instanceof URLSearchParams ? body : JSON.stringify(body),
          }),
    });
  const read = async () => {
    const response = await send("/api/admin/attendees");
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const submit = async (name, email, title) => {
    const body = new URLSearchParams({
      name,
      email,
      title,
      organization: "Poster company",
      abstract:
        "Poster abstract for integration coverage, including the event registration, attendee roles, and dinner dietary requirements.",
      terms: "yes",
      consent: "yes",
    });
    const response = await send("/api/poster-proposals", "POST", body);
    assert.equal(response.status, 201, await response.clone().text());
    return (
      await runSql("SELECT id FROM poster_proposals ORDER BY id DESC LIMIT 1")
    )[0].id;
  };
  const posterId = await submit(
    "Poster Presenter",
    "poster@example.test",
    "First poster",
  );
  await submit(
    "Pending Presenter",
    "pending@example.test",
    "Unaccepted poster",
  );
  assert.equal((await read()).attendees.length, 0);
  await runSql(
    `UPDATE poster_proposals SET status = 'accepted' WHERE id = ${posterId}`,
  );
  let listing = await read();
  const presenter = listing.attendees[0];
  assert.equal(presenter.type, "attendee");
  assert.equal(presenter.source, "poster");
  const arrive = (person, data, action = "arrived") =>
    send("/api/registration/arrival", "POST", {
      id: person.id,
      arrivalId: person.arrivalId,
      revision: person.arrivalRevision,
      rosterRevision: data.revision,
      action,
    });
  assert.equal((await arrive(presenter, listing)).status, 200);
  const volunteerResponse = await send(
    "/api/admin/volunteers",
    "POST",
    new URLSearchParams({
      name: "Volunteer",
      email: "volunteer@example.test",
      task: "Private task description",
      badge: "false",
    }),
    "manage-volunteers",
  );
  assert.equal(volunteerResponse.status, 201);
  const volunteer = (await volunteerResponse.json()).volunteer;
  assert.equal((await arrive(presenter, listing)).status, 409);
  listing = await read();
  assert.equal(
    listing.attendees.find((p) => p.source === "volunteer").type,
    "organizer",
  );
  assert.ok(listing.attendees.find((p) => p.id === presenter.id).arrivedAt);
  const dinnerBody = new URLSearchParams({
    name: "Poster Presenter",
    attendance: "attending",
    meal_preference: "vegan",
    food_requirements: "Private nut allergy",
    cross_contamination: "yes",
    consent: "yes",
  });
  assert.equal(
    (
      await send(
        "/api/admin/speaker-dinner/guests",
        "POST",
        dinnerBody,
        "add-dinner-guest",
      )
    ).status,
    200,
  );
  let catering = await (await send("/api/admin/attendees/catering")).json();
  const combined = buildCateringRoster(listing.attendees, catering);
  assert.equal(combined.pending, 0);
  assert.match(
    combined.people.find((p) => p.diet?.includes("Private nut allergy")).diet,
    /vegan; Private nut allergy; Cross-contamination/,
  );
  assert.equal(
    catering.sources.filter((p) => p.kind === "poster-presenter").length,
    1,
  );
  assert.equal(
    catering.sources.filter((p) => p.kind === "volunteer").length,
    1,
  );
  // A later ticket import combines the canonical presenter and preserves their earlier arrival.
  const input = {
    name: "Ticket alias",
    email: "poster@example.test",
    company: "",
    ticketCode: "P-1",
    status: "active",
    badge: true,
    diet: "Gluten free",
  };
  assert.equal(
    (
      await send("/api/admin/attendees", "POST", {
        source: "tito",
        revision: listing.revision,
        attendees: [input],
      })
    ).status,
    200,
  );
  listing = await read();
  const merged = listing.attendees.find((p) => p.ticketCode === "P-1");
  assert.equal(listing.attendees.length, 2);
  assert.ok(merged.arrivedAt);
  assert.equal(merged.arrivalId, merged.id);
  assert.equal((await arrive(merged, listing)).status, 409);
  assert.equal((await arrive(merged, listing, "undo")).status, 200);
  listing = await read();
  assert.equal(
    (
      await arrive(
        listing.attendees.find((p) => p.id === merged.id),
        listing,
      )
    ).status,
    200,
  );
  catering = await (await send("/api/admin/attendees/catering")).json();
  const dinnerSource = catering.sources.find((p) => p.kind === "dinner-guest");
  // Aliases can be mapped to the now imported ticket identity.
  assert.equal(
    (
      await send(
        "/api/admin/attendees/catering",
        "PUT",
        {
          revision: catering.revision,
          version: catering.version,
          mappings: [
            { sourceId: dinnerSource.id, target: `attendee:${merged.id}` },
          ],
        },
        "manage-attendee-catering",
      )
    ).status,
    200,
  );
  const diets = buildCateringRoster(
    (await read()).attendees,
    await (await send("/api/admin/attendees/catering")).json(),
  );
  assert.match(
    diets.people.find((p) => p.diet?.includes("Gluten free")).diet,
    /Private nut allergy/,
  );
  const beforeDuplicate = await read();
  assert.equal(
    (
      await send("/api/admin/attendees", "POST", {
        source: "tito",
        revision: beforeDuplicate.revision,
        attendees: [
          { ...input, name: "Second ticket holder", ticketCode: "P-2" },
        ],
      })
    ).status,
    200,
  );
  const ambiguous = await read();
  assert.equal(ambiguous.pendingRegistrations, 1);
  const matching = await (await send("/api/admin/attendees/catering")).json();
  assert.equal(
    (
      await send(
        "/api/admin/attendees/catering",
        "PUT",
        {
          revision: matching.revision,
          version: matching.version,
          mappings: [
            { sourceId: dinnerSource.id, target: `attendee:${merged.id}` },
            { sourceId: `poster:${posterId}`, target: `attendee:${merged.id}` },
          ],
        },
        "manage-attendee-catering",
      )
    ).status,
    200,
  );
  assert.equal((await read()).pendingRegistrations, 0);
  assert.equal(
    (
      await arrive(
        ambiguous.attendees.find((p) => p.id === merged.id),
        ambiguous,
        "undo",
      )
    ).status,
    409,
    "Identity mapping changes invalidate old registration confirmations",
  );
  const badges = await (await send("/api/admin/badges")).json();
  assert.ok(
    badges.people.some((p) => p.email === input.email && p.role === "attendee"),
  );
  assert.equal(
    badges.people.filter((p) => p.email === volunteer.email).length,
    0,
  );
  // Desk access sees the merged identities and organizer role, with no dinner data or volunteer tasks.
  const access = await (
    await send("/api/admin/attendees/access", "POST", {
      action: "create",
      label: "Desk",
    })
  ).json();
  const token = new URLSearchParams(
    new URL(access.grants[0].link).hash.slice(1),
  ).get("token");
  const session = await worker.fetch(origin + "/api/registration/session", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-admin-action": "manage-attendees",
    },
    body: JSON.stringify({ token }),
  });
  const cookie = session.headers.get("set-cookie").split(";", 1)[0];
  const desk = await worker.fetch(origin + "/api/registration/attendees", {
    headers: { cookie },
  });
  const deskText = await desk.text();
  assert.doesNotMatch(
    deskText,
    /Private nut allergy|Gluten free|meal_preference|diet|Private task/,
  );
  assert.equal(
    JSON.parse(deskText).attendees.find((p) => p.source === "volunteer").type,
    "organizer",
  );
  const stale = await read();
  await runSql(`DELETE FROM volunteers WHERE volunteer_id = '${volunteer.id}'`);
  assert.equal(
    (
      await arrive(
        stale.attendees.find((p) => p.source === "volunteer"),
        stale,
      )
    ).status,
    409,
  );
  await runSql(
    `UPDATE poster_proposals SET status = 'declined' WHERE id = ${posterId}`,
  );
  listing = await read();
  assert.ok(
    listing.attendees[0].arrivedAt,
    "Source removal retains the ticket arrival",
  );
  assert.equal(
    listing.attendees.length,
    2,
    "Source removals preserve the independently imported ticket",
  );
  const stored = (await runSql("SELECT * FROM attendee_roster"))[0];
  assert.doesNotMatch(
    JSON.stringify(stored),
    /Poster Presenter|volunteer@example|Private nut allergy/,
  );
});
