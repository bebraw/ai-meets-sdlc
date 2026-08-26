import scheduleData from "../site/data/schedule.json" with { type: "json" };
import speakersData from "../site/data/speakers.json" with { type: "json" };

type SocialField =
  | "website"
  | "linkedin"
  | "x"
  | "github"
  | "devto"
  | "scholar";

interface CanonicalSpeaker {
  bio: string;
  devto?: string;
  github?: string;
  id: string;
  linkedin?: string;
  name: string;
  photo: string;
  role: string;
  scholar?: string;
  website?: string;
  x?: string;
}

interface CanonicalTalk {
  abstract: string;
  id: string;
  speakers: string[];
  title: string;
}

interface ScheduleItem {
  talks?: CanonicalTalk[];
}

interface SpeakerProfileContent {
  bio: string;
  devto: string;
  github: string;
  linkedin: string;
  name: string;
  role: string;
  scholar: string;
  website: string;
  x: string;
}

interface SpeakerTalkContent {
  abstract: string;
  id: string;
  title: string;
}

export interface SpeakerWorkspaceContent {
  profile: SpeakerProfileContent;
  talks: SpeakerTalkContent[];
}

interface SpeakerAccessRow {
  access_generation: number;
  invite_expires_at: string;
  speaker_id: string;
}

interface SpeakerSessionRow extends SpeakerAccessRow {
  expires_at: string;
  token_hash: string;
}

interface SpeakerRevisionRow {
  base_content_hash: string;
  content_json: string;
  revision_id: string;
  state: "draft" | "submitted";
  submitted_at: string | null;
  updated_at: string;
}

interface ValidationResult {
  content?: SpeakerWorkspaceContent;
  errors: Record<string, string>;
}

const speakerSessionCookie = "__Host-sdlcai-speaker-session";
const maxWorkspaceBodyBytes = 24 * 1024;
const sessionLifetimeMilliseconds = 14 * 24 * 60 * 60 * 1000;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const socialFields = [
  "website",
  "linkedin",
  "x",
  "github",
  "devto",
  "scholar",
] as const satisfies readonly SocialField[];
const socialHosts: Record<Exclude<SocialField, "website">, Set<string>> = {
  devto: new Set(["dev.to"]),
  github: new Set(["github.com", "www.github.com"]),
  linkedin: new Set(["linkedin.com", "www.linkedin.com"]),
  scholar: new Set(["scholar.google.com"]),
  x: new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]),
};
const canonicalSpeakers = speakersData.items as CanonicalSpeaker[];
const canonicalTalks = (scheduleData.items as ScheduleItem[]).flatMap(
  ({ talks = [] }) => talks,
);

export function isSpeakerWorkspacePath(pathname: string): boolean {
  return (
    pathname === "/speaker" ||
    pathname.startsWith("/speaker/") ||
    pathname.startsWith("/api/speaker/")
  );
}

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

export async function handleSpeakerWorkspaceRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/api/speaker/session") {
    if (request.method === "POST") {
      return secure(await redeemSpeakerInvitation(request, env));
    }

    if (request.method === "DELETE") {
      return secure(await endSpeakerSession(request, env));
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  if (url.pathname === "/api/speaker/workspace") {
    if (request.method === "GET") {
      return secure(await getSpeakerWorkspace(request, env));
    }

    if (request.method === "POST") {
      return secure(await updateSpeakerWorkspace(request, env));
    }

    return secure(json({ error: "Method not allowed" }, 405));
  }

  return null;
}

async function redeemSpeakerInvitation(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const token = readBearerToken(request);

  if (!token) {
    return json({ error: "This speaker invitation is invalid." }, 401);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const tokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-invite-token",
  );
  const access = await env
    .INTERESTS!.prepare(
      `SELECT speaker_id, access_generation, invite_expires_at
       FROM speaker_workspace_access
      WHERE invite_token_hash = ?1
        AND revoked_at IS NULL
        AND invite_expires_at > ?2`,
    )
    .bind(tokenHash, nowIso)
    .first<SpeakerAccessRow>();

  if (!access || !findCanonicalSpeaker(access.speaker_id)) {
    return json(
      { error: "This speaker invitation is invalid or expired." },
      401,
    );
  }

  const sessionToken = createToken();
  const sessionHash = await hashToken(
    sessionToken,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-session-token",
  );
  const inviteExpiry = Date.parse(access.invite_expires_at);
  const expiresAt = new Date(
    Math.min(now.getTime() + sessionLifetimeMilliseconds, inviteExpiry),
  );

  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    return json({ error: "This speaker invitation has expired." }, 401);
  }

  await env.INTERESTS!.batch([
    env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_workspace_sessions (
         token_hash,
         speaker_id,
         access_generation,
         created_at,
         last_seen_at,
         expires_at
       ) VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
      )
      .bind(
        sessionHash,
        access.speaker_id,
        access.access_generation,
        nowIso,
        expiresAt.toISOString(),
      ),
    env
      .INTERESTS!.prepare(
        `UPDATE speaker_contacts
          SET email_confirmed_at = COALESCE(email_confirmed_at, ?2),
              updated_at = ?2
        WHERE speaker_id = ?1`,
      )
      .bind(access.speaker_id, nowIso),
    env
      .INTERESTS!.prepare(
        "DELETE FROM speaker_workspace_sessions WHERE expires_at <= ?1",
      )
      .bind(nowIso),
  ]);

  const maxAgeSeconds = Math.max(
    1,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
  );
  const response = json({ authenticated: true });
  response.headers.append(
    "set-cookie",
    serializeSessionCookie(sessionToken, maxAgeSeconds),
  );

  return response;
}

