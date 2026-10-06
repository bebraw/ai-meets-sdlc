import assert from "node:assert/strict";
import test from "node:test";
import {
  dinnerDiet,
  dinnerCateringSummaryText,
  summarizeDinnerDiets,
} from "../site/scripts/dinner-diets.ts";
import { summarizeAttendeeDiets } from "../site/scripts/attendee-diets.ts";

const response = (details = {}) => ({
  response: {
    attendance: "attending",
    meal_preference: "vegan",
    food_requirements: "Gluten free",
    cross_contamination: "no",
    ...details,
  },
});

test("dinner aggregates attending speakers and guests using the existing combined diet groups", () => {
  const guests = [
    response(),
    response(),
    response({
      meal_preference: "vegetarian",
      food_requirements: "Lactose free",
    }),
    response({ meal_preference: "omnivore", food_requirements: "" }),
    response({
      attendance: "not_attending",
      food_requirements: "Excluded allergy",
    }),
    { response: null },
  ];
  const summary = summarizeDinnerDiets(guests);
  assert.equal(summary.active, 4);
  assert.equal(summary.notAttending, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.requirements, 3);
  assert.equal(summary.noRestrictions, 1);
  assert.equal(summary.missing, 0);
  assert.equal(
    summary.groups.find((group) => group.label === "Vegan + Gluten free").count,
    2,
  );
  assert.equal(
    summary.groups.find((group) => group.label === "Vegetarian + Lactose free")
      .count,
    1,
  );
  assert.equal(summary.meals.find((meal) => meal.id === "vegan").count, 2);
  assert.equal(
    summary.meals.reduce((count, meal) => count + meal.count, 0),
    summary.active,
  );
  const shared = summarizeAttendeeDiets(
    guests
      .slice(0, 4)
      .map((guest) => ({ status: "active", diet: dinnerDiet(guest.response) })),
  );
  assert.deepEqual(summary.groups, shared.groups);
  assert.deepEqual(summary.counts, shared.counts);
});

test("original allergies and contamination concerns remain visible and missing food answers are not inferred", () => {
  const summary = summarizeDinnerDiets([
    response({
      food_requirements: "Severe nut allergy",
      cross_contamination: "yes",
    }),
    response({
      food_requirements: "No red meat",
      cross_contamination: "unsure",
    }),
    response({
      meal_preference: "",
      food_requirements: "",
      cross_contamination: "",
    }),
    response({
      meal_preference: "other",
      food_requirements: "",
      cross_contamination: "no",
    }),
    response({ attendance: "not_attending", cross_contamination: "yes" }),
  ]);
  assert.equal(summary.active, 4);
  assert.equal(summary.crossContaminationConcern, 1);
  assert.equal(summary.crossContaminationUnsure, 1);
  assert.equal(summary.missing, 1);
  assert.equal(summary.meals.find((meal) => meal.id === "").count, 1);
  assert.equal(summary.needsReview, 3);
  assert.ok(
    summary.groups.some((group) =>
      group.responses.some((item) =>
        item.text.includes(
          "Severe nut allergy; Cross-contamination is a concern.",
        ),
      ),
    ),
  );
  assert.ok(
    summary.groups.some((group) =>
      group.responses.some((item) =>
        item.text.includes("No red meat; Cross-contamination: unsure."),
      ),
    ),
  );
});

test("dinner exports use the dinner date and attending-only coverage without adding identities", () => {
  const summary = summarizeDinnerDiets([
    {
      ...response({
        food_requirements: "Raw apple allergy",
        cross_contamination: "yes",
      }),
      name: "Private Guest",
      email: "private@example.test",
      speaker_id: "private-speaker",
    },
    response({
      attendance: "not_attending",
      food_requirements: "Excluded diet",
    }),
    { response: null },
  ]);
  const text = dinnerCateringSummaryText(summary, "6 Oct 2026 (Helsinki time)");
  assert.match(text, /12 October 2026/);
  assert.match(text, /Dinner headcount: 1/);
  assert.match(text, /Not attending \(excluded\): 1/);
  assert.match(text, /Awaiting attendance reply \(excluded\): 1/);
  assert.match(text, /Vegan: 1/);
  assert.match(text, /Cross-contamination concern: 1/);
  assert.match(text, /Raw apple allergy/);
  assert.match(text, /\[REVIEW\]/);
  assert.doesNotMatch(
    text,
    /13 October|Marsio|Private Guest|private@example|private-speaker|Excluded diet|Active registrations/,
  );
  const empty = summarizeDinnerDiets([
    { response: null },
    response({ attendance: "not_attending" }),
  ]);
  assert.equal(empty.active, 0);
  assert.match(
    dinnerCateringSummaryText(empty, "Now"),
    /No dietary requirements reported/,
  );
});
