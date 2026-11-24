import assert from "node:assert/strict";
import test from "node:test";
import {
  createSmtpSender,
  createTurnstileVerifier,
} from "@sdlcai/event-toolkit/providers";

test("the SMTP adapter forwards plain-text mail through the configured sender", async (t) => {
  const { default: mailer } = await import("nodemailer");
  const deliveries = [];
  t.mock.method(mailer, "createTransport", (url) => {
    assert.equal(url, "smtp://mail.example.test");
    return {
      async sendMail(message) {
        deliveries.push(message);
        return { messageId: "fixture-id" };
      },
    };
  });
  const from = "organizer@example.test";
  const send = await createSmtpSender({
    url: "smtp://mail.example.test",
    from,
  });
  const message = {
    to: "guest@example.test",
    subject: "Arrival",
    text: "The doors open at nine.",
  };
  assert.deepEqual(await send(message), { id: "fixture-id" });
  assert.deepEqual(deliveries, [{ from, ...message }]);
});

test("the Turnstile adapter checks provider acceptance, action and the configured origin", async (t) => {
  let origin;
  const verify = createTurnstileVerifier({
    secret: "fixture-secret",
    publicOrigin: () => origin,
  });
  const result = {
    success: true,
    action: "feedback_respond",
    hostname: "forms.example.test",
  };
  let status = 200;
  const request = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("secret"), "fixture-secret");
    assert.equal(options.body.get("response"), "fixture-response");
    return Response.json(result, { status });
  });
  const input = { action: "feedback_respond", token: "fixture-response" };
  assert.equal(await verify(input), false);
  origin = "https://forms.example.test";
  assert.equal(await verify({ ...input, token: undefined }), false);
  assert.equal(request.mock.callCount(), 0);
  assert.equal(await verify(input), true);
  assert.equal(
    await verify({ ...input, action: "newsletter_subscribe" }),
    false,
  );
  origin = "https://another.example.test";
  assert.equal(await verify(input), false);
  origin = "https://forms.example.test";
  result.success = false;
  assert.equal(await verify(input), false);
  status = 503;
  assert.equal(await verify(input), false);
});
