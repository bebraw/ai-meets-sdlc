import test from "node:test";
import assert from "node:assert/strict";
import { createToolkit } from "../dist/index.mjs";

test("programme outputs retain public feed validation, date locality and HTML escaping", async (t) => {
  const kit = createToolkit({ enabled: ["programme-feed", "schedule"] });
  t.after(() => kit.close());
  const [feed, schedule] = kit.catalog().map((b) => b.operations[0]);
  const value = await kit.run(feed.name, feed.example);
  assert.equal(value.feed.revision.length, 64);
  assert.equal(
    JSON.parse(value.artifact.bytes.toString()).revision,
    value.feed.revision,
  );
  assert.equal(
    (await kit.run(feed.name, feed.example)).feed.revision,
    value.feed.revision,
  );
  const wrong = structuredClone(feed.example);
  wrong.sessions[0].speakerIds = ["missing"];
  await assert.rejects(kit.run(feed.name, wrong), /Unknown speaker/);
  const privateRoster = structuredClone(feed.example);
  privateRoster.speakers[0].email = "private@example.org";
  await assert.rejects(kit.run(feed.name, privateRoster), /speakers\.0\.email/);
  const timetable = structuredClone(schedule.example);
  timetable.sessions[0].title = "<Untrusted>";
  const page = await kit.run(schedule.name, timetable);
  assert.match(page.artifact.bytes.toString(), /&lt;Untrusted&gt;/);
  assert.match(page.entries[0].displayTime, /09:00/);
  await assert.rejects(
    kit.run(schedule.name, { ...timetable, timeZone: "Invalid/Zone" }),
  );
});
test("feed inputs validate calendar dates, timestamp offsets and unique speaker references", async (t) => {
  const kit = createToolkit({ enabled: ["programme-feed"] });
  t.after(() => kit.close());
  const [feed] = kit.catalog()[0].operations;
  const input = structuredClone(feed.example);
  input.updatedAt = "2024-02-29t09:00:00.123456+02:00";
  const result = await kit.run(feed.name, input);
  assert.equal(result.feed.updatedAt, input.updatedAt);

  for (const invalid of ["2025-02-29", "2024-02-30T09:00:00Z"]) {
    await assert.rejects(
      kit.run(feed.name, {
        ...input,
        event: { ...input.event, startDate: invalid },
      }),
      /event\.startDate/,
    );
  }
  await assert.rejects(
    kit.run(feed.name, { ...input, updatedAt: "2024-02-29T09:00:00+25:00" }),
    /updatedAt/,
  );
  input.sessions[0].speakerIds.push(input.sessions[0].speakerIds[0]);
  await assert.rejects(kit.run(feed.name, input), /sessions\.0\.speakerIds/);
});
test("catering keeps source answers distinct, applies organizer reviews and counts reserved meals once", async (t) => {
  const kit = createToolkit({ enabled: ["catering"] });
  t.after(() => kit.close());
  const report = await kit.run("catering_prepare_brief", {
    eventName: "Field Day",
    people: [
      { diet: "vegan and gluten free" },
      {
        diet: "Eggs",
        review: {
          status: "clarify",
          categories: ["allergy"],
          note: "Follow up",
        },
      },
      { status: "cancelled", diet: "vegan" },
    ],
    reservedMeals: 3,
  });
  assert.deepEqual(
    [report.active, report.missing, report.cancelled, report.needsReview],
    [5, 3, 1, 1],
  );
  assert.match(report.artifact.bytes.toString(), /Field Day/);
  assert.match(report.artifact.bytes.toString(), /Eggs/);
  assert.doesNotMatch(report.artifact.bytes.toString(), /SDLCAI|Marsio/);
});

test("talk graphics render each bundled typeface and retain the default Noto Sans artwork", async (t) => {
  const kit = createToolkit({ enabled: ["talk-graphics"] });
  t.after(() => kit.close());
  const [
    {
      operations: [operation],
    },
  ] = kit.catalog();
  const render = async (font) => {
    const input = { ...operation.example };
    if (font) input.font = font;
    const { artifact } = await kit.run(operation.name, input);
    return Buffer.from(artifact.bytes);
  };
  const original = await render();
  assert.deepEqual(await render("noto-sans"), original);
  const serif = await render("lora");
  const mono = await render("fira-code");
  assert.ok(
    !original.equals(serif) && !original.equals(mono) && !serif.equals(mono),
  );
});
