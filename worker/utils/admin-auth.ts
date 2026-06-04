import { sha256Hex } from "./crypto";
import { getClientKey, getRequestOrigin } from "./request";
import { jsonResponse } from "./response";

const ADMIN_AUTH_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_AUTH_MAX_FAILURES = 10;

export async function requireAdminAuth(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (!env.ADMIN_PASSWORD) {
    return jsonResponse({ error: "Admin auth is not configured" }, 503);
  }

  if (!env.INTERESTS) {
    return jsonResponse({ error: "Admin auth storage is not configured" }, 503);
  }

  const clientKeyHash = await getAdminClientKeyHash(request, env);
  const failedAttempts = await countRecentFailedAdminAuthAttempts(
    env,
    clientKeyHash,
  );

  if (failedAttempts >= ADMIN_AUTH_MAX_FAILURES) {
    return new Response("Too many failed authentication attempts", {
      status: 429,
      headers: {
        "retry-after": String(Math.ceil(ADMIN_AUTH_WINDOW_MS / 1000)),
      },
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const password = getAdminPasswordFromAuthorization(authorization);

  if (password && timingSafeEqualText(password, env.ADMIN_PASSWORD)) {
    await recordAdminAuthAttempt(env, clientKeyHash, true);
    await clearFailedAdminAuthAttempts(env, clientKeyHash);

    return null;
  }

  await recordAdminAuthAttempt(env, clientKeyHash, false);

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="SDLCAI admin"',
    },
  });
}

export async function getAdminClientKeyHash(
  request: Request,
  env: Env,
): Promise<string> {
  return sha256Hex(`admin-auth:${env.ADMIN_PASSWORD}:${getClientKey(request)}`);
}

export function requireAdminMutationRequest(
  request: Request,
  expectedAction: string,
): Response | null {
  const origin = request.headers.get("origin");
  const expectedOrigin = getRequestOrigin(request);

  if (origin && origin !== expectedOrigin) {
    return jsonResponse({ error: "Invalid request origin" }, 403);
  }

  if (request.headers.get("x-admin-action") !== expectedAction) {
    return jsonResponse({ error: "Missing admin action header" }, 403);
  }

  return null;
}

async function countRecentFailedAdminAuthAttempts(
  env: Env,
  clientKeyHash: string,
): Promise<number> {
  const cutoff = new Date(Date.now() - ADMIN_AUTH_WINDOW_MS).toISOString();
  const row = await env.INTERESTS.prepare(
    `SELECT COUNT(*) AS count
    FROM admin_auth_attempts
    WHERE client_key_hash = ?
      AND success = 0
      AND created_at >= ?`,
  )
    .bind(clientKeyHash, cutoff)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
}

async function recordAdminAuthAttempt(
  env: Env,
  clientKeyHash: string,
  success: boolean,
): Promise<void> {
  await env.INTERESTS.prepare(
    `INSERT INTO admin_auth_attempts (client_key_hash, success, created_at)
    VALUES (?, ?, ?)`,
  )
    .bind(clientKeyHash, success ? 1 : 0, new Date().toISOString())
    .run();
}

async function clearFailedAdminAuthAttempts(
  env: Env,
  clientKeyHash: string,
): Promise<void> {
  await env.INTERESTS.prepare(
    `DELETE FROM admin_auth_attempts
    WHERE client_key_hash = ?
      AND success = 0`,
  )
    .bind(clientKeyHash)
    .run();
}

function getAdminPasswordFromAuthorization(authorization: string): string {
  const [scheme = "", credentials = ""] = authorization.split(" ", 2);

  if (scheme.toLowerCase() === "bearer") return credentials;

  if (scheme.toLowerCase() !== "basic" || !credentials) return "";

  try {
    const decoded = atob(credentials);
    const separator = decoded.indexOf(":");

    return separator >= 0 ? decoded.slice(separator + 1) : "";
  } catch {
    return "";
  }
}

function timingSafeEqualText(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}