async function endSpeakerSession(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ error: "Request origin was not accepted." }, 403);
  }

  const token = readCookie(request, speakerSessionCookie);

  if (
    token &&
    tokenPattern.test(token) &&
    env.EMAIL_ENCRYPTION_KEY &&
    env.INTERESTS
  ) {
    const tokenHash = await hashToken(
      token,
      env.EMAIL_ENCRYPTION_KEY,
      "speaker-workspace-session-token",
    );

    await env.INTERESTS.prepare(
      "DELETE FROM speaker_workspace_sessions WHERE token_hash = ?1",
    )
      .bind(tokenHash)
      .run();
  }

  const response = json({ authenticated: false });
  response.headers.append("set-cookie", clearSessionCookie());

  return response;
}

async function getSpeakerWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await authenticateSpeaker(request, env);

  if (session instanceof Response) return session;

  return json(await buildWorkspacePayload(session.speaker_id, env));
}

async function updateSpeakerWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ error: "Request origin was not accepted." }, 403);
  }

  const session = await authenticateSpeaker(request, env);

  if (session instanceof Response) return session;

  const body = await readJsonWithinLimit(request, maxWorkspaceBodyBytes);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Submit the workspace form again." }, 400);
  }

  const action = body.action;

  if (action !== "save" && action !== "submit") {
    return json(
      { error: "Choose whether to save or submit the changes." },
      400,
    );
  }

  const canonical = getCanonicalContent(session.speaker_id);

  if (!canonical) {
    return json({ error: "Speaker profile was not found." }, 404);
  }

  const validation = validateSpeakerWorkspaceContent(
    body.content,
    canonical.talks.map(({ id }) => id),
  );

  if (!validation.content) {
    return json(
      {
        error: "Review the highlighted fields.",
        field_errors: validation.errors,
      },
      400,
    );
  }

  const canonicalHash = await hashCanonicalContent(canonical);
  const now = new Date().toISOString();
  const submitted = await env
    .INTERESTS!.prepare(
      `SELECT revision_id
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'submitted'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{ revision_id: string }>();

  if (submitted) {
    return json(
      {
        error:
          "Your submitted changes are awaiting organizer review. You can edit again after that review.",
      },
      409,
    );
  }

  const draft = await env
    .INTERESTS!.prepare(
      `SELECT revision_id, base_content_hash
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'draft'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{ base_content_hash: string; revision_id: string }>();

  if (draft && draft.base_content_hash !== canonicalHash) {
    return json(
      {
        error:
          "The published profile changed after this draft began. Reload the workspace and review the latest version.",
      },
      409,
    );
  }

  const revisionId = draft?.revision_id ?? crypto.randomUUID();
  const contentJson = JSON.stringify(validation.content);

  if (draft) {
    await env
      .INTERESTS!.prepare(
        `UPDATE speaker_content_revisions
          SET content_json = ?2,
              state = ?3,
              submitted_at = CASE WHEN ?3 = 'submitted' THEN ?4 ELSE NULL END,
              updated_at = ?4
        WHERE revision_id = ?1 AND state = 'draft'`,
      )
      .bind(
        revisionId,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        now,
      )
      .run();
  } else {
    await env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_content_revisions (
         revision_id,
         speaker_id,
         base_content_hash,
         content_json,
         state,
         submitted_at,
         created_at,
         updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      )
      .bind(
        revisionId,
        session.speaker_id,
        canonicalHash,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        action === "submit" ? now : null,
        now,
      )
      .run();
  }

  return json({
    ...(await buildWorkspacePayload(session.speaker_id, env)),
    message:
      action === "submit"
        ? "Changes submitted for organizer review."
        : "Draft saved.",
  });
}

