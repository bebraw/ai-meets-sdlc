import assert from "node:assert/strict";
import test from "node:test";
import { backupMailingData } from "../worker/mail-backups.ts";
import { unsubscribeNewsletter } from "../worker/newsletter.ts";
import { encryptText, decryptText, hashText } from "../worker/form-utils.ts";
import { mailingFixture } from "./helpers/mailing-fixture.mjs";

test("mailing snapshots keep encrypted consent and suppression evidence, deduplicate, and expire older copies", async (t) => {
  const f = await mailingFixture(t),
    email = "private@example.test",
    encrypted = await encryptText(email, f.env.EMAIL_ENCRYPTION_KEY);
  const id = crypto.randomUUID();
  await f.db
    .prepare(
      "INSERT INTO newsletter_subscribers(id, email_hash, email_ciphertext, email_iv, status, consent_version, consent_text, requested_at) VALUES(?, ?, ?, ?, 'pending', 'test-v1', 'Consent wording', ?)",
    )
    .bind(
      id,
      await hashText(email, f.env.EMAIL_ENCRYPTION_KEY, "newsletter-address"),
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
    )
    .run();
  await f.db
    .prepare(
      "INSERT INTO attendee_message_preferences(email_hash, unsubscribed_at) VALUES('suppressed-address-hash', ?)",
    )
    .bind(new Date().toISOString())
    .run();
  await f.bucket.put(
    "mailing/snapshots/2000-01-01T00:00:00.000Z.json",
    "old private backup",
  );
  await backupMailingData(f.env);
  assert.equal(
    await f.bucket.head("mailing/snapshots/2000-01-01T00:00:00.000Z.json"),
    null,
  );
  const first = await (await f.bucket.get("mailing/latest.json")).json();
  const snapshot = await (await f.bucket.get(first.key)).json();
  assert.doesNotMatch(JSON.stringify(snapshot), /private@example.test/u);
  const row = snapshot.rows.newsletter_subscribers[0];
  assert.equal(
    await decryptText(
      row.email_ciphertext,
      row.email_iv,
      f.env.EMAIL_ENCRYPTION_KEY,
    ),
    email,
  );
  assert.equal(snapshot.rows.newsletter_consent_events[0].action, "requested");
  assert.equal(
    snapshot.rows.attendee_message_preferences[0].email_hash,
    "suppressed-address-hash",
  );
  await backupMailingData(f.env);
  assert.equal((await f.bucket.list()).objects.length, 2);
  await unsubscribeNewsletter(f.env, id);
  await backupMailingData(f.env);
  const second = await (await f.bucket.get("mailing/latest.json")).json();
  const removed = await (await f.bucket.get(second.key)).json();
  assert.equal(removed.rows.newsletter_subscribers[0].email_ciphertext, null);
  assert.equal(
    removed.rows.newsletter_consent_events[1].action,
    "unsubscribed",
  );
});
