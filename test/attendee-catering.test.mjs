import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCateringRoster,
  dinnerDiet,
  parseCateringMappings,
  parseCateringPreferences,
  summarizeCateringPlan,
} from "../site/scripts/attendee-catering-model.ts";
import {
  cateringSummaryText,
  summarizeAttendeeDiets,
} from "../site/scripts/attendee-diets.ts";
import { mergeAttendeeImport } from "../site/scripts/attendee-model.ts";
import {
  parseDietReviews,
  reviewUsesDinnerData,
} from "../site/scripts/attendee-diet-reviews.ts";

const person = {
  id: "a-1",
  source: "tito",
  sourceKey: "ticket:t-1",
  name: "Attendee",
  email: "one@example.test",
  company: "",
  ticketCode: "T-1",
  type: "attendee",
  status: "active",
  badge: false,
  diet: "Gluten free",
};
const speaker = {
  id: "speaker:one",
  name: "Speaker",
  email: "speaker@example.test",
  kind: "speaker",
  diet: "Vegan",
};
const data = (sources, mappings = [], organizers = []) => ({
  revision: 0,
  version: "v1",
  sources,
  mappings,
  organizers,
});
const counts = (result) => summarizeAttendeeDiets(result.people);

test("reserved meals increase planning totals without inventing attendees or dietary answers", () => {
  const mappings = [{ sourceId: "speaker:one", target: "separate" }];
  assert.deepEqual(parseCateringPreferences({ mappings }), {
    mappings,
    reservedMeals: 0,
  });
  const preferences = parseCateringPreferences({ mappings, reservedMeals: 13 });
  assert.equal(preferences.reservedMeals, 13);
  for (const count of [-1, 0.5, 2001, null, "13"])
    assert.throws(() =>
      parseCateringPreferences({ mappings, reservedMeals: count }),
    );
  const roster = buildCateringRoster([person], data([speaker]));
  const planned = summarizeCateringPlan(roster, 13);
  assert.equal(planned.active, 15);
  assert.equal(planned.missing, 13);
  assert.equal(planned.requirements, 2);
  assert.equal(planned.noRestrictions, 0);
  assert.equal(roster.people.length, 2);
  assert.equal(roster.additional, 1);
  assert.match(
    cateringSummaryText(planned, "Test date", {
      registrations: 1,
      additional: 1,
      pending: 0,
      reservedMeals: 13,
    }),
    /Reserved meals for unassigned tickets and other guests: 13/u,
  );
  assert.equal(summarizeCateringPlan(roster, 0).active, 2);
});

test("manual reviews categorize each person independently, preserve originals and export preparation notes", () => {
  const attendees = [
    person,
    { ...person, id: "a-2", name: "Second", email: "second@example.test" },
  ].map((item) => ({ ...item, diet: "Lactose" }));
  const initial = buildCateringRoster(attendees, data([]));
  const reviews = initial.people.map((item, index) => ({
    personId: item.id,
    sourceSignature: item.sourceSignature,
    status: index ? "clarify" : "reviewed",
    categories: index ? [] : ["lactose-free"],
    note: index ? "Confirm intended restriction" : "Serve a lactose-free meal",
  }));
  const reviewed = buildCateringRoster(attendees, { ...data([]), reviews });
  const summary = counts(reviewed);
  assert.equal(summary.active, 2);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.counts.find(({ id }) => id === "lactose-free").count, 1);
  assert.equal(reviewed.people[0].diet, "Lactose");
  const report = cateringSummaryText(summary, "Test date");
  assert.match(report, /Serve a lactose-free meal/);
  assert.match(report, /Confirm intended restriction/);
  assert.match(report, /1 x Lactose/);
  assert.doesNotMatch(report, /one@example|second@example|Attendee|a-1/);
});

test("changed dietary sources or mappings reopen reviews without applying stale categories", () => {
  const sourceData = data([speaker]);
  const original = buildCateringRoster([person], sourceData).people[0];
  const review = {
    personId: original.id,
    sourceSignature: original.sourceSignature,
    status: "reviewed",
    categories: ["dairy-free"],
    note: "Previous preparation instructions",
  };
  const reimported = buildCateringRoster([{ ...person, diet: "Vegan" }], {
    ...sourceData,
    reviews: [review],
  });
  assert.equal(reimported.people[0].review, undefined);
  assert.deepEqual(reimported.people[0].staleReview, review);
  assert.equal(counts(reimported).needsReview, 1);
  assert.equal(
    counts(reimported).counts.find(({ id }) => id === "dairy-free").count,
    0,
  );
  assert.doesNotMatch(
    cateringSummaryText(counts(reimported), "Test"),
    /Previous preparation instructions/,
  );
  const linked = buildCateringRoster([person], {
    ...sourceData,
    mappings: [{ sourceId: speaker.id, target: "attendee:a-1" }],
    reviews: [review],
  });
  assert.equal(linked.people[0].staleReview.personId, original.id);
});

