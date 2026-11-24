import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createToolkit } from "../dist/index.mjs";

test("object inputs reject arrays and class instances, including nested records with no required keys", async (t) => {
  const app = createToolkit();
  t.after(() => app.close());
  const catalog = new Map(
    app
      .catalog()
      .flatMap((block) => block.operations.map((op) => [op.name, op])),
  );
  for (const value of [[], new Date(), new Map()]) {
    await assert.rejects(app.run("qa_rooms", value), { status: 400 });
    await assert.rejects(
      app.run("badges_preflight", {
        ...catalog.get("badges_preflight").example,
        settings: value,
      }),
      { status: 400 },
    );
  }
  await assert.rejects(
    app.run("catering_prepare_brief", {
      eventName: "Field Notes",
      people: [[]],
    }),
    { status: 400 },
  );
  await assert.rejects(
    app.run("feedback_respond", { version: 1, consent: true, answers: [5] }),
    { status: 400 },
  );
  const shape = catalog.get("feedback_respond").inputSchema.properties.answers;
  assert.equal(shape.type, "object");
  assert.equal(shape.maxProperties, 40);
  assert.equal(shape.allOf, undefined);
  assert.deepEqual(await app.run("qa_rooms", Object.create(null)), {
    rooms: [],
  });
  assert.deepEqual(await app.run("qa_rooms", runInNewContext("({})")), {
    rooms: [],
  });
});
