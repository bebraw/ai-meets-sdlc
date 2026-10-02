import { hasAdminSession } from "./admin-auth.ts";
import { decryptText, encryptText, hashText } from "./form-utils.ts";
import { qaToken } from "./qa-auth.ts";
import type { RegistrationGrant } from "../site/scripts/attendee-model.ts";

const cookieName = "sdlcai-registration-staff";
const lifetime = 14 * 24 * 60 * 60;
const pattern = /^[A-Za-z0-9_-]{43}$/u;
export interface RegistrationActor {
  role: "admin" | "registration";
  id: string;
  sessionHash: string | null;
}
const hash = (token: string, env: Env, purpose: string) =>
  hashText(token, env.EMAIL_ENCRYPTION_KEY!, `registration-${purpose}`);
function tokenCookie(request: Request): string {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? ""
  );
}
function cookie(request: Request, token: string, seconds: number): string {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function registrationActor(
  request: Request,
  env: Env,
): Promise<RegistrationActor | null> {
  if (await hasAdminSession(request, env))
    return {
      role: "admin",
      id: `admin:${env.ADMIN_USERNAME}`,
      sessionHash: null,
    };
  const token = tokenCookie(request);
  if (!pattern.test(token)) return null;
  const sessionHash = await hash(token, env, "session");
  const row = await env.INTERESTS.prepare(
    `SELECT g.id FROM registration_staff_sessions s
    JOIN registration_access_grants g ON g.id = s.grant_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND g.revoked_at IS NULL`,
  )
    .bind(sessionHash, new Date().toISOString())
    .first<{ id: string }>();
  return row
    ? { role: "registration", id: `grant:${row.id}`, sessionHash }
    : null;
}
export async function createRegistrationGrant(
  env: Env,
  label: string,
): Promise<void> {
  const token = qaToken();
  const encrypted = await encryptText(token, env.EMAIL_ENCRYPTION_KEY!);
  await env.INTERESTS.prepare(
    `INSERT INTO registration_access_grants
    (id, label, token_hash, token_ciphertext, token_iv, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      label,
      await hash(token, env, "grant"),
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
    )
    .run();
}
export async function readRegistrationGrants(
  request: Request,
  env: Env,
): Promise<RegistrationGrant[]> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT id, label, created_at, revoked_at, token_ciphertext, token_iv FROM registration_access_grants ORDER BY created_at DESC",
  ).all<
    Omit<RegistrationGrant, "link"> & {
      token_ciphertext: string;
      token_iv: string;
    }
  >();
  return Promise.all(
    results.map(async (row) => {
      let link: string | null = null;
      if (!row.revoked_at) {
        const url = new URL(
          "/registration/access/",
          env.PUBLIC_SITE_ORIGIN || new URL(request.url).origin,
        );
        url.hash = `token=${await decryptText(row.token_ciphertext, row.token_iv, env.EMAIL_ENCRYPTION_KEY!)}`;
        link = url.href;
      }
      return {
        id: row.id,
        label: row.label,
        created_at: row.created_at,
        revoked_at: row.revoked_at,
        link,
      };
    }),
  );
}
export async function redeemRegistrationGrant(
  request: Request,
  env: Env,
  token: string,
): Promise<string | null> {
  if (!pattern.test(token)) return null;
  const session = qaToken();
  const now = new Date();
  const result = await env.INTERESTS.prepare(
    `INSERT INTO registration_staff_sessions (token_hash, grant_id, created_at, expires_at)
    SELECT ?, id, ?, ? FROM registration_access_grants WHERE token_hash = ? AND revoked_at IS NULL`,
  )
    .bind(
      await hash(session, env, "session"),
      now.toISOString(),
      new Date(now.getTime() + lifetime * 1000).toISOString(),
      await hash(token, env, "grant"),
    )
    .run();
  if (!result.meta.changes) return null;
  await env.INTERESTS.prepare(
    "DELETE FROM registration_staff_sessions WHERE expires_at <= ?",
  )
    .bind(now.toISOString())
    .run();
  return cookie(request, session, lifetime);
}
export async function revokeRegistrationGrant(
  env: Env,
  id: string,
): Promise<void> {
  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      "UPDATE registration_access_grants SET revoked_at = COALESCE(revoked_at, ?), token_ciphertext = '', token_iv = '' WHERE id = ?",
    ).bind(new Date().toISOString(), id),
    env.INTERESTS.prepare(
      "DELETE FROM registration_staff_sessions WHERE grant_id = ?",
    ).bind(id),
  ]);
}
export async function logoutRegistration(
  request: Request,
  env: Env,
): Promise<string> {
  const token = tokenCookie(request);
  if (pattern.test(token))
    await env.INTERESTS.prepare(
      "DELETE FROM registration_staff_sessions WHERE token_hash = ?",
    )
      .bind(await hash(token, env, "session"))
      .run();
  return cookie(request, "", 0);
}
