import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import { defaultSettings } from "../site/scripts/badge-model.ts";
test("organizers seed the homepage while badge selection stays private; badge lists encrypt and reject stale writes", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const send = (route, method = "GET", body, extra = {}) =>
    worker.fetch(`${origin}/api/admin/${route}`, {
      method,
      headers: {
        authorization: receiptAdmin,
        origin,
        "content-type": "application/json",
        "x-admin-action": `manage-${route}`,
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  for (const route of ["organizers", "badges"]) {
    assert.equal(
      (await worker.fetch(`${origin}/api/admin/${route}`)).status,
      401,
    );
    const page = await worker.fetch(`${origin}/admin/${route}/`, {
      headers: { authorization: receiptAdmin },
    });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
  }
  let response = await send("organizers");
  const people = (await response.json()).organizers;
  assert.equal(people.length, 9);
  assert.ok(people.every((p) => !p.badge && p.visible));
  const person = people[0];
  const update = {
    ...person,
    name: "Badge <test> person",
    visible: true,
    badge: true,
  };
  assert.equal(
    (
      await send("organizers", "PUT", update, {
        origin: "https://elsewhere.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await send("organizers", "PUT", {
        ...update,
        photo: "javascript:alert(1)",
      })
    ).status,
    400,
  );
  response = await send("organizers", "PUT", update);
  assert.equal(response.status, 200);
  assert.equal((await send("organizers", "PUT", update)).status, 409);
  const homepage = await worker.fetch(`${origin}/`);
  const html = await homepage.text();
  assert.match(html, /Badge &lt;test&gt; person/);
  assert.doesNotMatch(html, /Badge <test>/);
  assert.equal(homepage.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await send("organizers", "PUT", {
        ...update,
        revision: 2,
        visible: false,
      })
    ).status,
    200,
  );
  assert.doesNotMatch(
    await (await worker.fetch(`${origin}/`)).text(),
    /Badge &lt;test&gt; person/,
  );
  const badge = {
    id: "test-id",
    name: "Private attendee",
    company: "Example",
    email: "private@example.test",
    role: "attendee",
    source: "tito.csv / row 2",
    included: true,
    duplicateReviewed: false,
  };
  const payload = {
    revision: 0,
    workspace: { people: [badge], settings: defaultSettings },
  };
  assert.equal(
    (await send("badges", "PUT", payload, { "x-admin-action": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (
      await send("badges", "PUT", {
        ...payload,
        workspace: {
          people: [badge],
          settings: { ...defaultSettings, diameter: 999 },
        },
      })
    ).status,
    400,
  );
  const writes = await Promise.all([
    send("badges", "PUT", payload),
    send("badges", "PUT", payload),
  ]);
  assert.deepEqual(writes.map((r) => r.status).sort(), [200, 409]);
  const saved = await (await send("badges")).json();
  assert.deepEqual(saved.workspace, payload.workspace);
  assert.equal(saved.revision, 1);
  const rows = await runSql("SELECT * FROM badge_workspace");
  assert.doesNotMatch(
    JSON.stringify(rows),
    /Private attendee|private@example|tito.csv/,
  );
  assert.equal(
    (await send("organizers", "DELETE", { id: person.id, revision: 2 })).status,
    409,
  );
  assert.equal(
    (await send("organizers", "DELETE", { id: person.id, revision: 3 })).status,
    200,
  );
  assert.equal((await send("organizers")).status, 200);
});
