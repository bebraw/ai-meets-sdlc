type JsonObject = Record<string, unknown>;

interface TurnstileOutcome {
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

interface EncryptedText {
  ciphertext: string;
  iv: string;
}

interface BackupManifest {
  rows_hash?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/interest") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleInterest(request, env);
    }

    const response = await env.ASSETS.fetch(request);

    if (response.headers.get("content-type")?.includes("text/html")) {
      return injectRuntimeConfig(response, env);
    }

    return response;
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.INTEREST_BACKUPS) return;

    ctx.waitUntil(backupInterests(env));
  },
} satisfies ExportedHandler<Env>;

async function handleInterest(request: Request, env: Env): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Interest storage is not configured" }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured" }, 503);
  }

  const formData = await request.formData();
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

  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileOutcome = await verifyTurnstile({
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

async function verifyTurnstile({
  request,
  secret,
  token,
}: {
  request: Request;
  secret: string;
  token: string;
}): Promise<TurnstileOutcome> {
  if (!token) {
    return { success: false, "error-codes": ["missing-input-response"] };
  }

  const payload = new FormData();
  payload.append("secret", secret);
  payload.append("response", token);

  const ip = request.headers.get("CF-Connecting-IP");

  if (ip) {
    payload.append("remoteip", ip);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: payload,
    },
  );
  const outcome = (await response.json()) as TurnstileOutcome;

  return outcome;
}

async function backupInterests(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM interests ORDER BY created_at ASC",
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      rows,
    },
    null,
    2,
  );
  const key = `interests/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "interests/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        row_count: rows.length,
        rows_hash: rowsHash,
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );
}

async function getLatestBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get("interests/latest.json");

  if (!latestBackup) return null;

  if (latestBackup.customMetadata?.rows_hash) {
    return { rows_hash: latestBackup.customMetadata.rows_hash };
  }

  try {
    const manifest = await latestBackup.json();

    return isBackupManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function isBackupManifest(value: unknown): value is BackupManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (!("rows_hash" in value) || typeof value.rows_hash === "string")
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function injectRuntimeConfig(
  response: Response,
  env: Env,
): Promise<Response> {
  const html = await response.text();

  return new Response(
    html.replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? ""),
    response,
  );
}

async function encryptText(
  value: string,
  keyMaterial: string,
): Promise<EncryptedText> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(keyMaterial);
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

async function hashEmail(email: string, keyMaterial: string): Promise<string> {
  const key = await importHmacKey(keyMaterial);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(email),
  );

  return base64Encode(new Uint8Array(signature));
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]);
}

async function importHmacKey(keyMaterial: string): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, "email-hash");

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

function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

function getTurnstileToken(formData: FormData): string {
  const values = formData
    .getAll("cf-turnstile-response")
    .map((value) => normalizeOptionalText(value, 2048))
    .filter(Boolean);

  return values.at(-1) ?? "";
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function jsonResponse(payload: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
