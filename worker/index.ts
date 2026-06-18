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

interface InterestContact {
  created_at: string;
  email: string;
  name: string;
  organization: string;
}

interface AdminBindings {
  ADMIN_PASSWORD?: string;
  ADMIN_USERNAME?: string;
}

interface BackupManifest {
  rows_hash?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/admin") {
      return Response.redirect(`${url.origin}/admin/`, 308);
    }

    if (isAdminPath(url.pathname)) {
      const unauthorizedResponse = await requireAdmin(request, env);

      if (unauthorizedResponse) return unauthorizedResponse;
    }

    if (url.pathname === "/api/admin/interests") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const contacts = await readInterestContacts(env);

      return jsonResponse({ contacts, count: contacts.length }, 200, {
        "cache-control": "no-store",
      });
    }

    if (url.pathname === "/api/admin/interests.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const contacts = await readInterestContacts(env);

      return new Response(formatContactsCsv(contacts), {
        headers: {
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="sdlcai-interests.csv"',
          "content-type": "text/csv; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/interest") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleInterest(request, env);
    }

    if (url.pathname === "/calendar.ics") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return calendarResponse();
    }

    const response = await env.ASSETS.fetch(request);

    if (response.status === 404 && acceptsHtml(request)) {
      return serveNotFound(request, env, response);
    }

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

function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin/" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/")
  );
}

function acceptsHtml(request: Request): boolean {
  if (!["GET", "HEAD"].includes(request.method)) return false;

  const accept = request.headers.get("accept") ?? "";

  return accept.includes("text/html");
}

async function serveNotFound(
  request: Request,
  env: Env,
  originalResponse: Response,
): Promise<Response> {
  const url = new URL(request.url);
  const notFoundUrl = new URL("/404/", url.origin);
  const notFoundResponse = await env.ASSETS.fetch(
    new Request(notFoundUrl, request),
  );

  if (!notFoundResponse.headers.get("content-type")?.includes("text/html")) {
    return originalResponse;
  }

  return injectRuntimeConfig(notFoundResponse, env, 404);
}

async function requireAdmin(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const adminEnv = env as Env & AdminBindings;

  if (!adminEnv.ADMIN_USERNAME || !adminEnv.ADMIN_PASSWORD) {
    return new Response("Admin auth is not configured.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  const isAuthorized =
    credentials &&
    (await timingSafeEqual(credentials.username, adminEnv.ADMIN_USERNAME)) &&
    (await timingSafeEqual(credentials.password, adminEnv.ADMIN_PASSWORD));

  if (isAuthorized) return null;

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "www-authenticate": 'Basic realm="SDLCAI Admin", charset="UTF-8"',
    },
  });
}

function parseBasicAuth(
  authorization: string | null,
): { password: string; username: string } | null {
  if (!authorization?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [aHash, bHash] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);

  if (aHash.byteLength !== bHash.byteLength) return false;

  let difference = 0;

  for (let index = 0; index < aHash.byteLength; index++) {
    difference |= aHash[index]! ^ bHash[index]!;
  }

  return difference === 0;
}

async function readInterestContacts(env: Env): Promise<InterestContact[]> {
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

function formatContactsCsv(contacts: InterestContact[]): string {
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

function formatCsvValue(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
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

async function injectRuntimeConfig(
  response: Response,
  env: Env,
  status = response.status,
): Promise<Response> {
  const html = await response.text();

  return new Response(
    html.replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? ""),
    {
      headers: response.headers,
      status,
      statusText:
        status === response.status ? response.statusText : "Not Found",
    },
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

async function decryptText(
  ciphertext: string,
  iv: string,
  keyMaterial: string,
): Promise<string> {
  const key = await importAesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
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

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
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

function jsonResponse(
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

function calendarResponse(): Response {
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SDLCAI//Seminar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:SDLCAI",
    "BEGIN:VEVENT",
    "UID:20261013@sdlcai.org",
    "DTSTAMP:20260618T000000Z",
    "DTSTART:20261013T050000Z",
    "DTEND:20261013T180000Z",
    "SUMMARY:SDLCAI: AI Meets SDLC",
    "DESCRIPTION:A one-day seminar on AI across the software development lifecycle.",
    "LOCATION:Marsio Saastamoinen Foundation Stage, Aalto University, Espoo, Finland",
    "URL:https://sdlcai.org/",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(`${calendar}\r\n`, {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-disposition": 'attachment; filename="sdlcai.ics"',
      "content-type": "text/calendar; charset=utf-8",
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

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
