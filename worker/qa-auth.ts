import { hasAdminSession } from "./admin-auth.ts";
import { decryptText, encryptText, hashText, sha256Hex } from "./form-utils.ts";
import type { QaActor, QaGrant } from "./qa-types.ts";

const staffCookie = "sdlcai-qa-staff";
const attendeeCookie = "sdlcai-qa-attendee";
const sessionSeconds = 14 * 24 * 60 * 60;
const participantSeconds = 18 * 60 * 60;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
type GrantRow = Omit<QaGrant, "link"> & {
  token_ciphertext: string;
  token_iv: string;
};

export function qaToken(): string {
  return btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function readCookie(request: Request, name: string): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ""
  );
}
function cookie(
  request: Request,
  name: string,
  value: string,
  seconds: number,
): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function tokenHash(
  token: string,
  env: Env,
  purpose: string,
): Promise<string> {
  return hashText(token, env.EMAIL_ENCRYPTION_KEY!, `qa-${purpose}`);
}
export async function qaParticipant(
  request: Request,
  env: Env,
): Promise<{ id: string; cookie?: string }> {
  const existing = readCookie(request, attendeeCookie);
  const match =
    /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/u.exec(existing);
  if (
    match &&
    Number(match[1]) > Date.now() / 1000 &&
    Number(match[1]) <= Date.now() / 1000 + participantSeconds + 60
  ) {
    const payload = `v1.${match[1]}.${match[2]}`;
    const keyBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`qa-participant:${env.EMAIL_ENCRYPTION_KEY}`),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureBytes = Uint8Array.from(
      atob(match[3]!.replaceAll("-", "+").replaceAll("_", "/") + "="),
      (character) => character.charCodeAt(0),
    );
    if (
      await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        new TextEncoder().encode(payload),
      )
    )
      return { id: match[2]! };
  }
  const id = qaToken();
  const payload = `v1.${Math.floor(Date.now() / 1000) + participantSeconds}.${id}`;
  const signature = (await tokenHash(payload, env, "participant"))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return {
    id,
    cookie: cookie(
      request,
      attendeeCookie,
      `${payload}.${signature}`,
      participantSeconds,
    ),
  };
}
export async function qaActor(
  request: Request,
  env: Env,
  roomName: string,
  participantId: string,
): Promise<QaActor> {
  const participantKey = await sha256Hex(`${roomName}:${participantId}`);
  if (await hasAdminSession(request, env))
    return { role: "admin", id: `admin:${env.ADMIN_USERNAME}`, participantKey };
  const token = readCookie(request, staffCookie);
  if (tokenPattern.test(token)) {
    const row = await env.INTERESTS.prepare(
      `
      SELECT g.id, g.role FROM qa_staff_sessions s JOIN qa_access_grants g ON g.id = s.grant_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND g.revoked_at IS NULL
    `,
    )
      .bind(await tokenHash(token, env, "session"), new Date().toISOString())
      .first<{ id: string; role: "moderator" | "mc" }>();
    if (row) return { role: row.role, id: `grant:${row.id}`, participantKey };
  }
  return { role: "attendee", id: "attendee", participantKey };
}
export async function createQaGrant(
  env: Env,
  label: string,
  role: "moderator" | "mc",
): Promise<void> {
  const token = qaToken();
  const encrypted = await encryptText(token, env.EMAIL_ENCRYPTION_KEY!);
  await env.INTERESTS.prepare(
    "INSERT INTO qa_access_grants (id, label, role, token_hash, token_ciphertext, token_iv, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      label,
      role,
      await tokenHash(token, env, "grant"),
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
    )
    .run();
}
export async function readQaGrants(
  request: Request,
  env: Env,
): Promise<QaGrant[]> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT id, label, role, token_ciphertext, token_iv, created_at, revoked_at FROM qa_access_grants ORDER BY created_at DESC",
  ).all<GrantRow>();
  return Promise.all(
    results.map(async (row) => {
      let link: string | null = null;
      if (!row.revoked_at) {
        const url = new URL(
          "/qa/access/",
          env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin,
        );
        url.hash = `token=${await decryptText(row.token_ciphertext, row.token_iv, env.EMAIL_ENCRYPTION_KEY!)}`;
        link = url.href;
      }
      return {
        id: row.id,
        label: row.label,
        role: row.role,
        created_at: row.created_at,
        revoked_at: row.revoked_at,
        link,
      };
    }),
  );
}
export async function redeemQaGrant(
  request: Request,
  env: Env,
  token: string,
): Promise<{ role: "moderator" | "mc"; cookie: string } | null> {
  if (!tokenPattern.test(token)) return null;
  const row = await env.INTERESTS.prepare(
    "SELECT id, role FROM qa_access_grants WHERE token_hash = ? AND revoked_at IS NULL",
  )
    .bind(await tokenHash(token, env, "grant"))
    .first<{ id: string; role: "moderator" | "mc" }>();
  if (!row) return null;
  const session = qaToken();
  const now = new Date();
  // Conditional insertion also handles a revocation racing with redemption.
  const result = await env.INTERESTS.prepare(
    `INSERT INTO qa_staff_sessions (token_hash, grant_id, created_at, expires_at)
    SELECT ?, id, ?, ? FROM qa_access_grants WHERE id = ? AND revoked_at IS NULL`,
  )
    .bind(
      await tokenHash(session, env, "session"),
      now.toISOString(),
      new Date(now.getTime() + sessionSeconds * 1000).toISOString(),
      row.id,
    )
    .run();
  if (!result.meta.changes) return null;
  await env.INTERESTS.prepare(
    "DELETE FROM qa_staff_sessions WHERE expires_at <= ?",
  )
    .bind(now.toISOString())
    .run();
  return {
    role: row.role,
    cookie: cookie(request, staffCookie, session, sessionSeconds),
  };
}
export async function revokeQaGrant(env: Env, id: string): Promise<void> {
  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      "UPDATE qa_access_grants SET revoked_at = COALESCE(revoked_at, ?), token_ciphertext = '', token_iv = '' WHERE id = ?",
    ).bind(new Date().toISOString(), id),
    env.INTERESTS.prepare(
      "DELETE FROM qa_staff_sessions WHERE grant_id = ?",
    ).bind(id),
  ]);
}
export async function logoutQa(request: Request, env: Env): Promise<string> {
  const token = readCookie(request, staffCookie);
  if (tokenPattern.test(token))
    await env.INTERESTS.prepare(
      "DELETE FROM qa_staff_sessions WHERE token_hash = ?",
    )
      .bind(await tokenHash(token, env, "session"))
      .run();
  return cookie(request, staffCookie, "", 0);
}
