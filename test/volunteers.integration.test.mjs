import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("volunteers stay admin-only and support encrypted CRUD with stale edit protection", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql, cookies } = fixture;
  const endpoint = `${origin}/api/admin/volunteers`;
  const headers = {
    authorization: receiptAdmin,
    origin,
    "x-admin-action": "manage-volunteers",
  };
  const send = (path = "", method = "GET", values) =>
    worker.fetch(endpoint + path, {
      method,
      headers,
      ...(values ? { body: new URLSearchParams(values) } : {}),
    });
  const details = {
    name: "Test Volunteer",
    email: "volunteer@example.test",
    task: "Welcome desk",
  };

  assert.equal((await worker.fetch(endpoint)).status, 401);
  assert.equal(
    (
      await worker.fetch(endpoint, {
        headers: { cookie: cookies.get("mo-khazali") },
      })
    ).status,
    401,
  );
  const privatePage = await worker.fetch(`${origin}/admin/volunteers/`, {
    redirect: "manual",
    headers: { accept: "text/html" },
  });
  assert.equal(privatePage.status, 303);
  const page = await worker.fetch(`${origin}/admin/volunteers/`, { headers });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("x-robots-tag"), /noindex/);
  assert.match(await page.text(), /data-volunteer-form/);

  for (const mutationHeaders of [
    { authorization: receiptAdmin, origin },
    { ...headers, origin: "https://other.example" },
  ]) {
    assert.equal(
      (
        await worker.fetch(endpoint, {
          method: "POST",
          headers: mutationHeaders,
          body: new URLSearchParams(details),
        })
      ).status,
      403,
    );
  }
  for (const invalid of [
    { ...details, name: " " },
    { ...details, email: "invalid" },
    { ...details, task: "x".repeat(2001) },
  ]) {
    assert.equal((await send("", "POST", invalid)).status, 400);
  }
  assert.equal(
    (await send("", "POST", { ...details, task: "x".repeat(17000) })).status,
    413,
  );
  assert.equal((await send("", "PATCH", details)).status, 405);
  const created = await send("", "POST", details);
  assert.equal(created.status, 201);
  const { volunteer } = await created.json();
  const path = `/${volunteer.id}`;
  assert.equal(volunteer.revision, 1);
  const stored = await runSql("SELECT * FROM volunteers");
  assert.equal(stored.length, 1);
  assert.doesNotMatch(
    JSON.stringify(stored),
    /Test Volunteer|volunteer@example|Welcome desk/,
  );
  const listing = await send();
  assert.equal(listing.headers.get("cache-control"), "no-store");
  assert.deepEqual((await listing.json()).volunteers, [volunteer]);
  const updated = await send(path, "PUT", {
    ...details,
    name: "Updated Volunteer",
    task: "",
    revision: "1",
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).volunteer.revision, 2);
  assert.equal(
    (await send(path, "PUT", { ...details, revision: "1" })).status,
    409,
  );
  assert.equal((await send(path, "DELETE", { revision: "1" })).status, 409);
  const saved = (await (await send()).json()).volunteers[0];
  assert.equal(saved.name, "Updated Volunteer");
  assert.equal(saved.task, "");
  assert.equal((await send(path, "DELETE", { revision: "2" })).status, 200);
  assert.deepEqual((await (await send()).json()).volunteers, []);
  assert.equal(
    (await send(path, "PUT", { ...details, revision: "2" })).status,
    409,
  );
});
