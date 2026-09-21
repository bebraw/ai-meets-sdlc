import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  sendPosterReviewDigest,
  sendDataChangeDigest,
  dataChangeDigestWeek,
} from "../worker/organizer-digests.ts";
import { importAesKey, encryptTextWithKey } from "../worker/form-utils.ts";

const monday = new Date("2026-09-21T06:00:00Z");
const later = (hours) => new Date(monday.getTime() + hours * 3600000);
const migrations = await Promise.all(
  (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFile(`migrations/${name}`, "utf8")),
);

async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-04-30",
    d1Databases: ["INTERESTS"],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS");
  for (const migration of migrations)
    for (const sql of migration
      .split(/;\s*\n/u)
      .map((s) => s.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  const messages = [];
  const env = {
    INTERESTS: db,
    EMAIL_ENCRYPTION_KEY: "digest-test-key",
    PUBLIC_SITE_ORIGIN: "https://sdlcai.org",
    POSTER_REVIEW_DIGEST_ENABLED: "true",
    DATA_CHANGE_DIGEST_ENABLED: "true",
    EMAIL: {
      send: async (message) => {
        messages.push(message);
        return { messageId: "test-message" };
      },
    },
  };
  const encrypted = await encryptTextWithKey(
    '<script>alert("proposal")</script>',
    await importAesKey(env.EMAIL_ENCRYPTION_KEY),
  );
  async function poster(status = "submitted") {
    await db
      .prepare(
        `INSERT INTO poster_proposals (fingerprint,name_ciphertext,name_iv,email_ciphertext,email_iv,authors_ciphertext,authors_iv,title_ciphertext,title_iv,abstract_ciphertext,abstract_iv,poster_size,terms_text,consent_text,status,created_at,updated_at)
      VALUES (?1,?2,?3,?2,?3,?2,?3,?2,?3,?2,?3,'either','terms','consent',?4,?5,?5)`,
      )
      .bind(
        crypto.randomUUID(),
        encrypted.ciphertext,
        encrypted.iv,
        status,
        monday.toISOString(),
      )
      .run();
  }
  return { db, env, messages, poster };
}

test("weekly scheduling follows Helsinki Mondays including DST and catches up midweek", () => {
  assert.equal(dataChangeDigestWeek(new Date("2026-09-21T05:00Z")), null);
  assert.equal(dataChangeDigestWeek(monday), "2026-09-21");
  assert.equal(
    dataChangeDigestWeek(new Date("2026-09-27T08:00Z")),
    "2026-09-21",
  );
  assert.equal(dataChangeDigestWeek(new Date("2026-10-26T06:00Z")), null);
  assert.equal(
    dataChangeDigestWeek(new Date("2026-10-26T07:00Z")),
    "2026-10-26",
  );
});

test("daily posters include pending states, escape content and stop after final decisions", async (t) => {
  const f = await fixture(t);
  for (const status of [
    "submitted",
    "shortlisted",
    "waitlisted",
    "accepted",
    "declined",
    "withdrawn",
  ])
    await f.poster(status);
  await sendPosterReviewDigest(f.env, later(-1));
  assert.equal(f.messages.length, 0);
  await Promise.all([
    sendPosterReviewDigest(f.env, monday),
    sendPosterReviewDigest(f.env, monday),
  ]);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].subject, /3 poster proposals/);
  assert.match(f.messages[0].text, /https:\/\/sdlcai.org\/admin\/posters\//);
  assert.doesNotMatch(f.messages[0].html, /<script>/);
  assert.match(f.messages[0].html, /&lt;script&gt;/);
  assert.equal(f.messages[0].to, "info@sdlcai.org");
  await sendPosterReviewDigest(f.env, later(24));
  assert.equal(f.messages.length, 2);
  await f.db.prepare("UPDATE poster_proposals SET status = 'accepted'").run();
  await sendPosterReviewDigest(f.env, later(48));
  assert.equal(f.messages.length, 2);
});

test("weekly tracking records additions, edits and deletions and carries later changes forward", async (t) => {
  const f = await fixture(t);
  await f.poster();
  await f.db
    .prepare("UPDATE poster_proposals SET status = 'shortlisted'")
    .run();
  await f.db.prepare("DELETE FROM poster_proposals").run();
  await f.db.prepare("UPDATE schedule_order SET revision = revision + 1").run();
  await Promise.all([
    sendDataChangeDigest(f.env, monday),
    sendDataChangeDigest(f.env, monday),
  ]);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].text, /4 changes/);
  for (const op of ["added", "updated", "deleted"])
    assert.match(f.messages[0].text, new RegExp(`Poster proposals: 1 ${op}`));
  assert.match(f.messages[0].text, /Programme order: 1 updated/);
  assert.doesNotMatch(
    f.messages[0].text,
    /<script>|ciphertext|digest-test-key/,
  );
  await f.poster();
  await sendDataChangeDigest(f.env, later(24));
  assert.equal(f.messages.length, 1);
  await sendDataChangeDigest(f.env, later(168));
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].text, /1 changes/);
  await sendDataChangeDigest(f.env, later(336));
  assert.equal(f.messages.length, 2, "empty weeks are silent");
});

test("failed sends retry after the lease, preserve their cutoff and stop after success", async (t) => {
  const f = await fixture(t);
  await f.poster();
  const send = f.env.EMAIL.send;
  f.env.EMAIL.send = async () => {
    throw new Error("provider failure");
  };
  await assert.rejects(
    sendDataChangeDigest(f.env, monday),
    /later hourly trigger/,
  );
  await f.poster();
  f.env.EMAIL.send = send;
  await sendDataChangeDigest(f.env, monday);
  assert.equal(f.messages.length, 0);
  await sendDataChangeDigest(f.env, later(1));
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].text, /1 changes/);
  await sendDataChangeDigest(f.env, later(2));
  assert.equal(f.messages.length, 1);
  await sendDataChangeDigest(f.env, later(168));
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].text, /1 changes/);
});

test("disabled digests perform no work and empty days are recorded", async (t) => {
  const f = await fixture(t);
  await sendPosterReviewDigest(
    { ...f.env, POSTER_REVIEW_DIGEST_ENABLED: "" },
    monday,
  );
  await sendDataChangeDigest(
    { ...f.env, DATA_CHANGE_DIGEST_ENABLED: "" },
    monday,
  );
  assert.equal(
    (await f.db.prepare("SELECT COUNT(*) AS n FROM organizer_digests").first())
      .n,
    0,
  );
  await sendPosterReviewDigest(f.env, monday);
  await sendDataChangeDigest(f.env, monday);
  assert.equal(f.messages.length, 0);
  assert.equal(
    (
      await f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM organizer_digests WHERE status = 'empty'",
        )
        .first()
    ).n,
    2,
  );
});
