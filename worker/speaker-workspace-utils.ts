import { normalizeHostname } from "./turnstile.ts";

export const speakerSessionCookie = "__Host-sdlcai-speaker-session";

export const maxWorkspaceBodyBytes = 24 * 1024;

export const maxLoginBodyBytes = 8 * 1024;

export const maxDinnerBodyBytes = 8 * 1024;

export const maxPresentationBodyBytes = 8 * 1024;

export const sessionLifetimeMilliseconds = 14 * 24 * 60 * 60 * 1000;

export const magicLinkLifetimeMilliseconds = 15 * 60 * 1000;

export const loginRequestRetentionMilliseconds = 24 * 60 * 60 * 1000;

export const loginRateWindowMilliseconds = 60 * 60 * 1000;

export const loginCooldownMilliseconds = 2 * 60 * 1000;

export const maxLoginRequestsPerEmail = 5;

export const maxLoginRequestsPerIp = 20;

export const speakerLoginTurnstileAction = "speaker-login-v1";

export const speakerDinnerConsentText =
  "I consent to Toska Osuuskunta processing this response and, if I attend, sharing only the necessary food information with the dinner caterer. I can withdraw by contacting info@sdlcai.org.";

export const genericLoginMessage =
  "If that address is assigned to an SDLCAI speaker, a sign-in link is on its way. It expires after 15 minutes. Check your inbox and spam folder.";

export const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;

export function withSpeakerWorkspaceSecurityHeaders(
  response: Response,
): Response {
  const headers = new Headers(response.headers);

  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function parseHttpsUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.username || url.password) return null;

    return url;
  } catch {
    return null;
  }
}

export function requireAdminMutation(
  request: Request,
  expectedAction: string,
): Response | null {
  if (
    isSameOriginMutation(request) &&
    request.headers.get("x-admin-action") === expectedAction
  ) {
    return null;
  }

  return json({ error: "Admin action could not be verified." }, 403);
}

export function staleCanonicalResponse(): Response {
  return json(
    {
      error:
        "The published profile changed while this editor was open. Reload and review the latest details.",
    },
    409,
  );
}

export function parseFutureConfigurationDate(
  value: string | undefined,
): Date | null {
  if (!value) return null;

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return null;

  return new Date(timestamp);
}

export function parsePublicOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function getSpeakerDinnerConfiguration(
  env: Env,
): { deadline: number; retention: number } | null {
  const deadline = Date.parse(env.SPEAKER_DINNER_RESPONSE_DEADLINE ?? "");
  const retention = Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL ?? "");

  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(retention) ||
    retention <= deadline
  ) {
    return null;
  }

  return { deadline, retention };
}

export function getSpeakerDinnerConfigurationError(env: Env): Response | null {
  const workspaceError = getConfigurationError(env);

  if (workspaceError) return workspaceError;

  if (!getSpeakerDinnerConfiguration(env)) {
    return json(
      { error: "The speaker dinner response period is not configured." },
      503,
    );
  }

  return null;
}

export function getSpeakerTurnstileHostnames(env: Env): Set<string> {
  return new Set(
    (env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map(normalizeHostname)
      .filter(Boolean),
  );
}

export function getSpeakerTurnstileConfigurationError(
  env: Env,
): Response | null {
  const hasSiteKey = Boolean(
    env.TURNSTILE_SITE_KEY?.trim() &&
    env.TURNSTILE_SITE_KEY !== "__TURNSTILE_SITE_KEY__",
  );
  const hasSecretKey = Boolean(env.TURNSTILE_SECRET_KEY?.trim());

  if (hasSiteKey !== hasSecretKey) {
    return json({ error: "Verification is not configured." }, 503);
  }

  if (hasSecretKey && getSpeakerTurnstileHostnames(env).size === 0) {
    return json({ error: "Verification is not configured." }, 503);
  }

  return null;
}

export function isLikelyEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) &&
    !/[\r\n]/u.test(value)
  );
}

export function speakerInvitationText({
  expiresAt,
  invitationUrl,
  speakerName,
}: {
  expiresAt: Date;
  invitationUrl: string;
  speakerName: string;
}): string {
  return [
    `Hello ${speakerName},`,
    "",
    "Your private SDLCAI speaker workspace is ready. Use it to review and suggest updates to your public profile, social links, talk title, and talk description, and to access your promotion graphics.",
    "",
    invitationUrl,
    "",
    `The link remains valid until ${formatEmailDate(expiresAt)}. Keep it private: anyone with the link can open your workspace.`,
    "",
    "Submitted updates are reviewed by the SDLCAI organizer before publication.",
    "",
    "Questions? Reply to this message or contact info@sdlcai.org.",
    "",
    "SDLCAI",
  ].join("\n");
}

export function speakerMagicLinkText({
  expiresAt,
  magicLinkUrl,
  speakerName,
}: {
  expiresAt: Date;
  magicLinkUrl: string;
  speakerName: string;
}): string {
  return [
    `Hello ${speakerName},`,
    "",
    "Use this one-time link to sign in to your private SDLCAI speaker workspace:",
    "",
    magicLinkUrl,
    "",
    `The link expires at ${formatEmailDateTime(expiresAt)}. If you did not request it, you can ignore this message.`,
    "",
    "In the workspace you can update your profile, talk details, dinner response, promotion graphics, portrait, and topic video.",
    "",
    "Questions? Reply to this message or contact info@sdlcai.org.",
    "",
    "SDLCAI",
  ].join("\n");
}