async function authenticateSpeaker(
  request: Request,
  env: Env,
): Promise<SpeakerSessionRow | Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const token = readCookie(request, speakerSessionCookie);

  if (!token || !tokenPattern.test(token)) {
    return json({ error: "Sign in with your speaker invitation." }, 401);
  }

  const tokenHash = await hashToken(
    token,
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-workspace-session-token",
  );
  const now = new Date().toISOString();
  const session = await env
    .INTERESTS!.prepare(
      `SELECT
       sessions.token_hash,
       sessions.speaker_id,
       sessions.access_generation,
       sessions.expires_at,
       access.invite_expires_at
     FROM speaker_workspace_sessions AS sessions
     JOIN speaker_workspace_access AS access
       ON access.speaker_id = sessions.speaker_id
      AND access.access_generation = sessions.access_generation
    WHERE sessions.token_hash = ?1
      AND sessions.expires_at > ?2
      AND access.invite_expires_at > ?2
      AND access.revoked_at IS NULL`,
    )
    .bind(tokenHash, now)
    .first<SpeakerSessionRow>();

  if (!session || !findCanonicalSpeaker(session.speaker_id)) {
    const response = json({ error: "Your speaker session has expired." }, 401);
    response.headers.append("set-cookie", clearSessionCookie());

    return response;
  }

  await env
    .INTERESTS!.prepare(
      `UPDATE speaker_workspace_sessions
        SET last_seen_at = ?2
      WHERE token_hash = ?1`,
    )
    .bind(tokenHash, now)
    .run();

  return session;
}

async function buildWorkspacePayload(
  speakerId: string,
  env: Env,
): Promise<Record<string, unknown>> {
  const speaker = findCanonicalSpeaker(speakerId)!;
  const canonical = getCanonicalContent(speakerId)!;
  const revision = await env
    .INTERESTS!.prepare(
      `SELECT
       revision_id,
       base_content_hash,
       content_json,
       state,
       submitted_at,
       updated_at
     FROM speaker_content_revisions
    WHERE speaker_id = ?1 AND state IN ('draft', 'submitted')
    ORDER BY CASE state WHEN 'submitted' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1`,
    )
    .bind(speakerId)
    .first<SpeakerRevisionRow>();
  let content = canonical;

  if (revision) {
    try {
      const parsed = JSON.parse(revision.content_json) as unknown;
      const validated = validateSpeakerWorkspaceContent(
        parsed,
        canonical.talks.map(({ id }) => id),
      );

      if (validated.content) content = validated.content;
    } catch {
      console.error("Invalid stored speaker revision", {
        revisionId: revision.revision_id,
        speakerId,
      });
    }
  }

  return {
    authenticated: true,
    canonical,
    content,
    immutable: {
      photo: speaker.photo,
      speaker_id: speakerId,
      talk_ids: canonical.talks.map(({ id }) => id),
    },
    revision: revision
      ? {
          revision_id: revision.revision_id,
          state: revision.state,
          submitted_at: revision.submitted_at,
          updated_at: revision.updated_at,
        }
      : null,
  };
}

export function validateSpeakerWorkspaceContent(
  value: unknown,
  assignedTalkIds: readonly string[],
): ValidationResult {
  const errors: Record<string, string> = {};

  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !Array.isArray(value.talks)
  ) {
    return {
      errors: { form: "The submitted profile is incomplete." },
    };
  }

  const profileValue = value.profile;
  const name = validateText(profileValue.name, "profile.name", 2, 120, errors);
  const role = validateText(profileValue.role, "profile.role", 2, 160, errors);
  const bio = validateText(profileValue.bio, "profile.bio", 40, 2_000, errors);

  if (bio) validateMarkdown(bio, "profile.bio", errors);

  const profile = {
    bio,
    devto: "",
    github: "",
    linkedin: "",
    name,
    role,
    scholar: "",
    website: "",
    x: "",
  } satisfies SpeakerProfileContent;

  for (const field of socialFields) {
    profile[field] = validateSocialUrl(profileValue[field], field, errors);
  }

  const assigned = new Set(assignedTalkIds);
  const received = new Set<string>();
  const talks: SpeakerTalkContent[] = [];

  for (const [index, talkValue] of value.talks.entries()) {
    const prefix = `talks.${index}`;

    if (!isRecord(talkValue) || typeof talkValue.id !== "string") {
      errors[`${prefix}.id`] = "Talk assignment was not recognized.";
      continue;
    }

    const id = talkValue.id.trim();

    if (!assigned.has(id) || received.has(id)) {
      errors[`${prefix}.id`] = "Talk assignment was not recognized.";
      continue;
    }

    received.add(id);
    const title = validateText(
      talkValue.title,
      `${prefix}.title`,
      4,
      200,
      errors,
    );
    const abstract = validateText(
      talkValue.abstract,
      `${prefix}.abstract`,
      20,
      2_500,
      errors,
    );

    if (abstract) validateMarkdown(abstract, `${prefix}.abstract`, errors);

    talks.push({ abstract, id, title });
  }

  for (const talkId of assigned) {
    if (!received.has(talkId)) {
      errors.talks = "Every assigned talk must be included.";
      break;
    }
  }

  if (received.size !== assigned.size) {
    errors.talks ??= "Talk assignments cannot be changed.";
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : { content: { profile, talks }, errors };
}

