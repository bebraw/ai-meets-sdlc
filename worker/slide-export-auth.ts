import { hasAdminSession, withAdminSecurityHeaders } from "./admin-auth.ts";
import { authenticateSpeaker } from "./speaker-login.ts";

export function isSpeakerSlideExportPath(pathname: string): boolean {
  return (
    pathname === "/assets/social/speakers.json" ||
    (pathname.startsWith("/assets/social/") && pathname.endsWith(".jpg"))
  );
}

export async function requireSlideExportAccess(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (await hasAdminSession(request, env)) return null;
  const speaker = await authenticateSpeaker(request, env);
  if (!(speaker instanceof Response)) return null;

  return withAdminSecurityHeaders(speaker);
}
