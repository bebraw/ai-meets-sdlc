import assert from "node:assert/strict";
import test from "node:test";
import {
  cateringSummaryText,
  classifyDiet,
  summarizeAttendeeDiets,
} from "../site/scripts/attendee-diets.ts";

test("diet classification keeps combinations, alternatives, and specific allergy details", () => {
  for (const [response, categories, needsReview] of [
    ["vegan and gluten free", ["vegan", "gluten-free"], false],
    ["lacto-ovo vegetarian", ["vegetarian"], false],
    ["Laktoositon ruokavalio", ["lactose-free"], false],
    ["Vähälaktoosinen", ["low-lactose"], false],
    ["maidoton", ["dairy-free"], false],
    ["Can’t eat pork.", ["no-pork"], false],
    ["Ei sianlihaa", ["no-pork"], false],
    ["I don't eat fish, that's all", ["no-fish"], false],
    ["No fish or seafood", ["no-fish", "no-seafood"], false],
    [
      "No fish or seafood, or vegetarian",
      ["vegetarian", "no-fish", "no-seafood"],
      true,
    ],
    ["Low lactose, no raw celery", ["low-lactose"], true],
    ["Low lactose/lactose free", ["lactose-free", "low-lactose"], true],
    [
      "Vegan (or vegetarian if not possible) and gluten free, please.",
      ["vegan", "gluten-free"],
      true,
    ],
    [
      "Halal ( or Vegetarian) - no alcohol, wine or animal gelatin in food preparation",
      ["vegetarian", "halal"],
      true,
    ],
    ["Allergic to raw apple, pear, kiwi & banana", ["allergy"], true],
    [
      "laktoositonallergiat: omena, pähkinä, manteli",
      ["lactose-free", "allergy"],
      true,
    ],
    ["peeanuts, grapefruit, apricot, almonds", [], true],
    ["Lactose", [], true],
    ["No oysters.", [], true],
    ["not vegan", [], true],
    ["Carnivore", [], true],
    ["please", [], true],
  ]) {
    assert.deepEqual(
      classifyDiet(response),
      {
        response: "requirements",
        categories,
        needsReview,
      },
      response,
    );
  }
  assert.deepEqual(classifyDiet("no fish or seafood").categories, [
    "no-fish",
    "no-seafood",
  ]);
  assert.deepEqual(classifyDiet("No red meat").categories, ["no-red-meat"]);
  for (const response of [undefined, "", "  ", "-", "n/a"])
    assert.equal(classifyDiet(response).response, "missing", String(response));
  for (const response of [
    "None",
    "No restrictions",
    "Ei",
    "Ei ruokarajoitteita",
    "Ei ruokarajoitteita ollenkaan",
    "No allergies.",
  ])
    assert.equal(classifyDiet(response).response, "none", response);
});

test("email-only diet answers count as missing and stay out of catering exports", () => {
  const summary = summarizeAttendeeDiets([
    { status: "active", diet: "  attendee@example.test  " },
    { status: "active", diet: "Vegan; contact attendee@example.test" },
  ]);
  assert.equal(summary.active, 2);
  assert.equal(summary.missing, 1);
  assert.equal(summary.requirements, 1);
  assert.equal(
    summary.needsReview,
    1,
    "Notes containing real requirements still need review",
  );
  const text = cateringSummaryText(
    summarizeAttendeeDiets([
      { status: "active", diet: "attendee@example.test" },
    ]),
    "Test date",
  );
  assert.doesNotMatch(text, /attendee@example\.test/u);
  assert.match(text, /No answer \/ placeholder: 1/u);
});

test("catering totals reconcile active registrations and retain distinct combined meal requirements", () => {
  const summary = summarizeAttendeeDiets([
    ...[
      "Vegan",
      "vegan",
      "Vegan and gluten free",
      "Low lactose, no raw celery",
      "Low lactose, no raw apple",
      "None",
      "-",
      undefined,
    ].map((diet) => ({ status: "active", diet })),
    { status: "cancelled", diet: "Vegan and dairy free" },
  ]);
  assert.equal(summary.active, 8);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.requirements, 5);
  assert.equal(summary.noRestrictions, 1);
  assert.equal(summary.missing, 2);
  assert.equal(
    summary.active,
    summary.requirements + summary.noRestrictions + summary.missing,
  );
  assert.equal(summary.needsReview, 2);
  assert.equal(summary.counts.find((item) => item.id === "vegan").count, 3);
  assert.equal(
    summary.counts.find((item) => item.id === "gluten-free").count,
    1,
  );
  assert.equal(
    summary.counts.find((item) => item.id === "dairy-free").count,
    0,
  );
  assert.equal(summary.groups.length, 4);
  assert.equal(
    summary.groups.reduce((count, group) => count + group.count, 0),
    5,
  );
  assert.equal(
    summary.groups.find((group) => group.label === "Vegan").count,
    2,
  );
  assert.equal(
    summary.groups.filter((group) => group.label === "Low lactose").length,
    2,
  );
  assert.equal(summary.groups.filter((group) => group.needsReview).length, 2);
});

test("catering export includes original notes and coverage without attaching registration identities", () => {
  const text = cateringSummaryText(
    summarizeAttendeeDiets([
      {
        status: "active",
        diet: "Allergic to raw apple, pear, kiwi & banana",
        name: "Private Name",
        email: "private@example.test",
        ticketCode: "SECRET",
      },
      { status: "cancelled", diet: "Cancelled person's allergy" },
    ]),
    "5 Oct 2026 (Helsinki time)",
  );
  assert.match(text, /Active registrations: 1/);
  assert.match(text, /Cancelled registrations excluded: 1/);
  assert.match(text, /1 person - Allergy declared \[REVIEW\]/);
  assert.match(text, /1 x Allergic to raw apple, pear, kiwi & banana/);
  assert.match(text, /Counts overlap/);
  assert.match(text, /Speaker dinner diets and mapped organizer/);
  assert.doesNotMatch(
    text,
    /Private Name|private@example|SECRET|Cancelled person's allergy/,
  );
});
