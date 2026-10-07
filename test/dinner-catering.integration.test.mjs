import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import {
  buildDinnerCateringRoster,
  dinnerCateringSummaryText,
  summarizeDinnerDiets,
} from "../site/scripts/dinner-diets.ts";
import { encryptText } from "../worker/form-utils.ts";

const futureDinner = {
  SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
  SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
};
const headers = {
  authorization: receiptAdmin,
  origin,
  "content-type": "application/json",
  "x-admin-action": "review-dinner-diet",
};
const reviewPath = "/api/admin/speaker-dinner/diet-review";

test("dinner reviews are encrypted, apply to speakers and guests, reject stale saves, and are purged with dinner data", async (t) => {
  const fixture = await createReceiptFixture({ vars: futureDinner });
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const read = async () => {
    const response = await worker.fetch(origin + "/api/admin/speaker-dinner", {
      headers,
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const send = (data, review, extra = {}) =>
    worker.fetch(origin + reviewPath, {
      method: "PUT",
      headers: { ...headers, ...extra },
      body: JSON.stringify({
        revision: data.revision,
        version: data.version,
        review,
      }),
    });
  const ownSave = (requirements = "Private nut allergy") =>
    worker.fetch(origin + "/api/speaker/dinner", {
      method: "POST",
      headers: {
        cookie: cookies.get("mo-khazali"),
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        attendance: "attending",
        meal_preference: "vegan",
        food_requirements: requirements,
        cross_contamination: "yes",
        consent: true,
      }),
    });
  assert.equal((await ownSave()).status, 200);
  const guest = await worker.fetch(
    origin + "/api/admin/speaker-dinner/guests",
    {
      method: "POST",
      headers: {
        ...headers,
        "x-admin-action": "add-dinner-guest",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        name: "Mo Khazali",
        attendance: "attending",
        meal_preference: "other",
        food_requirements: "Lactose",
        cross_contamination: "no",
        consent: "yes",
      }),
    },
  );
  assert.equal(guest.status, 200);
  const before = (
    await runSql(
      "SELECT response_ciphertext, response_iv FROM speaker_dinner_responses WHERE speaker_id = 'mo-khazali'",
    )
  )[0];
  const initial = await read();
  const people = buildDinnerCateringRoster([
    ...initial.speakers,
    ...initial.shared_responses,
  ]);
  assert.equal(people.length, 2);
  const review = {
    personId: people[0].id,
    sourceSignature: people[0].sourceSignature,
    status: "reviewed",
    categories: ["vegan", "allergy"],
    note: "Private catering instruction: separate nut-free utensils",
  };
  assert.equal(
    (await send(initial.catering, review, { authorization: "" })).status,
    401,
  );
  assert.equal(
    (await send(initial.catering, review, { origin: "https://elsewhere.test" }))
      .status,
    403,
  );
  assert.equal(
    (await send(initial.catering, review, { "x-admin-action": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (await send(initial.catering, { ...review, categories: ["unknown"] }))
      .status,
    400,
  );
  assert.equal(
    (await send(initial.catering, { ...review, sourceSignature: "old answer" }))
      .status,
    409,
  );
  assert.equal(
    (
      await send(initial.catering, {
        ...review,
        personId: "speaker:ohans-emmanuel",
      })
    ).status,
    409,
  );
  const results = await Promise.all([
    send(initial.catering, review),
    send(initial.catering, review),
  ]);
  assert.deepEqual(
    results.map((response) => response.status).sort(),
    [200, 409],
  );
  const saved = await read();
  assert.deepEqual(saved.catering.reviews, [review]);
  const all = [...saved.speakers, ...saved.shared_responses];
  const summary = summarizeDinnerDiets(all, saved.catering.reviews);
  assert.equal(summary.active, 2);
  assert.equal(summary.needsReview, 1);
  assert.match(
    dinnerCateringSummaryText(summary, "Now"),
    /Private catering instruction/,
  );
  const after = (
    await runSql(
      "SELECT response_ciphertext, response_iv FROM speaker_dinner_responses WHERE speaker_id = 'mo-khazali'",
    )
  )[0];
  assert.deepEqual(
    after,
    before,
    "Classifications preserve the encrypted original answers",
  );
  const stored = (await runSql("SELECT * FROM speaker_dinner_catering"))[0];
  assert.ok(stored.reviews_ciphertext);
  assert.ok(stored.reviews_iv);
  assert.doesNotMatch(
    JSON.stringify(stored),
    /Private|nut-free|allergy|Mo Khazali/,
  );
  const tracked = await runSql(
    "SELECT table_name, operation FROM organizer_data_changes WHERE table_name = 'speaker_dinner_catering'",
  );
  assert.deepEqual(tracked, [
    { table_name: "speaker_dinner_catering", operation: "updated" },
  ]);
  const csv = await (
    await worker.fetch(origin + "/api/admin/speaker-dinner.csv", { headers })
  ).text();
  assert.match(csv, /dietary_group.*dietary_review.*catering_instructions/);
  assert.match(
    csv,
    /Private nut allergy.*Vegan \+ Allergy declared.*Reviewed.*Private catering instruction/,
  );
  const guestPerson = buildDinnerCateringRoster(all).find((person) =>
    person.id.startsWith("dinner-guest:"),
  );
  const guestReview = {
    personId: guestPerson.id,
    sourceSignature: guestPerson.sourceSignature,
    status: "reviewed",
    categories: ["lactose-free"],
    note: "Guest lactose-free meal",
  };
  assert.equal((await send(saved.catering, guestReview)).status, 200);
  const both = await read();
  assert.equal(both.catering.reviews.length, 2);
  assert.equal(
    summarizeDinnerDiets(
      [...both.speakers, ...both.shared_responses],
      both.catering.reviews,
    ).needsReview,
    0,
  );
  assert.equal((await ownSave("Gluten free")).status, 200);
  assert.equal((await send(both.catering, review)).status, 409);
  const changed = await read();
  const changedPeople = buildDinnerCateringRoster(
    [...changed.speakers, ...changed.shared_responses],
    changed.catering.reviews,
  );
  assert.deepEqual(
    changedPeople.find((person) => person.id === review.personId).staleReview,
    review,
  );
  const changedCsv = await (
    await worker.fetch(origin + "/api/admin/speaker-dinner.csv", { headers })
  ).text();
  assert.match(changedCsv, /Gluten free.*Vegan \+ Gluten free.*Needs review/);
  assert.doesNotMatch(changedCsv, /Private catering instruction/);
  const activity = await (
    await worker.fetch(origin + "/api/admin/activity", { headers })
  ).json();
  assert.ok(
    activity.events.some((event) => event.category === "Dinner dietary review"),
  );
  assert.doesNotMatch(
    JSON.stringify(activity),
    /Private catering instruction|Private nut allergy|Guest lactose/,
  );
  const purge = await worker.fetch(origin + "/api/admin/speaker-dinner/purge", {
    method: "POST",
    headers: {
      ...headers,
      "x-admin-action": "purge-speaker-dinner-data",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ confirmation: "DELETE" }),
  });
  assert.equal(purge.status, 200);
  const cleared = (await runSql("SELECT * FROM speaker_dinner_catering"))[0];
  assert.equal(cleared.reviews_ciphertext, null);
  assert.equal(cleared.reviews_iv, null);
  assert.deepEqual((await read()).catering.reviews, []);
  assert.equal((await send(changed.catering, guestReview)).status, 409);
});

test("expired dinner classifications are withheld and cannot be saved", async (t) => {
  const fixture = await createReceiptFixture({
    vars: {
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2019-12-01T00:00:00Z",
      SPEAKER_DINNER_RETENTION_UNTIL: "2020-01-01T00:00:00Z",
    },
  });
  t.after(() => fixture.dispose());
  const review = {
    personId: "speaker:mo-khazali",
    sourceSignature: "Expired private source",
    status: "reviewed",
    categories: ["allergy"],
    note: "Expired private instructions",
  };
  const encrypted = await encryptText(
    JSON.stringify([review]),
    "isolated-receipt-test-encryption",
  );
  await fixture.runSql(
    `UPDATE speaker_dinner_catering SET reviews_ciphertext = '${encrypted.ciphertext}', reviews_iv = '${encrypted.iv}' WHERE id = 1`,
  );
  const response = await fixture.worker.fetch(
    origin + "/api/admin/speaker-dinner",
    { headers },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.catering.reviews, []);
  assert.doesNotMatch(JSON.stringify(data), /Expired private/);
  const save = await fixture.worker.fetch(origin + reviewPath, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...data.catering, review }),
  });
  assert.equal(save.status, 410);
});