export function speakerMagicLinkHtml({
  expiresAt,
  magicLinkUrl,
  speakerName,
}: {
  expiresAt: Date;
  magicLinkUrl: string;
  speakerName: string;
}): string {
  const safeName = escapeHtml(speakerName);
  const safeUrl = escapeHtml(magicLinkUrl);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3efe7;color:#151515;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:13px;font-weight:700;text-transform:uppercase">SDLCAI / Speaker sign-in</p>
      <div style="border:1px solid #151515;background:#fff;padding:28px">
        <h1 style="margin:0 0 20px;font-size:32px;line-height:1;text-transform:uppercase">Your sign-in link</h1>
        <p style="font-size:17px;line-height:1.6">Hello ${safeName},</p>
        <p style="font-size:17px;line-height:1.6">Open your private workspace to update your profile, talk, dinner response, and promotion material.</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#151515;color:#fff;padding:14px 20px;font-weight:700;text-decoration:none;text-transform:uppercase">Sign in to speaker workspace</a></p>
        <p style="font-size:14px;line-height:1.6;color:#5d5d5d">This one-time link expires at ${escapeHtml(formatEmailDateTime(expiresAt))}. If you did not request it, you can ignore this message.</p>
      </div>
      <p style="font-size:14px;line-height:1.6">Questions? Reply to this message or contact <a href="mailto:info@sdlcai.org" style="color:#151515">info@sdlcai.org</a>.</p>
    </div>
  </body>
</html>`;
}

export function speakerInvitationHtml({
  expiresAt,
  invitationUrl,
  speakerName,
}: {
  expiresAt: Date;
  invitationUrl: string;
  speakerName: string;
}): string {
  const safeName = escapeHtml(speakerName);
  const safeUrl = escapeHtml(invitationUrl);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f3efe7;color:#151515;font-family:Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px">
      <p style="margin:0 0 24px;font-size:13px;font-weight:700;text-transform:uppercase">SDLCAI / Speaker workspace</p>
      <div style="border:1px solid #151515;background:#fff;padding:28px">
        <h1 style="margin:0 0 20px;font-size:32px;line-height:1;text-transform:uppercase">Your workspace is ready</h1>
        <p style="font-size:17px;line-height:1.6">Hello ${safeName},</p>
        <p style="font-size:17px;line-height:1.6">Review your public profile, social links, talk details, and promotion graphics in one private place.</p>
        <p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#151515;color:#fff;padding:14px 20px;font-weight:700;text-decoration:none;text-transform:uppercase">Open speaker workspace</a></p>
        <p style="font-size:14px;line-height:1.6;color:#5d5d5d">This private link remains valid until ${escapeHtml(formatEmailDate(expiresAt))}. Anyone with the link can open your workspace, so please do not forward it.</p>
        <p style="font-size:14px;line-height:1.6;color:#5d5d5d">Submitted updates are reviewed by the SDLCAI organizer before publication.</p>
      </div>
      <p style="font-size:14px;line-height:1.6">Questions? Reply to this message or contact <a href="mailto:info@sdlcai.org" style="color:#151515">info@sdlcai.org</a>.</p>
    </div>
  </body>
</html>`;
}

function formatEmailDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeZone: "Europe/Helsinki",
  }).format(value);
}

function formatEmailDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Helsinki",
  }).format(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export async function encryptPrivateText(
  value: string,
  keyMaterial: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importPrivateAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

export async function decryptPrivateText(
  ciphertext: string,
  iv: string,
  keyMaterial: string,
): Promise<string> {
  const key = await importPrivateAesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { iv: base64Decode(iv), name: "AES-GCM" },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

async function importPrivateAesKey(keyMaterial: string): Promise<CryptoKey> {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`email-encryption:${keyMaterial}`),
  );

  return crypto.subtle.importKey("raw", derived, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

export function hashPrivateText(
  value: string,
  keyMaterial: string,
  purpose: string,
): Promise<string> {
  return hashToken(value, keyMaterial, purpose);
}

export function getConfigurationError(env: Env): Response | null {
  if (!env.INTERESTS) {
    return json({ error: "Speaker workspace storage is not configured." }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return json(
      { error: "Speaker workspace encryption is not configured." },
      503,
    );
  }

  return null;
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);

  return match?.[1] ?? null;
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) return null;

  for (const item of cookieHeader.split(";")) {
    const separator = item.indexOf("=");

    if (separator === -1) continue;

    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }

  return null;
}

export function serializeSessionCookie(
  token: string,
  maxAgeSeconds: number,
): string {
  return `${speakerSessionCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie(): string {
  return `${speakerSessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return base64UrlEncode(bytes);
}

export async function hashToken(
  token: string,
  keyMaterial: string,
  purpose: string,
): Promise<string> {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${keyMaterial}`),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );

  return base64Encode(new Uint8Array(signature));
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export async function readJsonWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    return json({ error: "Submit the workspace form again." }, 415);
  }

  const contentLength = request.headers.get("content-length");

  if (
    contentLength &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    return json({ error: "Submission is too large." }, 413);
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        totalBytes += value.byteLength;

        if (totalBytes > maxBytes) {
          await reader.cancel();
          return json({ error: "Submission is too large." }, 413);
        }

        chunks.push(value);
      }
    } catch {
      return json({ error: "Submit the workspace form again." }, 400);
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
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return json({ error: "Submit the workspace form again." }, 400);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function secure(response: Response): Response {
  return withSpeakerWorkspaceSecurityHeaders(response);
}

export function adminSecure(response: Response): Response {
  const secured = withSpeakerWorkspaceSecurityHeaders(response);
  const headers = new Headers(secured.headers);
  const varyValues = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const headerName of ["Authorization", "Cookie"]) {
    if (!varyValues.has(headerName.toLowerCase())) {
      headers.append("vary", headerName);
    }
  }

  return new Response(secured.body, {
    headers,
    status: secured.status,
    statusText: secured.statusText,
  });
}
