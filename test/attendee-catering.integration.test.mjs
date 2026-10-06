import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import {
  buildCateringRoster,
  summarizeCateringPlan,
} from "../site/scripts/attendee-catering-model.ts";
import { summarizeAttendeeDiets } from "../site/scripts/attendee-diets.ts";
import { encryptText } from "../worker/form-utils.ts";

test("expired dinner responses cannot be recovered through saved dietary reviews", async (t) => {
  const fixture = await createReceiptFixture({
    vars: {
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2019-12-01T00:00:00Z",
      SPEAKER_DINNER_RETENTION_UNTIL: "2020-01-01T00:00:00Z",
    },
  });
  t.after(() => fixture.dispose());
  const review = {
    personId: "speaker:mo-khazali",
    sourceSignature: JSON.stringify([
      ["speaker:mo-khazali", "Expired private dietary response"],
    ]),
    status: "reviewed",
    categories: ["allergy"],
    note: "Expired private catering note",
  };
  const encrypted = await encryptText(
    JSON.stringify([review]),
    "isolated-receipt-test-encryption",
  );
  await fixture.runSql(
    `UPDATE attendee_roster SET catering_reviews_ciphertext = '${encrypted.ciphertext}', catering_reviews_iv = '${encrypted.iv}' WHERE id = 1`,
  );
  const response = await fixture.worker.fetch(
    origin + "/api/admin/attendees/catering",
    { headers: { authorization: receiptAdmin } },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.reviews, []);
  assert.doesNotMatch(JSON.stringify(data), /Expired private/);
});

