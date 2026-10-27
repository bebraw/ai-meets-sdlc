import { currentEvent } from "./event-workspaces.ts";
import { escapeHtml } from "./speaker-workspace-utils.ts";
import { hashText } from "./form-utils.ts";

const encoder = new TextEncoder();
export const base64url = (value: string) =>
  value.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const decode = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );

export async function mailFingerprint(
  email: string,
  env: Env,
): Promise<string> {
  return base64url(
    await hashText(
      email.trim().toLowerCase(),
      env.EMAIL_ENCRYPTION_KEY,
      "attendee-message-address",
    ),
  );
}
export async function signMailToken(
  payload: Record<string, unknown>,
  env: Env,
  purpose: string,
): Promise<string> {
  if (currentEvent(env).id !== "2026")
    purpose = `event:${currentEvent(env).id}:${purpose}`;
  const data = base64url(
    btoa(String.fromCharCode(...encoder.encode(JSON.stringify(payload)))),
  );
  return `${data}.${base64url(await hashText(data, env.EMAIL_ENCRYPTION_KEY, purpose))}`;
}
export async function verifyMailToken(
  token: string,
  env: Env,
  purpose: string,
): Promise<Record<string, unknown> | null> {
  if (currentEvent(env).id !== "2026")
    purpose = `event:${currentEvent(env).id}:${purpose}`;
  if (token.length > 4096 || !/^[\w-]+\.[\w-]{43}$/u.test(token)) return null;
  try {
    const [data, signature] = token.split(".");
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(`${purpose}:${env.EMAIL_ENCRYPTION_KEY}`),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        key,
        decode(signature!),
        encoder.encode(data!),
      ))
    )
      return null;
    const payload: unknown = JSON.parse(
      new TextDecoder().decode(decode(data!)),
    );
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
export function mailOrigin(env: Env): string {
  const url = new URL(env.PUBLIC_SITE_ORIGIN);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid public email origin");
  return url.origin;
}
export function mailHtml(text: string): string {
  // Treat organizer copy as plain text; only recognized HTTP(S) links become anchors.
  const content = escapeHtml(text)
    .replace(
      /https?:\/\/[^\s<>]+/gu,
      (url) => `<a href="${url}" style="color:inherit">${url}</a>`,
    )
    .replaceAll("\n", "<br>");
  return `<!doctype html><html lang="en"><body style="margin:0;background:#f3efe7;color:#151515;font-family:Arial,sans-serif"><div style="max-width:640px;margin:auto;padding:32px 20px"><p style="font-size:13px;font-weight:bold">SDLCAI</p><div style="border:1px solid #151515;padding:28px;font-size:17px;line-height:1.6">${content}</div></div></body></html>`;
}
export function privateMailResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(response.body, { status: response.status, headers });
}
