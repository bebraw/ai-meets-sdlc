import { normalizeHostname } from "./turnstile.ts";

type JsonObject = Record<string, unknown>;

interface EncryptedText {
  ciphertext: string;
  iv: string;
}

export const turnstileAction = "turnstile-spin-v2";

export function requireAdminAction(
  request: Request,
  expectedAction: string,
): Response | null {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  const action = request.headers.get("x-admin-action");

  if (origin === requestOrigin && action === expectedAction) return null;

  return jsonResponse({ error: "Admin action could not be verified." }, 403, {
    "cache-control": "no-store",
  });
}

export function formatCsvValue(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@\t\r]/u.test(value)
    ? `'${value}`
    : value;

  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256Bytes(value);

  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return new Uint8Array(digest);
}

export async function encryptText(
  value: string,
  keyMaterial: string,
): Promise<EncryptedText> {
  const key = await importAesKey(keyMaterial);

  return encryptTextWithKey(value, key);
}

export async function encryptTextWithKey(
  value: string,
  key: CryptoKey,
): Promise<EncryptedText> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

export async function decryptText(
  ciphertext: string,
  iv: string,
  keyMaterial: string,
): Promise<string> {
  const key = await importAesKey(keyMaterial);

  return decryptTextWithKey(ciphertext, iv, key);
}

export async function decryptTextWithKey(
  ciphertext: string,
  iv: string,
  key: CryptoKey,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

export async function decryptOptionalTextWithKey(
  ciphertext: string | null,
  iv: string | null,
  key: CryptoKey,
): Promise<string> {
  if (ciphertext === null && iv === null) return "";

  if (ciphertext === null || iv === null) {
    throw new Error("Encrypted poster proposal field is incomplete");
  }

  return decryptTextWithKey(ciphertext, iv, key);
}

export async function hashEmail(
  email: string,
  keyMaterial: string,
): Promise<string> {
  return hashText(email, keyMaterial, "email-hash");
}

export async function hashText(
  value: string,
  keyMaterial: string,
  purpose: string,
): Promise<string> {
  const key = await importHmacKey(keyMaterial, purpose);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return base64Encode(new Uint8Array(signature));
}

export async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

async function importHmacKey(
  keyMaterial: string,
  purpose: string,
): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, purpose);

  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function deriveBytes(
  secret: string,
  purpose: string,
): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${secret}`),
  );

  return digest;
}

export async function readFormDataWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<FormData | Response> {
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader !== null) {
    if (!/^\d+$/u.test(contentLengthHeader)) {
      return jsonResponse({ error: "Submit the form again." }, 400);
    }

    if (Number(contentLengthHeader) > maxBytes) {
      return jsonResponse({ error: "Submission is too large." }, 413);
    }
  }

  const contentType = request.headers.get("content-type") ?? "";
  const normalizedContentType = contentType.toLowerCase();

  if (
    !normalizedContentType.startsWith("multipart/form-data;") &&
    !normalizedContentType.startsWith("application/x-www-form-urlencoded")
  ) {
    return jsonResponse({ error: "Submit the form again." }, 415);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (request.body) {
    const reader = request.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        totalBytes += value.byteLength;

        if (totalBytes > maxBytes) {
          await reader.cancel();

          return jsonResponse({ error: "Submission is too large." }, 413);
        }

        chunks.push(value);
      }
    } catch {
      return jsonResponse({ error: "Submit the form again." }, 400);
    } finally {
      reader.releaseLock();
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const boundedRequest = new Request(request.url, {
      body,
      headers: { "content-type": contentType },
      method: "POST",
    });

    return await boundedRequest.formData();
  } catch {
    return jsonResponse({ error: "Submit the form again." }, 400);
  }
}

export function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeFormText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

export function getTurnstileToken(formData: FormData): string {
  const values = formData
    .getAll("cf-turnstile-response")
    .map((value) => normalizeOptionalText(value, 2048))
    .filter(Boolean);

  return values.at(-1) ?? "";
}

function hasConfiguredTurnstileSiteKey(env: Env): boolean {
  return Boolean(
    env.TURNSTILE_SITE_KEY?.trim() &&
    env.TURNSTILE_SITE_KEY !== "__TURNSTILE_SITE_KEY__",
  );
}

export function getExpectedTurnstileHostnames(env: Env): Set<string> {
  return new Set(
    (env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map(normalizeHostname)
      .filter(Boolean),
  );
}

export function getTurnstileConfigurationError(env: Env): Response | null {
  const hasSiteKey = hasConfiguredTurnstileSiteKey(env);
  const hasSecretKey = Boolean(env.TURNSTILE_SECRET_KEY?.trim());

  if (hasSiteKey !== hasSecretKey) {
    return jsonResponse({ error: "Verification is not configured" }, 503);
  }

  if (hasSecretKey && getExpectedTurnstileHostnames(env).size === 0) {
    return jsonResponse({ error: "Verification is not configured" }, 503);
  }

  return null;
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function jsonResponse(
  payload: JsonObject,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