test("explicit missing and no-restrictions reviews update totals without changing headcount", () => {
  const initial = buildCateringRoster([person], data([])).people[0];
  for (const [status, expected] of [
    ["none", "noRestrictions"],
    ["missing", "missing"],
  ]) {
    const reviewed = buildCateringRoster([person], {
      ...data([]),
      reviews: [
        {
          personId: initial.id,
          sourceSignature: initial.sourceSignature,
          status,
          categories: [],
          note: "",
        },
      ],
    });
    const summary = counts(reviewed);
    assert.equal(summary.active, 1);
    assert.equal(summary[expected], 1);
    assert.equal(summary.requirements, 0);
    assert.equal(summary.needsReview, 0);
    assert.equal(person.diet, "Gluten free");
  }
});

test("dietary review validation rejects duplicates and conflicting decisions", () => {
  const review = {
    personId: "attendee:a-1",
    sourceSignature: "source",
    status: "reviewed",
    categories: ["allergy"],
    note: "Avoid raw apple",
  };
  assert.deepEqual(parseDietReviews([review]), [review]);
  for (const invalid of [
    [review, review],
    [{ ...review, status: "automatic" }],
    [{ ...review, categories: ["unknown"] }],
    [{ ...review, categories: ["allergy", "allergy"] }],
    [{ ...review, status: "none" }],
    [{ ...review, status: "missing" }],
    [{ ...review, categories: [], note: "" }],
    [{ ...review, note: "x".repeat(2001) }],
  ])
    assert.throws(() => parseDietReviews(invalid));
});

test("dietary source snapshots identify dinner data for the existing retention deadline", () => {
  const review = {
    sourceSignature: JSON.stringify([
      ["attendee:a-1", "Gluten free"],
      ["speaker:one", "Nut allergy"],
    ]),
  };
  assert.equal(reviewUsesDinnerData(review), true);
  assert.equal(
    reviewUsesDinnerData({
      sourceSignature: JSON.stringify([
        ["attendee:a-1", "Nut allergy"],
        ["poster:one", ""],
      ]),
    }),
    false,
  );
  assert.equal(reviewUsesDinnerData({ sourceSignature: "invalid" }), true);
});

test("speakers join daytime catering even without an RSVP; dinner diets retain meal and contamination details", () => {
  const result = buildCateringRoster(
    [person, { ...person, id: "cancelled", status: "cancelled" }],
    data([
      speaker,
      { ...speaker, id: "speaker:two", name: "Second", diet: undefined },
    ]),
  );
  assert.equal(counts(result).active, 3);
  assert.equal(counts(result).cancelled, 1);
  assert.equal(counts(result).missing, 1);
  assert.equal(result.additional, 2);
  const response = dinnerDiet({
    attendance: "not_attending",
    meal_preference: "vegan",
    food_requirements: "Private nut allergy",
    cross_contamination: "yes",
  });
  assert.match(
    response,
    /vegan; Private nut allergy; Cross-contamination is a concern/,
  );
  assert.equal(
    summarizeAttendeeDiets([{ status: "active", diet: response }]).needsReview,
    1,
  );
  assert.equal(
    dinnerDiet({
      meal_preference: "",
      food_requirements: "",
      cross_contamination: "",
    }),
    undefined,
  );
  assert.equal(
    dinnerDiet({
      meal_preference: "omnivore",
      food_requirements: "",
      cross_contamination: "no",
    }),
    "No restrictions",
  );
  assert.match(
    dinnerDiet({
      meal_preference: "other",
      food_requirements: "",
      cross_contamination: "unsure",
    }),
    /unsure/,
  );
});

test("email and unique name matches merge dietary details without changing attendee or badge data", () => {
  const registeredSpeaker = {
    ...speaker,
    name: "Different speaker name",
    email: "ONE@example.test",
  };
  const result = buildCateringRoster([person], data([registeredSpeaker]));
  assert.equal(counts(result).active, 1);
  assert.equal(result.additional, 0);
  assert.equal(counts(result).requirements, 1);
  assert.match(result.people[0].diet, /Gluten free; Vegan/);
  assert.equal(person.diet, "Gluten free");
  assert.equal(person.badge, false);
  const byName = buildCateringRoster(
    [person],
    data([{ ...speaker, name: " attendee ", email: "" }]),
  );
  assert.equal(counts(byName).active, 1);
});

test("ambiguous matches wait for an explicit mapping and links survive source refreshes", () => {
  const attendees = [
    person,
    { ...person, id: "a-2", ticketCode: "T-2", sourceKey: "ticket:t-2" },
  ];
  const source = { ...speaker, name: person.name, email: person.email };
  const unresolved = buildCateringRoster(attendees, data([source]));
  assert.equal(counts(unresolved).active, 2);
  assert.equal(unresolved.pending, 1);
  const mappings = [{ sourceId: source.id, target: "attendee:a-2" }];
  const refreshed = mergeAttendeeImport(attendees, "tito", [
    { ...person, ticketCode: "T-2", diet: "Lactose free" },
  ]);
  const result = buildCateringRoster(refreshed, data([source], mappings));
  assert.equal(result.pending, 0);
  assert.equal(counts(result).active, 2);
  assert.match(result.people[1].diet, /Lactose free; Vegan/);
});

