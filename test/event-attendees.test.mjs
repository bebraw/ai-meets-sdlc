import assert from "node:assert/strict";
import test from "node:test";
import { mergeEventAttendees } from "../site/scripts/event-attendee-model.ts";
import { buildCateringRoster } from "../site/scripts/attendee-catering-model.ts";

const ticket = {
  id: "t1",
  source: "tito",
  sourceKey: "ticket:ONE",
  name: "Ticket Holder",
  email: "one@example.test",
  company: "Company",
  ticketCode: "ONE",
  type: "attendee",
  status: "active",
  badge: false,
  diet: "Gluten free",
};
const poster = {
  id: "poster:1",
  source: "poster",
  name: "Poster Presenter",
  email: "poster@example.test",
  company: "Poster Company",
  badge: true,
};
const volunteer = {
  id: "volunteer:v1",
  source: "volunteer",
  name: "Volunteer",
  email: "volunteer@example.test",
  company: "",
  badge: false,
};

test("live poster presenters are attendees and volunteers are organizers regardless of badge inclusion", () => {
  const roster = mergeEventAttendees([ticket], [poster, volunteer]);
  assert.equal(roster.people.length, 3);
  assert.equal(roster.people[1].type, "attendee");
  assert.equal(roster.people[1].source, "poster");
  assert.equal(roster.people[2].type, "organizer");
  assert.equal(roster.people[2].badge, false);
  assert.equal(roster.pending, 0);
});

test("members match ticket emails, repeated posters and volunteer overlaps without modifying the import", () => {
  const roster = mergeEventAttendees(
    [ticket],
    [
      { ...poster, email: ticket.email.toUpperCase() },
      { ...poster, id: "poster:2", email: ticket.email },
      { ...volunteer, email: ticket.email },
    ],
  );
  assert.equal(roster.people.length, 1);
  assert.equal(roster.people[0].id, ticket.id);
  assert.equal(roster.people[0].type, "organizer");
  assert.equal(roster.people[0].diet, "Gluten free");
  assert.equal(ticket.type, "attendee");
  assert.equal(roster.aliases.get(ticket.id).length, 4);
  assert.deepEqual(mergeEventAttendees([ticket], []).people, [ticket]);
});

test("ambiguous membership needs a registration mapping; separate is explicit and cancellation survives", () => {
  const tickets = [ticket, { ...ticket, id: "t2" }];
  const member = { ...poster, email: ticket.email };
  const ambiguous = mergeEventAttendees(tickets, [member]);
  assert.equal(ambiguous.pending, 1);
  assert.equal(ambiguous.people.length, 2);
  const mapped = mergeEventAttendees(
    tickets,
    [member],
    [{ sourceId: member.id, target: "attendee:t2" }],
  );
  assert.equal(mapped.pending, 0);
  assert.equal(mapped.memberTargets.get(member.id), "t2");
  assert.equal(
    mergeEventAttendees(
      tickets,
      [member],
      [{ sourceId: member.id, target: "separate" }],
    ).people.length,
    3,
  );
  const cancelled = mergeEventAttendees(
    [{ ...ticket, status: "cancelled" }],
    [member],
  );
  assert.equal(cancelled.people.length, 1);
  assert.equal(cancelled.people[0].status, "cancelled");
});

test("poster and volunteer dinner responses join their single registration and retain combined restrictions", () => {
  const roster = mergeEventAttendees([], [poster, volunteer]);
  const sources = [
    {
      id: poster.id,
      name: poster.name,
      email: poster.email,
      kind: "poster-presenter",
      registrationId: roster.memberTargets.get(poster.id),
    },
    {
      id: volunteer.id,
      name: volunteer.name,
      email: volunteer.email,
      kind: "volunteer",
      registrationId: roster.memberTargets.get(volunteer.id),
    },
    {
      id: "dinner-guest:d1",
      kind: "dinner-guest",
      name: poster.name,
      diet: "Vegan; Nut allergy",
    },
    {
      id: "dinner-guest:d2",
      kind: "dinner-guest",
      name: volunteer.name,
      diet: "Lactose free",
    },
  ];
  const result = buildCateringRoster(roster.people, {
    revision: 0,
    version: "v",
    sources,
    mappings: [],
    organizers: [{ id: "o1", name: volunteer.name }],
  });
  assert.equal(result.people.length, 2);
  assert.equal(result.additional, 0);
  assert.equal(result.pending, 0);
  assert.match(result.people[0].diet, /Vegan; Nut allergy/);
  assert.equal(result.people[1].diet, "Lactose free");
});
