import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("travel receipts stay private, round-trip exactly, and survive workspace expiry", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const cookie = cookies.get("mo-khazali");
  const otherCookie = cookies.get("ohans-emmanuel");
  const bytes = await readFile(
    "assets/social/exports/sdlcai-2026-facebook.png",
  );
  const headers = { cookie, origin };
  const adminHeaders = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "manage-speaker-receipts",
  };
  const admin = (route, method = "GET", body) =>
    worker.fetch(`${origin}/api/admin/receipts${route}`, {
      method,
      headers: adminHeaders,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const upload = async (overrides = {}, uploadHeaders = headers) => {
    const form = new FormData();
    form.set(
      "file",
      new File([bytes], "Receipt – train.png", { type: "image/png" }),
    );
    for (const [field, value] of Object.entries({
      description: "Return train to Espoo",
      amount: "85,50",
      currency: "eur",
      expense_date: "2026-10-13",
      note: "Return journey",
      ...overrides,
    }))
      form.set(field, value);
    return postForm(
      worker,
      `${origin}/api/speaker/receipts`,
      form,
      uploadHeaders,
    );
  };
  for (const route of [
    "/api/speaker/receipts",
    "/api/admin/receipts",
    "/api/admin/receipts.csv",
  ]) {
    const response = await worker.fetch(`${origin}${route}`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const empty = await worker.fetch(`${origin}/api/speaker/receipts`, {
    headers,
  });
  assert.equal((await empty.json()).enabled, false);
  assert.equal((await upload()).status, 403);
  const forbiddenAccess = await worker.fetch(
    `${origin}/api/admin/receipts/access`,
    {
      method: "POST",
      headers: { ...adminHeaders, origin: "https://attacker.example" },
      body: JSON.stringify({ speaker_id: "mo-khazali", enabled: true }),
    },
  );
  assert.equal(forbiddenAccess.status, 403);
  assert.equal(
    (
      await admin("/access", "POST", {
        speaker_id: "mo-khazali",
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await upload({}, { cookie, origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal((await upload({ amount: "0" })).status, 400);
  assert.equal((await upload({ expense_date: "2026-02-30" })).status, 400);
  assert.equal((await upload({ currency: "EURO" })).status, 400);
  assert.equal(
    (
      await upload({
        file: new File(["<svg onload='alert(1)'/>"], "receipt.png", {
          type: "image/png",
        }),
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await upload({
        file: new File(
          [new Uint8Array(10 * 1024 * 1024 + 20_000)],
          "huge.png",
          { type: "image/png" },
        ),
      })
    ).status,
    413,
  );
  const submission = await upload();
  assert.equal(submission.status, 201, await submission.clone().text());
  const { receipt_id: id } = await submission.json();
  const list = await worker.fetch(`${origin}/api/speaker/receipts`, {
    headers,
  });
  const listing = await list.json();
  assert.equal(listing.receipts.length, 1);
  const receipt = listing.receipts[0];
  assert.equal(receipt.amount, "85.50");
  assert.equal(receipt.currency, "EUR");
  assert.equal(receipt.revision, 1);
  assert.doesNotMatch(JSON.stringify(listing), /object_key|ciphertext|\.enc/u);
  const stored = (
    await runSql(
      `SELECT * FROM speaker_travel_receipts WHERE receipt_id = '${id}'`,
    )
  )[0];
  assert.doesNotMatch(
    JSON.stringify(stored),
    /Return train|Return journey|Receipt – train|85.50/u,
  );

  const download = await worker.fetch(`${origin}${receipt.download_url}`, {
    headers,
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.match(download.headers.get("content-disposition"), /^attachment;/u);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.equal(
    (await worker.fetch(`${origin}${receipt.download_url}`)).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${receipt.download_url}`, {
        headers: { cookie: otherCookie },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}/api/speaker/receipts/${id}`, {
        method: "DELETE",
        headers: {
          cookie: otherCookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ revision: 1 }),
      })
    ).status,
    404,
  );
  const otherListing = await worker.fetch(`${origin}/api/speaker/receipts`, {
    headers: { cookie: otherCookie },
  });
  assert.equal((await otherListing.json()).receipts.length, 0);

  assert.equal(
    (
      await admin("/access", "POST", {
        speaker_id: "mo-khazali",
        enabled: false,
      })
    ).status,
    200,
  );
  assert.equal((await upload()).status, 403);
  assert.equal(
    (await worker.fetch(`${origin}${receipt.download_url}`, { headers }))
      .status,
    200,
  );
  assert.equal(
    (
      await admin(`/${id}`, "PATCH", {
        revision: 1,
        status: "processed",
        organizer_note: "Handled after the event",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await admin(`/${id}`, "PATCH", {
        revision: 1,
        status: "submitted",
        organizer_note: "stale",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}/api/speaker/receipts/${id}`, {
        method: "DELETE",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ revision: 2 }),
      })
    ).status,
    409,
  );
  const processed = (await (await admin("")).json()).receipts[0];
  assert.equal(processed.status, "processed");
  assert.ok(processed.processed_at);
  assert.equal(processed.organizer_note, "Handled after the event");
  assert.deepEqual(
    Buffer.from(await (await admin(`/${id}/download`)).arrayBuffer()),
    bytes,
  );

  // Expiring/removing workspace contact data cannot cascade into receipts.
  await runSql("DELETE FROM speaker_contacts WHERE speaker_id = 'mo-khazali'");
  assert.equal(
    (await worker.fetch(`${origin}/api/speaker/receipts`, { headers })).status,
    401,
  );
  assert.equal((await (await admin("")).json()).receipts.length, 1);
  assert.equal((await admin(`/${id}/download`)).status, 200);
  const csv = await admin(".csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /attachment/u);
  assert.match(await csv.text(), /"85.50","EUR","processed"/u);
  assert.equal((await admin(`/${id}`, "DELETE", { revision: 2 })).status, 200);
  assert.equal((await admin(`/${id}/download`)).status, 404);
  assert.equal(
    (await runSql("SELECT COUNT(*) AS count FROM speaker_travel_receipts"))[0]
      .count,
    0,
  );
});

test("receipt quota is atomic and speaker corrections cannot remove processed records", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const cookie = cookies.get("mo-khazali");
  const adminHeaders = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "manage-speaker-receipts",
  };
  await worker.fetch(`${origin}/api/admin/receipts/access`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ speaker_id: "mo-khazali", enabled: true }),
  });
  const submit = async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(["%PDF-1.4\nreceipt\n%%EOF"], "train.pdf", {
        type: "application/pdf",
      }),
    );
    for (const [field, value] of Object.entries({
      description: '=HYPERLINK("https://example.test")',
      amount: "45.123",
      currency: "EUR",
      expense_date: "2026-10-13",
      note: "+formula",
    }))
      form.set(field, value);
    return postForm(worker, `${origin}/api/speaker/receipts`, form, {
      cookie,
      origin,
    });
  };
  const created = await submit();
  assert.equal(created.status, 201);
  const { receipt_id: id } = await created.json();
  const csv = await worker.fetch(`${origin}/api/admin/receipts.csv`, {
    headers: adminHeaders,
  });
  const csvText = await csv.text();
  assert.match(csvText, /"'=HYPERLINK/u);
  assert.match(csvText, /"'\+formula"/u);
  // Fill 28 additional slots in storage, then race two valid uploads for one.
  await runSql(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n < 28)
    INSERT INTO speaker_travel_receipts (receipt_id, speaker_id, object_key, byte_size, details_ciphertext, created_at, updated_at)
    SELECT 'quota-' || n, 'mo-khazali', 'quota-' || n, 1, 'fixture', '2026-10-13', '2026-10-13' FROM numbers;`);
  const raced = await Promise.all([submit(), submit()]);
  assert.deepEqual(raced.map((response) => response.status).sort(), [201, 409]);
  await runSql(
    "DELETE FROM speaker_travel_receipts WHERE receipt_id LIKE 'quota-%'",
  );
  const removal = await worker.fetch(`${origin}/api/speaker/receipts/${id}`, {
    method: "DELETE",
    headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ revision: 1 }),
  });
  assert.equal(removal.status, 200);
  assert.equal(
    (
      await worker.fetch(`${origin}/api/speaker/receipts/${id}/download`, {
        headers: { cookie },
      })
    ).status,
    404,
  );
});

// Send browser-style multipart bodies over HTTP; Wrangler's fetch adapter
// uses a different FormData implementation from the Node test runner.
async function postForm(worker, url, form, headers) {
  const local = new URL(
    new URL(url).pathname,
    `http://${worker.address}:${worker.port}`,
  );
  return fetch(local, {
    method: "POST",
    headers: {
      ...headers,
      origin: headers.origin === origin ? local.origin : headers.origin,
    },
    body: form,
  });
}