test("organizer dinner aliases can be mapped and repeated responses count that organizer once", () => {
  const sources = [
    {
      id: "dinner-guest:one",
      name: "Dinner nickname",
      kind: "dinner-guest",
      diet: "Dairy free",
    },
    {
      id: "dinner-guest:two",
      name: "Organizer",
      kind: "dinner-guest",
      diet: "Vegan",
    },
    {
      id: "dinner-guest:three",
      name: "Dinner-only guest",
      kind: "dinner-guest",
      diet: "Halal",
    },
  ];
  const organizers = [{ id: "o-1", name: "Organizer" }];
  const result = buildCateringRoster(
    [person],
    data(
      sources,
      [{ sourceId: sources[0].id, target: "organizer:o-1" }],
      organizers,
    ),
  );
  assert.equal(counts(result).active, 2);
  assert.equal(result.additional, 1);
  assert.equal(result.pending, 1);
  assert.match(result.people[1].diet, /Dairy free; Vegan/);
  const registered = buildCateringRoster(
    [{ ...person, name: "Organizer" }],
    data(
      sources.slice(0, 2),
      [{ sourceId: sources[0].id, target: "organizer:o-1" }],
      organizers,
    ),
  );
  assert.equal(counts(registered).active, 1);
  assert.equal(registered.pending, 0);
});

test("shared speaker responses merge once; explicit guests and exclusions control headcount", () => {
  const guest = {
    id: "dinner-guest:one",
    name: speaker.name,
    kind: "dinner-guest",
    diet: "Lactose free",
  };
  const merged = buildCateringRoster([], data([speaker, guest]));
  assert.equal(counts(merged).active, 1);
  assert.match(merged.people[0].diet, /Vegan; Lactose free/);
  const separate = buildCateringRoster(
    [],
    data([speaker, guest], [{ sourceId: guest.id, target: "separate" }]),
  );
  assert.equal(counts(separate).active, 2);
  const excluded = buildCateringRoster(
    [],
    data(
      [speaker, guest],
      [
        { sourceId: speaker.id, target: "exclude" },
        { sourceId: guest.id, target: "exclude" },
      ],
    ),
  );
  assert.equal(counts(excluded).active, 0);
  assert.equal(excluded.pending, 0);
  const ambiguousSeparate = buildCateringRoster(
    [{ ...person, name: speaker.name }],
    data([speaker, guest], [{ sourceId: speaker.id, target: "separate" }]),
  );
  assert.equal(counts(ambiguousSeparate).active, 2);
  assert.equal(
    ambiguousSeparate.pending,
    1,
    "A separate-person choice must not be silently merged back into a registration",
  );
});

test("missing or cancelled targets require review and no-restriction answers never erase allergies", () => {
  const sources = [{ ...speaker, diet: "Allergic to raw apple" }];
  const result = buildCateringRoster(
    [{ ...person, email: speaker.email, diet: "None" }],
    data(sources),
  );
  assert.equal(counts(result).requirements, 1);
  assert.equal(result.people[0].diet, "Allergic to raw apple");
  const stale = buildCateringRoster(
    [{ ...person, status: "cancelled" }],
    data(sources, [{ sourceId: speaker.id, target: `attendee:${person.id}` }]),
  );
  assert.equal(stale.pending, 1);
  assert.equal(counts(stale).active, 0);
  const blanks = buildCateringRoster(
    [{ ...person, name: speaker.name, diet: "n/a" }],
    data([{ ...speaker, email: "", diet: "None" }]),
  );
  assert.equal(counts(blanks).noRestrictions, 1);
});

test("exports report combined coverage and pending mappings without including identity data", () => {
  const result = buildCateringRoster(
    [person],
    data([
      speaker,
      {
        id: "dinner-guest:private",
        name: "Private guest",
        kind: "dinner-guest",
        diet: "Private pending allergy",
      },
    ]),
  );
  const report = cateringSummaryText(counts(result), "6 Oct 2026", {
    registrations: 1,
    additional: result.additional,
    pending: result.pending,
  });
  assert.match(report, /Catering headcount: 2/);
  assert.match(report, /Additional speakers, organizers, and guests: 1/);
  assert.match(report, /awaiting mapping \(not counted\): 1/);
  assert.doesNotMatch(
    report,
    /one@example|Private guest|Private pending allergy|T-1/,
  );
  assert.throws(() =>
    parseCateringMappings([
      { sourceId: "x", target: "attendee:a-1" },
      { sourceId: "x", target: "separate" },
    ]),
  );
  assert.throws(() =>
    parseCateringMappings([{ sourceId: "x", target: "invalid" }]),
  );
});
