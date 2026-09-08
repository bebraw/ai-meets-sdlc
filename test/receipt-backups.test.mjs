import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Miniflare } from "miniflare";
import { backupSpeakerReceipts } from "../worker/receipt-backups.ts";
import { prepareReceiptRestore } from "../scripts/prepare-receipt-restore.mjs";

const latestKey = "travel-receipts/latest.json";
const migration = await readFile(
  "migrations/0013_create_speaker_travel_receipts.sql",
  "utf8",
);

test("receipt backups deduplicate files and snapshots and restore encrypted data", async (t) => {
  const { env, putReceipt, writes, files } = await fixture(t);
  await putReceipt("11111111-1111-4111-8111-111111111111");
  await backupSpeakerReceipts(env);
  const first = await (await env.INTEREST_BACKUPS.get(latestKey)).json();
  const firstWrites = writes.length;
  await backupSpeakerReceipts(env);
  assert.equal(
    writes.length,
    firstWrites,
    "unchanged cron does not write objects",
  );
  await env.INTERESTS.prepare(
    "UPDATE speaker_travel_receipts SET status = 'processed', revision = 2",
  ).run();
  await backupSpeakerReceipts(env);
  const second = await (await env.INTEREST_BACKUPS.get(latestKey)).json();
  assert.notEqual(second.key, first.key);
  assert.equal(
    writes.filter((key) => key.includes("/files/")).length,
    1,
    "status changes reuse ciphertext",
  );
  assert.ok(
    await env.INTEREST_BACKUPS.head(first.key),
    "previous snapshot survives a same-day change",
  );

  await env.INTERESTS.prepare(
    "UPDATE speaker_travel_receipts SET status = 'submitted', revision = 1",
  ).run();
  await backupSpeakerReceipts(env);
  assert.equal(
    (await (await env.INTEREST_BACKUPS.get(latestKey)).json()).key,
    first.key,
  );
  assert.equal(
    (await env.INTEREST_BACKUPS.list({ prefix: "travel-receipts/snapshots/" }))
      .objects.length,
    2,
  );

  const directory = await mkdtemp(path.join(tmpdir(), "receipt-restore-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = await (await env.INTEREST_BACKUPS.get(second.key)).json();
  const snapshotPath = path.join(directory, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  for (const file of snapshot.files) {
    const object = await env.INTEREST_BACKUPS.get(file.backup_key);
    await writeFile(
      path.join(directory, path.basename(file.backup_key)),
      new Uint8Array(await object.arrayBuffer()),
    );
  }
  const output = path.join(directory, "restore");
  assert.deepEqual(
    await prepareReceiptRestore(snapshotPath, directory, output),
    { receipts: 1, files: 1 },
  );
  const restoredDb = new DatabaseSync(":memory:");
  t.after(() => restoredDb.close());
  restoredDb.exec(migration);
  restoredDb.exec(await readFile(path.join(output, "receipts.sql"), "utf8"));
  const restored = restoredDb
    .prepare("SELECT * FROM speaker_travel_receipts")
    .get();
  assert.equal(restored.status, "processed");
  assert.equal(
    restoredDb.prepare("SELECT enabled FROM speaker_receipt_access").get()
      .enabled,
    1,
  );
  assert.deepEqual(
    Buffer.from(restored.details_ciphertext, "base64"),
    files.details,
  );
  const storedFile = await readFile(
    path.join(directory, path.basename(snapshot.files[0].backup_key)),
  );
  assert.deepEqual(storedFile, files.encrypted);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: storedFile.subarray(0, 12),
      additionalData: new TextEncoder().encode(
        `${restored.receipt_id}:${restored.speaker_id}:file`,
      ),
    },
    files.key,
    storedFile.subarray(12),
  );
  assert.equal(Buffer.from(plaintext).toString(), "%PDF-1.7 receipt fixture");

  await writeFile(
    path.join(directory, path.basename(snapshot.files[0].backup_key)),
    "corrupt",
  );
  await assert.rejects(
    prepareReceiptRestore(
      snapshotPath,
      directory,
      path.join(directory, "invalid"),
    ),
    /checksum/,
  );
  snapshot.tables.speaker_travel_receipts[0].revision++;
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  await assert.rejects(
    prepareReceiptRestore(snapshotPath, directory, output),
    /metadata checksum/,
  );
});

test("missing files and failed writes preserve the last complete backup and allow retry", async (t) => {
  const { env, putReceipt } = await fixture(t);
  await putReceipt("11111111-1111-4111-8111-111111111111");
  await backupSpeakerReceipts(env);
  const first = await (await env.INTEREST_BACKUPS.get(latestKey)).text();
  const secondKey = await putReceipt("22222222-2222-4222-8222-222222222222");
  const secondBytes = await (
    await env.SPEAKER_UPLOADS.get(secondKey)
  ).arrayBuffer();
  await env.SPEAKER_UPLOADS.delete(secondKey);
  await assert.rejects(backupSpeakerReceipts(env), /source file is missing/);
  assert.equal(await (await env.INTEREST_BACKUPS.get(latestKey)).text(), first);
  await env.SPEAKER_UPLOADS.put(secondKey, secondBytes);
  const brokenEnv = {
    ...env,
    INTEREST_BACKUPS: wrapBucket(
      env.INTEREST_BACKUPS,
      async (key, value, options) => {
        if (key.includes("/snapshots/"))
          throw new Error("simulated R2 failure");
        return env.INTEREST_BACKUPS.put(key, value, options);
      },
    ),
  };
  await assert.rejects(backupSpeakerReceipts(brokenEnv), /simulated R2/);
  assert.equal(await (await env.INTEREST_BACKUPS.get(latestKey)).text(), first);
  await backupSpeakerReceipts(env);
  assert.equal(
    (await (await env.INTEREST_BACKUPS.get(latestKey)).json()).receipt_count,
    2,
  );
  assert.equal(
    (await env.INTEREST_BACKUPS.list({ prefix: "travel-receipts/files/" }))
      .objects.length,
    2,
  );
});

test("receipt backups exclude deleted files, capture access changes, and support empty tables", async (t) => {
  const { env, putReceipt } = await fixture(t);
  await backupSpeakerReceipts(env);
  assert.equal(
    (await (await env.INTEREST_BACKUPS.get(latestKey)).json()).receipt_count,
    0,
  );
  const key = await putReceipt("11111111-1111-4111-8111-111111111111");
  await env.INTERESTS.prepare(
    "UPDATE speaker_travel_receipts SET status = 'deleted'",
  ).run();
  await env.SPEAKER_UPLOADS.delete(key);
  await backupSpeakerReceipts(env);
  const latest = await (await env.INTEREST_BACKUPS.get(latestKey)).json();
  const snapshot = await (await env.INTEREST_BACKUPS.get(latest.key)).json();
  assert.equal(snapshot.files.length, 0);
  assert.equal(snapshot.tables.speaker_receipt_access[0].enabled, 1);
  await env.INTERESTS.prepare(
    "UPDATE speaker_receipt_access SET enabled = 0",
  ).run();
  await backupSpeakerReceipts(env);
  assert.notEqual(
    (await (await env.INTEREST_BACKUPS.get(latestKey)).json()).key,
    latest.key,
  );
});

test("overlapping receipt exports keep one complete snapshot", async (t) => {
  const { env, putReceipt } = await fixture(t);
  await putReceipt("11111111-1111-4111-8111-111111111111");
  const results = await Promise.allSettled([
    backupSpeakerReceipts(env),
    backupSpeakerReceipts(env),
  ]);
  assert.ok(results.some((result) => result.status === "fulfilled"));
  for (const result of results) {
    if (result.status === "rejected")
      assert.match(result.reason.message, /manifest changed/);
  }
  const latest = await (await env.INTEREST_BACKUPS.get(latestKey)).json();
  const snapshot = await (await env.INTEREST_BACKUPS.get(latest.key)).json();
  for (const file of snapshot.files)
    assert.ok(await env.INTEREST_BACKUPS.head(file.backup_key));
  assert.equal(
    (await env.INTEREST_BACKUPS.list({ prefix: "travel-receipts/snapshots/" }))
      .objects.length,
    1,
  );
  assert.equal(
    (await env.INTEREST_BACKUPS.list({ prefix: "travel-receipts/files/" }))
      .objects.length,
    1,
  );
});

async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-04-30",
    d1Databases: ["INTERESTS"],
    r2Buckets: ["INTEREST_BACKUPS", "SPEAKER_UPLOADS"],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS");
  for (const sql of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  const backupBucket = await mf.getR2Bucket("INTEREST_BACKUPS");
  const uploads = await mf.getR2Bucket("SPEAKER_UPLOADS");
  const writes = [];
  const env = {
    INTERESTS: db,
    SPEAKER_UPLOADS: uploads,
    INTEREST_BACKUPS: wrapBucket(backupBucket, async (key, value, options) => {
      const result = await backupBucket.put(key, value, options);
      if (result) writes.push(key);
      return result;
    }),
  };
  const files = {};
  async function putReceipt(id) {
    const speaker = "mo-khazali";
    const objectKey = `travel-receipts/${speaker}/${id}.enc`;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const encrypt = async (value, context) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(context),
        },
        key,
        Buffer.from(value),
      );
      return Buffer.concat([iv, Buffer.from(encrypted)]);
    };
    const plaintext = "%PDF-1.7 receipt fixture";
    const encrypted = await encrypt(plaintext, `${id}:${speaker}:file`);
    const details = await encrypt(
      JSON.stringify({ filename: "train.pdf", amount: "85.50" }),
      `${id}:${speaker}:details`,
    );
    Object.assign(files, { encrypted, details, key });
    await uploads.put(objectKey, Uint8Array.from(encrypted).buffer);
    await db
      .prepare(
        "INSERT INTO speaker_travel_receipts (receipt_id, speaker_id, object_key, byte_size, details_ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        speaker,
        objectKey,
        Buffer.byteLength(plaintext),
        details.toString("base64"),
        "2026-09-08T00:00:00Z",
        "2026-09-08T00:00:00Z",
      )
      .run();
    await db
      .prepare(
        "INSERT OR REPLACE INTO speaker_receipt_access (speaker_id, enabled, updated_at) VALUES (?, 1, ?)",
      )
      .bind(speaker, "2026-09-08T00:00:00Z")
      .run();
    return objectKey;
  }
  return { env, writes, putReceipt, files };
}

function wrapBucket(bucket, put) {
  return {
    get: (...args) => bucket.get(...args),
    head: (...args) => bucket.head(...args),
    list: (...args) => bucket.list(...args),
    put,
  };
}
