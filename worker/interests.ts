import {
  jsonResponse,
  readFormDataWithinLimit,
  normalizeEmail,
  normalizeOptionalText,
  getTurnstileToken,
  isLikelyEmail,
  getTurnstileConfigurationError,
  turnstileAction,
  getExpectedTurnstileHostnames,
  hashEmail,
  encryptText,
  decryptText,
  formatCsvValue,
} from "./form-utils.ts";
import { verifyTurnstile } from "./turnstile.ts";

interface InterestContact {
  created_at: string;
  email: string;
  name: string;
  organization: string;
}

const maxInterestBodyBytes = 16 * 1024;

export async function handleInterest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Interest storage is not configured" }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured" }, 503);
  }

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxInterestBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  const formData = formDataResult;
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeOptionalText(formData.get("name"), 120);
  const organization = normalizeOptionalText(formData.get("organization"), 160);
  const consent = formData.get("consent") === "yes";
  const turnstileToken = getTurnstileToken(formData);

  if (!email || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (!consent) {
    return jsonResponse({ error: "Consent is required" }, 400);
  }

  const turnstileConfigurationError = getTurnstileConfigurationError(env);

  if (turnstileConfigurationError) return turnstileConfigurationError;

  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileOutcome = await verifyTurnstile({
      expectedAction: turnstileAction,
      expectedHostnames: getExpectedTurnstileHostnames(env),
      request,
      secret: env.TURNSTILE_SECRET_KEY,
      token: turnstileToken,
    });

    if (!turnstileOutcome.success) {
      console.warn("Turnstile verification failed", {
        errors: turnstileOutcome["error-codes"] ?? [],
        hostname: turnstileOutcome.hostname,
        hasToken: Boolean(turnstileToken),
      });

      return jsonResponse({ error: "Verification failed" }, 400);
    }
  }

  const keyMaterial = env.EMAIL_ENCRYPTION_KEY;
  const emailHash = await hashEmail(email, keyMaterial);
  const encryptedEmail = await encryptText(email, keyMaterial);
  const encryptedName = name ? await encryptText(name, keyMaterial) : null;
  const encryptedOrganization = organization
    ? await encryptText(organization, keyMaterial)
    : null;
  const consentText =
    "I agree to be contacted about SDLCAI seminar registration.";
  const createdAt = new Date().toISOString();

  try {
    await env.INTERESTS.prepare(
      `INSERT INTO interests (
        email_hash,
        email_ciphertext,
        email_iv,
        name_ciphertext,
        name_iv,
        organization_ciphertext,
        organization_iv,
        consent_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        emailHash,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        encryptedName?.ciphertext ?? null,
        encryptedName?.iv ?? null,
        encryptedOrganization?.ciphertext ?? null,
        encryptedOrganization?.iv ?? null,
        consentText,
        createdAt,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        message: "You are already on the interest list.",
      });
    }

    throw error;
  }

  return jsonResponse({
    ok: true,
    message: "Thanks. We will notify you when registration opens.",
  });
}

export async function readInterestContacts(
  env: Env,
): Promise<InterestContact[]> {
  if (!env.INTERESTS) {
    throw new Error("Interest storage is not configured");
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    throw new Error("Encryption is not configured");
  }

  const { results } = await env.INTERESTS.prepare(
    `SELECT
      email_ciphertext,
      email_iv,
      name_ciphertext,
      name_iv,
      organization_ciphertext,
      organization_iv,
      created_at
    FROM interests
    ORDER BY created_at ASC`,
  ).all();
  const rows = results ?? [];

  return Promise.all(
    rows.map((row) => decryptInterestContact(row, env.EMAIL_ENCRYPTION_KEY)),
  );
}

async function decryptInterestContact(
  row: Record<string, unknown>,
  keyMaterial: string,
): Promise<InterestContact> {
  return {
    email: await decryptText(
      assertString(row.email_ciphertext),
      assertString(row.email_iv),
      keyMaterial,
    ),
    name:
      typeof row.name_ciphertext === "string" && typeof row.name_iv === "string"
        ? await decryptText(row.name_ciphertext, row.name_iv, keyMaterial)
        : "",
    organization:
      typeof row.organization_ciphertext === "string" &&
      typeof row.organization_iv === "string"
        ? await decryptText(
            row.organization_ciphertext,
            row.organization_iv,
            keyMaterial,
          )
        : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function assertString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected encrypted interest field to be a string");
  }

  return value;
}

export function formatContactsCsv(contacts: InterestContact[]): string {
  const rows = [
    ["email", "name", "organization", "created_at"],
    ...contacts.map((contact) => [
      contact.email,
      contact.name,
      contact.organization,
      contact.created_at,
    ]),
  ];

  return `${rows.map((row) => row.map(formatCsvValue).join(",")).join("\n")}\n`;
}
