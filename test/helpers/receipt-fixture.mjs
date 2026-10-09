import { createWorkerFixture } from "./worker-fixture.mjs";

export const receiptOrigin = "https://sdlcai.org";
export const receiptAdmin = `Basic ${Buffer.from("receipts-admin:local-receipts-test").toString("base64")}`;
const keyMaterial = "isolated-receipt-test-encryption";

export async function createReceiptFixture({ vars = {} } = {}) {
  const fixture = await createWorkerFixture({
    vars: {
      ADMIN_USERNAME: "receipts-admin",
      ADMIN_PASSWORD: "local-receipts-test",
      EMAIL_ENCRYPTION_KEY: keyMaterial,
      PUBLIC_SITE_ORIGIN: receiptOrigin,
      SPEAKER_CONTACT_RETENTION_UNTIL: "2099-11-30T21:59:59Z",
      SPEAKER_WORKSPACE_ACCESS_UNTIL: "2099-10-31T21:59:59Z",
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      SHOW_INTEREST_FORM: "",
      ...vars,
    },
  });
  const { worker, runSql } = fixture;
  try {
    const tokens = new Map();
    for (const [index, speakerId] of [
      "mo-khazali",
      "ohans-emmanuel",
    ].entries()) {
      const token = Buffer.alloc(32, index + 41).toString("base64url");
      tokens.set(speakerId, token);
      const email = `${speakerId}@example.test`;
      const key = await importKey("email-encryption", "AES-GCM", ["encrypt"]);
      const iv = new Uint8Array(12).fill(index + 1);
      const encrypted = Buffer.from(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(email),
        ),
      ).toString("base64");
      const hash = await hmac(token, "speaker-workspace-invite-token");
      await runSql(`INSERT INTO speaker_contacts (speaker_id, email_ciphertext, email_iv, email_fingerprint, retention_until, created_at, updated_at)
        VALUES ('${speakerId}', '${encrypted}', '${Buffer.from(iv).toString("base64")}', '${await hmac(email, "email-hash")}', '2099-11-30T21:59:59Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
        INSERT INTO speaker_workspace_access (speaker_id, invite_token_hash, access_generation, invite_created_at, invite_expires_at, created_at, updated_at)
        VALUES ('${speakerId}', '${hash}', 1, '2026-09-01T00:00:00Z', '2099-10-31T21:59:59Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');`);
    }
    const cookies = new Map();
    for (const [speakerId, token] of tokens) {
      const response = await worker.fetch(
        `${receiptOrigin}/api/speaker/session`,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
      );
      if (response.status !== 200)
        throw new Error(`Unable to create fixture session: ${response.status}`);
      cookies.set(
        speakerId,
        response.headers.get("set-cookie").split(";", 1)[0],
      );
    }
    return {
      ...fixture,
      cookies,
    };
  } catch (error) {
    await fixture.dispose();
    throw error;
  }
}

async function importKey(purpose, algorithm, usages) {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${keyMaterial}`),
  );
  return crypto.subtle.importKey("raw", derived, algorithm, false, usages);
}
async function hmac(value, purpose) {
  const key = await importKey(purpose, { name: "HMAC", hash: "SHA-256" }, [
    "sign",
  ]);
  return Buffer.from(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  ).toString("base64");
}
