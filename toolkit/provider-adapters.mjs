export async function createSmtpSender({ url, from }) {
  if (!url || !from)
    throw new Error("An SMTP URL and sender address are required.");
  const { default: mailer } = await import("nodemailer");
  const transport = mailer.createTransport(url);
  return async function sendMail({ to, subject, text }) {
    const sent = await transport.sendMail({ from, to, subject, text });
    return { id: sent.messageId };
  };
}

export function createTurnstileVerifier({ secret, publicOrigin }) {
  if (!secret) throw new Error("A Turnstile secret is required.");
  return async function verifyChallenge({ action, token }) {
    const origin =
      typeof publicOrigin === "function" ? publicOrigin() : publicOrigin;
    if (!token || !origin) return false;
    const result = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!result.ok) return false;
    const check = await result.json();
    return (
      check.success === true &&
      check.action === action &&
      check.hostname === new URL(origin).hostname
    );
  };
}