test("catering reads live speaker diets, stores encrypted organizer links, survives refreshes and rejects stale or unauthorized saves", async (t) => {
  const fixture = await createReceiptFixture({
    vars: {
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
      SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
    },
  });
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const cateringPath = "/api/admin/attendees/catering";
  const send = (path, method = "GET", body, extra = {}) =>
    worker.fetch(origin + path, {
      method,
      headers: {
        authorization: receiptAdmin,
        origin,
        "content-type": "application/json",
        "x-admin-action":
          path === cateringPath
            ? "manage-attendee-catering"
            : "manage-attendees",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const read = async () => {
    const response = await send(cateringPath);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const roster = async () =>
    (await (await send("/api/admin/attendees")).json()).attendees;
  const initial = await read();
  assert.equal(initial.reservedMeals, 0);
  assert.ok(initial.sources.length > 1);
  assert.ok(initial.sources.every((source) => source.kind === "speaker"));
  assert.equal(
    initial.sources.some((source) => source.name === "Juho Vepsäläinen"),
    false,
    "Private test speakers do not inflate headcount",
  );
  assert.equal(
    (await send(cateringPath, "GET", undefined, { authorization: "" })).status,
    401,
  );

  const dinner = {
    attendance: "attending",
    meal_preference: "vegan",
    food_requirements: "Private nut allergy",
    cross_contamination: "yes",
    consent: true,
  };
  assert.equal(
    (
      await send("/api/speaker/dinner", "POST", dinner, {
        authorization: "",
        cookie: cookies.get("mo-khazali"),
      })
    ).status,
    200,
  );
  const input = {
    name: "Registered under another name",
    email: "mo-khazali@example.test",
    company: "Example",
    ticketCode: "T-1",
    status: "active",
    badge: false,
    diet: "Gluten free",
  };
  assert.equal(
    (
      await send("/api/admin/attendees", "POST", {
        source: "tito",
        revision: 0,
        attendees: [input],
      })
    ).status,
    200,
  );
  let current = await read();
  const sources = current.sources.filter(
    (source) => source.kind === "speaker",
  ).length;
  let combined = buildCateringRoster(await roster(), current);
  assert.equal(
    summarizeAttendeeDiets(combined.people).active,
    sources,
    "Registered speakers count once by contact email",
  );
  assert.match(
    current.sources.find((source) => source.id === "speaker:mo-khazali").diet,
    /vegan; Private nut allergy; Cross-contamination/,
  );
  assert.match(
    combined.people.find((person) => person.diet?.includes("Gluten free")).diet,
    /Private nut allergy/,
  );

  const addGuest = async (name) => {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries({
      name,
      attendance: "attending",
      meal_preference: "vegetarian",
      food_requirements: "Lactose free",
      cross_contamination: "no",
      consent: "yes",
    }))
      form.set(key, value);
    const response = await worker.fetch(
      origin + "/api/admin/speaker-dinner/guests",
      {
        method: "POST",
        headers: {
          authorization: receiptAdmin,
          origin,
          "x-admin-action": "add-dinner-guest",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    assert.equal(response.status, 200);
  };
  await addGuest("Organizer dinner alias");
  current = await read();
  const guest = current.sources.find(
    (source) => source.name === "Organizer dinner alias",
  );
  assert.ok(guest.id.startsWith("dinner-guest:"));
  assert.equal(buildCateringRoster(await roster(), current).pending, 1);
  const organizer = current.organizers[0];
  const mappings = [
    { sourceId: guest.id, target: `organizer:${organizer.id}` },
  ];
  const body = {
    revision: current.revision,
    version: current.version,
    mappings,
    reservedMeals: 13,
  };
  for (const count of [-1, 0.5, 2001, null, "13"])
    assert.equal(
      (await send(cateringPath, "PUT", { ...body, reservedMeals: count }))
        .status,
      400,
    );
  assert.equal(
    (
      await send(cateringPath, "PUT", body, {
        origin: "https://elsewhere.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (await send(cateringPath, "PUT", body, { "x-admin-action": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        ...body,
        mappings: [{ ...mappings[0], target: "organizer:missing" }],
      })
    ).status,
    400,
  );
  const concurrent = await Promise.all([
    send(cateringPath, "PUT", body),
    send(cateringPath, "PUT", body),
  ]);
  assert.deepEqual(
    concurrent.map((response) => response.status).sort(),
    [200, 409],
  );
  current = await read();
  assert.deepEqual(current.mappings, mappings);
  assert.equal(current.revision, 1);
  assert.equal(current.reservedMeals, 13);
  combined = buildCateringRoster(await roster(), current);
  assert.equal(summarizeAttendeeDiets(combined.people).active, sources + 1);
  assert.equal(combined.pending, 0);
  assert.equal(
    summarizeCateringPlan(combined, current.reservedMeals).active,
    sources + 14,
  );
  assert.equal(
    summarizeCateringPlan(combined, current.reservedMeals).missing,
    summarizeAttendeeDiets(combined.people).missing + 13,
  );
  const stored = (
    await runSql("SELECT * FROM attendee_roster WHERE id = 1")
  )[0];
  assert.ok(stored.catering_ciphertext);
  assert.equal(stored.catering_reserved_meals, 13);
  assert.equal(
    stored.revision,
    1,
    "Catering mapping saves do not modify registration revisions",
  );
  assert.doesNotMatch(
    JSON.stringify(stored),
    /Organizer dinner alias|Lactose free|Private nut allergy|organizer:|dinner-guest:/,
  );
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        revision: current.revision,
        version: current.version,
        mappings,
      })
    ).status,
    200,
    "Older clients preserve the reserve when only saving mappings",
  );
  current = await read();
  assert.equal(current.reservedMeals, 13);

  const reviewedPerson = buildCateringRoster(
    await roster(),
    current,
  ).people.find((person) => person.diet?.includes("Gluten free"));
  const review = {
    personId: reviewedPerson.id,
    sourceSignature: reviewedPerson.sourceSignature,
    status: "reviewed",
    categories: ["vegan", "gluten-free", "allergy"],
    note: "Avoid nuts; prevent cross-contamination",
  };
  const reviewBody = {
    revision: current.revision,
    version: current.version,
    mappings,
    reservedMeals: 13,
    reviews: [review],
  };
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        ...reviewBody,
        reviews: [{ ...review, personId: "attendee:missing" }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        ...reviewBody,
        reviews: [{ ...review, sourceSignature: "obsolete" }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        ...reviewBody,
        reviews: [{ ...review, status: "none" }],
      })
    ).status,
    400,
  );
  assert.equal((await send(cateringPath, "PUT", reviewBody)).status, 200);
  current = await read();
  assert.deepEqual(current.reviews, [review]);
  assert.equal(
    buildCateringRoster(await roster(), current).people.find(
      (person) => person.id === review.personId,
    ).review.note,
    review.note,
  );
  const encryptedReviewRow = (
    await runSql(
      "SELECT catering_reviews_ciphertext, catering_reviews_iv FROM attendee_roster WHERE id = 1",
    )
  )[0];
  assert.ok(encryptedReviewRow.catering_reviews_ciphertext);
  assert.doesNotMatch(
    JSON.stringify(encryptedReviewRow),
    /Avoid nuts|Gluten free|personId/,
  );
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        revision: current.revision,
        version: current.version,
        mappings,
      })
    ).status,
    200,
  );
  current = await read();
  assert.deepEqual(
    current.reviews,
    [review],
    "Old clients preserve manual reviews",
  );

  assert.equal(
    (
      await send("/api/admin/attendees", "POST", {
        source: "tito",
        revision: 1,
        attendees: [{ ...input, diet: "Dairy free" }],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await send(cateringPath, "PUT", {
        revision: current.revision,
        version: current.version,
        mappings,
      })
    ).status,
    409,
    "A changed source snapshot needs review before save",
  );
  current = await read();
  assert.deepEqual(
    current.mappings,
    mappings,
    "Reimports preserve dinner links",
  );
  assert.equal(
    buildCateringRoster(await roster(), current).people.find(
      (person) => person.id === review.personId,
    ).review,
    undefined,
  );
  assert.deepEqual(
    buildCateringRoster(await roster(), current).people.find(
      (person) => person.id === review.personId,
    ).staleReview,
    review,
    "Reimported dietary answers require fresh review",
  );
  assert.equal(
    current.reservedMeals,
    13,
    "Meal reserves survive registration reimports",
  );
  assert.match(
    buildCateringRoster(await roster(), current).people.find((person) =>
      person.diet?.includes("Dairy free"),
    ).diet,
    /Private nut allergy/,
  );

  // Changing dinner attendance retains food details and does not cancel daytime catering.
  const dinnerItems = await (await send("/api/admin/speaker-dinner")).json();
  const mo = dinnerItems.speakers.find(
    (item) => item.speaker_id === "mo-khazali",
  );
  assert.equal(
    (
      await send(
        "/api/admin/speaker-dinner/attendance",
        "POST",
        {
          speaker_id: "mo-khazali",
          revision: mo.dinner_revision,
          attendance: "not_attending",
        },
        { "x-admin-action": "manage-speaker-dinner-attendance" },
      )
    ).status,
    200,
  );
  current = await read();
  assert.match(
    current.sources.find((source) => source.id === "speaker:mo-khazali").diet,
    /Private nut allergy/,
  );
  assert.equal(
    summarizeAttendeeDiets(buildCateringRoster(await roster(), current).people)
      .active,
    sources + 1,
  );

  await send("/api/admin/attendees/access", "POST", {
    action: "create",
    label: "Desk",
  });
  const access = await (await send("/api/admin/attendees/access")).json();
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
  const cookie = session.headers.get("set-cookie").split(";", 1)[0];
  assert.equal(
    (await send(cateringPath, "GET", undefined, { authorization: "", cookie }))
      .status,
    401,
  );
  assert.doesNotMatch(
    await (
      await send("/api/registration/attendees", "GET", undefined, {
        authorization: "",
        cookie,
      })
    ).text(),
    /Private nut allergy|Lactose free|diet|catering|sources/,
  );

  // Removing the source removes its dietary information from the combined view.
  const purge = new URLSearchParams();
  purge.set("confirmation", "DELETE");
  assert.equal(
    (
      await worker.fetch(origin + "/api/admin/speaker-dinner/purge", {
        method: "POST",
        headers: {
          authorization: receiptAdmin,
          origin,
          "x-admin-action": "purge-speaker-dinner-data",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: purge.toString(),
      })
    ).status,
    200,
  );
  current = await read();
  assert.ok(current.sources.every((source) => source.kind === "speaker"));
  assert.deepEqual(
    current.reviews,
    [],
    "Purging dinner data also removes retained manual dietary notes",
  );
  assert.ok(current.sources.every((source) => !source.diet));
  assert.equal(
    summarizeAttendeeDiets(buildCateringRoster(await roster(), current).people)
      .active,
    sources,
  );
});
