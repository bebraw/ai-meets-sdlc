import type { StripeCheckoutSession } from "../types";
import { hexEncode } from "./encoding";

export async function verifyStripeWebhookSignature({
  payload,
  secret,
  signature,
}: {
  payload: string;
  secret: string;
  signature: string;
}): Promise<boolean> {
  const parts = parseStripeSignature(signature);

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  const now = Math.floor(Date.now() / 1000);

  if (Math.abs(now - parts.timestamp) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = `${parts.timestamp}.${payload}`;
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const expectedSignature = hexEncode(new Uint8Array(signatureBytes));

  return parts.signatures.some((value) =>
    timingSafeEqualHex(value, expectedSignature),
  );
}

export function getOrderStatusFromSession(
  eventType: string | undefined,
  session: StripeCheckoutSession,
): string {
  if (eventType === "checkout.session.expired") return "expired";
  if (eventType === "checkout.session.async_payment_failed") return "failed";
  if (session.payment_status === "paid") return "paid";

  return "pending";
}

export function isStripeCheckoutSession(
  value: unknown,
): value is StripeCheckoutSession {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}

function parseStripeSignature(signature: string): {
  signatures: string[];
  timestamp: number;
} {
  const parsed = signature.split(",").reduce(
    (accumulator, part) => {
      const [key, value] = part.split("=", 2);

      if (key === "t" && value) {
        accumulator.timestamp = Number(value);
      } else if (key === "v1" && value) {
        accumulator.signatures.push(value);
      }

      return accumulator;
    },
    { signatures: [] as string[], timestamp: 0 },
  );

  return Number.isFinite(parsed.timestamp)
    ? parsed
    : { signatures: parsed.signatures, timestamp: 0 };
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
