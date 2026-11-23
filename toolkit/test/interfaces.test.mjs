import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolkit } from "../index.mjs";
import { startWeb } from "../http.mjs";

test("HTTP and API share event permissions, schema checks and artifact ownership", async (t) => {
  const kit = createToolkit({ enabled: ["organizer-directory", "schedule"] });
  const a = { role: "organizer", actor: "alice", token: "test-alice" },
    b = { role: "organizer", actor: "bob", token: "test-bob" };
  const web = await startWeb({ toolkit: kit, port: 0, principals: [a, b] });
  t.after(async () => {
    await web.close();
    await kit.close();
  });
  const send = (path, input, token = a.token, origin = web.origin) =>
    fetch(web.origin + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
        origin,
      },
      body: JSON.stringify(input),
    });
  assert.equal(
    (await send("/api/run/organizers_create", { name: "X" }, null)).status,
    403,
  );
  assert.equal(
    (
      await send(
        "/api/run/organizers_create",
        { name: "X" },
        a.token,
        "https://other.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (await send("/api/run/organizers_create", { name: "X", role: "organizer" }))
      .status,
    400,
  );
  assert.equal((await send("/api/run/qa_rooms", {})).status, 404);
  const added = await (
    await send("/api/run/organizers_create", { name: "Alice", visible: true })
  ).json();
  const list = await kit.run(
    "organizers_public",
    {},
    { role: "public", actor: "guest" },
  );
  assert.equal(list.people[0].id, added.data.id);
  const op = kit
    .catalog()
    .flatMap((b) => b.operations)
    .find((o) => o.name === "schedule_render");
  const response = await (await send("/api/run/" + op.name, op.example)).json();
  const artifact = new URL(response.artifact.url, web.origin);
  assert.equal(
    (await fetch(artifact, { headers: { authorization: "Bearer " + b.token } }))
      .status,
    404,
  );
  assert.match(
    await (
      await fetch(artifact, { headers: { authorization: "Bearer " + a.token } })
    ).text(),
    /Field Notes Forum/,
  );
});