function validateText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
  errors: Record<string, string>,
): string {
  if (typeof value !== "string") {
    errors[field] = "This field is required.";
    return "";
  }

  const normalized = value.trim().replace(/\r\n?/gu, "\n");

  if (normalized.length < minLength || normalized.length > maxLength) {
    errors[field] =
      `Use between ${minLength} and ${maxLength.toLocaleString("en")} characters.`;
  }

  return normalized;
}

function validateMarkdown(
  value: string,
  field: string,
  errors: Record<string, string>,
): void {
  if (/<[A-Za-z!/][^>]*>/u.test(value) || /!\[[^\]]*\]\s*\(/u.test(value)) {
    errors[field] = "HTML and embedded images are not supported.";
    return;
  }

  const markdownLinkPattern =
    /\[[^\]]+\]\s*\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;

  for (const match of value.matchAll(markdownLinkPattern)) {
    if (!parseHttpsUrl(match[1])) {
      errors[field] = "Markdown links must use complete HTTPS URLs.";
      return;
    }
  }
}

function validateSocialUrl(
  value: unknown,
  field: SocialField,
  errors: Record<string, string>,
): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value !== "string") {
    errors[`profile.${field}`] = "Enter a complete HTTPS URL.";
    return "";
  }

  const normalized = value.trim();

  if (normalized.length > 2_048) {
    errors[`profile.${field}`] = "URL is too long.";
    return normalized;
  }

  const url = parseHttpsUrl(normalized);

  if (!url) {
    errors[`profile.${field}`] = "Enter a complete HTTPS URL.";
    return normalized;
  }

  if (
    field !== "website" &&
    !socialHosts[field].has(url.hostname.toLowerCase())
  ) {
    errors[`profile.${field}`] = `Enter a ${socialLabel(field)} profile URL.`;
  }

  return url.toString();
}

function socialLabel(field: Exclude<SocialField, "website">): string {
  return {
    devto: "DEV Community",
    github: "GitHub",
    linkedin: "LinkedIn",
    scholar: "Google Scholar",
    x: "X or Twitter",
  }[field];
}

function parseHttpsUrl(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" || url.username || url.password) return null;

    return url;
  } catch {
    return null;
  }
}

function getCanonicalContent(
  speakerId: string,
): SpeakerWorkspaceContent | null {
  const speaker = findCanonicalSpeaker(speakerId);

  if (!speaker) return null;

  return {
    profile: {
      bio: speaker.bio,
      devto: speaker.devto ?? "",
      github: speaker.github ?? "",
      linkedin: speaker.linkedin ?? "",
      name: speaker.name,
      role: speaker.role,
      scholar: speaker.scholar ?? "",
      website: speaker.website ?? "",
      x: speaker.x ?? "",
    },
    talks: canonicalTalks
      .filter(({ speakers }) => speakers.includes(speakerId))
      .map(({ abstract, id, title }) => ({ abstract, id, title })),
  };
}

function findCanonicalSpeaker(speakerId: string): CanonicalSpeaker | undefined {
  return canonicalSpeakers.find(({ id }) => id === speakerId);
}

async function hashCanonicalContent(
  content: SpeakerWorkspaceContent,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(content)),
  );

  return base64UrlEncode(new Uint8Array(digest));
}

function getConfigurationError(env: Env): Response | null {
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

function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization);

  return match?.[1] ?? null;
}

function readCookie(request: Request, name: string): string | null {
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

function serializeSessionCookie(token: string, maxAgeSeconds: number): string {
  return `${speakerSessionCookie}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookie(): string {
  return `${speakerSessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return base64UrlEncode(bytes);
}

async function hashToken(
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

function base64UrlEncode(bytes: Uint8Array): string {
  return base64Encode(bytes)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

async function readJsonWithinLimit(
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function secure(response: Response): Response {
  return withSpeakerWorkspaceSecurityHeaders(response);
}
