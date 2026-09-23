import assert from "node:assert/strict";
import test from "node:test";

import {
  handleStreamWebhookRequest,
  verifyWebhookSignature,
} from "../worker/speaker-videos.ts";

test("Stream webhook verification binds timestamp and exact body bytes", async () => {
  const secret = "local-stream-webhook-secret";
  const timestamp = 1_800_000_000;
  const body = new TextEncoder().encode(
    '{"uid":"0123456789abcdef0123456789abcdef","readyToStream":true}\n',
  );
  const signature = await sign(timestamp, body, secret);
  const header = `time=${timestamp},sig1=${signature}`;

  assert.equal(
    await verifyWebhookSignature(body, header, secret, timestamp),
    true,
  );
  assert.equal(
    await verifyWebhookSignature(
      new TextEncoder().encode(
        '{"uid":"0123456789abcdef0123456789abcdef","readyToStream":true}',
      ),
      header,
      secret,
      timestamp,
    ),
    false,
  );
  assert.equal(
    await verifyWebhookSignature(body, header, secret, timestamp + 5 * 60 + 1),
    false,
  );
  assert.equal(
    await verifyWebhookSignature(body, header, "wrong-secret", timestamp),
    false,
  );
});

test("signed Stream webhook bodies require a valid UID and status object", async () => {
  const secret = "local-stream-webhook-secret";
  const timestamp = Math.floor(Date.now() / 1_000);
  const env = {
    STREAM_WEBHOOK_SECRET: secret,
    INTERESTS: {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    },
  };

  async function send(payload) {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    return handleStreamWebhookRequest(
      new Request("https://sdlcai.org/api/stream/webhook", {
        method: "POST",
        headers: {
          "webhook-signature": `time=${timestamp},sig1=${await sign(timestamp, body, secret)}`,
        },
        body,
      }),
      env,
    );
  }

  const uid = "0123456789abcdef0123456789abcdef";
  assert.equal((await send({ uid, status: "ready" })).status, 400);
  assert.equal((await send({ uid: "short", status: {} })).status, 400);
  assert.equal((await send({ uid, status: { state: "ready" } })).status, 204);
});

async function sign(timestamp, body, secret) {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const source = new Uint8Array(prefix.length + body.length);
  source.set(prefix);
  source.set(body, prefix.length);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, source),
  );
  return [...signature]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
