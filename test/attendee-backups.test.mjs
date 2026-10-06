import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { backupAttendees } from "../worker/backups.ts";
import { decryptText, encryptText } from "../worker/form-utils.ts";

test("attendee backups preserve encrypted roster and arrival history, omit credentials, and deduplicate snapshots", async (t) => {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-04-30",
    d1Databases: ["INTERESTS"],
    r2Buckets: ["INTEREST_BACKUPS"],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS"),
    bucket = await mf.getR2Bucket("INTEREST_BACKUPS");
  await db
    .prepare(
      "CREATE TABLE organizer_data_changes (table_name TEXT, operation TEXT)",
    )
    .run();
  const migration = (
    await Promise.all(
      [
        "0023_create_attendee_registration.sql",
        "0025_add_attendee_catering_mappings.sql",
        "0027_add_catering_meal_reserve.sql",
      ].map((file) => readFile(`migrations/${file}`, "utf8")),
    )
  ).join("\n");
  for (const sql of migration
    .split(/;\s*\n/u)
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  const key = "attendee-backup-test-key";
  const privateRoster = JSON.stringify([
    { name: "Private contact details", diet: "Private allergy response" },
  ]);
  const encrypted = await encryptText(privateRoster, key);
  const mappings = JSON.stringify([
    { sourceId: "dinner-guest:private", target: "organizer:private" },
  ]);
  const encryptedMappings = await encryptText(mappings, key);
  await db
    .prepare(
      "UPDATE attendee_roster SET ciphertext = ?, iv = ?, revision = 1, catering_ciphertext = ?, catering_iv = ?, catering_revision = 1, catering_reserved_meals = 13 WHERE id = 1",
    )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      encryptedMappings.ciphertext,
      encryptedMappings.iv,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO registration_access_grants (id, label, token_hash, token_ciphertext, token_iv, created_at) VALUES ('staff-id', 'Private staff label', 'private-token-hash', 'private-token-ciphertext', 'iv', '2026-10-02T00:00:00Z')",
    )
    .run();
  const env = { INTERESTS: db, INTEREST_BACKUPS: bucket };
  await backupAttendees(env);
  const first = await (await bucket.get("attendees/latest.json")).json();
  assert.equal((await bucket.list()).objects.length, 2);
  await backupAttendees(env);
  assert.equal(
    (await bucket.list()).objects.length,
    2,
    "Unchanged state creates no additional snapshots",
  );
  await db
    .prepare(
      "INSERT INTO attendee_arrivals (attendee_id, arrived_at, arrived_by) VALUES ('attendee-id', '2026-10-02T06:00:00Z', 'grant:staff-id')",
    )
    .run();
  await backupAttendees(env);
  const second = await (await bucket.get("attendees/latest.json")).json();
  assert.notEqual(second.key, first.key);
  assert.ok(
    await bucket.head(first.key),
    "Previous snapshots survive later changes",
  );
  const snapshot = await (await bucket.get(second.key)).json();
  assert.equal(snapshot.rows.roster[0].ciphertext, encrypted.ciphertext);
  assert.equal(
    await decryptText(
      snapshot.rows.roster[0].ciphertext,
      snapshot.rows.roster[0].iv,
      key,
    ),
    privateRoster,
  );
  assert.equal(snapshot.rows.arrivals[0].attendee_id, "attendee-id");
  assert.equal(snapshot.rows.roster[0].catering_revision, 1);
  assert.equal(snapshot.rows.roster[0].catering_reserved_meals, 13);
  assert.equal(
    await decryptText(
      snapshot.rows.roster[0].catering_ciphertext,
      snapshot.rows.roster[0].catering_iv,
      key,
    ),
    mappings,
  );
  assert.equal(snapshot.rows.history[0].action, "arrived");
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /Private contact|Private allergy response|Private staff label|private-token|dinner-guest:private|organizer:private/,
  );
});
