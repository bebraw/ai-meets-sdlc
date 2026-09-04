interface AdminBindings {
  ADMIN_PASSWORD?: string;
  ADMIN_USERNAME?: string;
}

interface AdminLoginPageOptions {
  error?: string;
  nextPath: string;
  status?: number;
  username?: string;
}

const adminLoginPath = "/admin/login/";
const adminSessionCookie = "__Host-sdlcai-admin-session";
const adminSessionLifetimeSeconds = 7 * 24 * 60 * 60;
const maxAdminLoginBodyBytes = 8 * 1024;
const adminSessionPattern =
  /^v1\.(\d{10})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/u;

export function isAdminProtectedPath(pathname: string): boolean {
  return (
    pathname === "/admin/" ||
    (pathname.startsWith("/admin/") && pathname !== adminLoginPath) ||
    pathname.startsWith("/api/admin/") ||
    pathname === "/assets/slides" ||
    pathname.startsWith("/assets/slides/")
  );
}

export async function handleAdminAuthRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === "/admin/login") {
    const canonicalUrl = new URL(adminLoginPath, url.origin);
    canonicalUrl.search = url.search;

    return withAdminSecurityHeaders(Response.redirect(canonicalUrl, 308));
  }

  if (url.pathname === adminLoginPath) {
    if (request.method === "GET" || request.method === "HEAD") {
      return handleAdminLoginPage(request, env);
    }

    if (request.method === "POST") {
      return handleAdminLogin(request, env);
    }

    return withAdminSecurityHeaders(
      new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET, HEAD, POST" },
      }),
    );
  }

  if (url.pathname === "/admin/logout" || url.pathname === "/admin/logout/") {
    return handleAdminLogout(request);
  }

  return null;
}

export async function requireAdmin(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const adminEnv = env as Env & AdminBindings;

  if (!hasAdminConfiguration(adminEnv)) {
    return withAdminSecurityHeaders(
      new Response("Admin auth is not configured.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }

  if (await isAdminAuthorized(request, adminEnv)) return null;

  const url = new URL(request.url);

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    !url.pathname.startsWith("/api/admin/")
  ) {
    const loginUrl = new URL(adminLoginPath, url.origin);
    loginUrl.searchParams.set("next", `${url.pathname}${url.search}`);

    return withAdminSecurityHeaders(Response.redirect(loginUrl, 303));
  }

  return withAdminSecurityHeaders(
    new Response(
      JSON.stringify({ error: "Admin authentication is required." }),
      {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    ),
  );
}

export function withAdminSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const varyValues = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");

  for (const headerName of ["Authorization", "Cookie"]) {
    if (!varyValues.has(headerName.toLowerCase()))
      headers.append("vary", headerName);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function handleAdminLoginPage(
  request: Request,
  env: Env,
): Promise<Response> {
  const adminEnv = env as Env & AdminBindings;
  const nextPath = getSafeAdminNextPath(
    new URL(request.url).searchParams.get("next"),
    request.url,
  );

  if (!hasAdminConfiguration(adminEnv)) {
    return renderAdminLoginPage(request, env, {
      error: "Admin sign-in is not configured.",
      nextPath,
      status: 503,
    });
  }

  if (await isAdminAuthorized(request, adminEnv)) {
    return withAdminSecurityHeaders(redirectResponse(nextPath, 303));
  }

  return renderAdminLoginPage(request, env, { nextPath });
}

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  const adminEnv = env as Env & AdminBindings;
  const fallbackNextPath = getSafeAdminNextPath(
    new URL(request.url).searchParams.get("next"),
    request.url,
  );

  if (!hasAdminConfiguration(adminEnv)) {
    return renderAdminLoginPage(request, env, {
      error: "Admin sign-in is not configured.",
      nextPath: fallbackNextPath,
      status: 503,
    });
  }

  if (!isSameOriginMutation(request)) {
    return renderAdminLoginPage(request, env, {
      error:
        "This sign-in request could not be verified. Reload and try again.",
      nextPath: fallbackNextPath,
      status: 403,
    });
  }

  const formData = await readAdminLoginForm(request);

  if (formData instanceof Response) {
    return renderAdminLoginPage(request, env, {
      error: await formData.text(),
      nextPath: fallbackNextPath,
      status: formData.status,
    });
  }

  const username = normalizeUsername(formData.get("username"));
  const password = normalizePassword(formData.get("password"));
  const nextPath = getSafeAdminNextPath(formData.get("next"), request.url);

  if (!(await credentialsMatch(username, password, adminEnv))) {
    return renderAdminLoginPage(request, env, {
      error: "The username or password was not accepted.",
      nextPath,
      status: 401,
      username,
    });
  }

  const response = redirectResponse(nextPath, 303);
  response.headers.append(
    "set-cookie",
    await createAdminSessionCookie(adminEnv),
  );

  return withAdminSecurityHeaders(response);
}

function handleAdminLogout(request: Request): Response {
  if (request.method !== "POST") {
    return withAdminSecurityHeaders(
      new Response("Method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      }),
    );
  }

  if (!isSameOriginMutation(request)) {
    return withAdminSecurityHeaders(
      new Response("This sign-out request could not be verified.", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }

  const response = redirectResponse(adminLoginPath, 303);
  response.headers.append("set-cookie", clearAdminSessionCookie());

  return withAdminSecurityHeaders(response);
}

async function renderAdminLoginPage(
  request: Request,
  env: Env,
  options: AdminLoginPageOptions,
): Promise<Response> {
  const assetUrl = new URL(adminLoginPath, request.url);
  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete("content-length");
  assetHeaders.delete("content-type");
  const assetRequest = new Request(assetUrl, {
    headers: assetHeaders,
    method: request.method === "HEAD" ? "HEAD" : "GET",
  });
  const assetResponse = await env.ASSETS.fetch(assetRequest);

  if (!assetResponse.headers.get("content-type")?.includes("text/html")) {
    return withAdminSecurityHeaders(
      new Response("Admin sign-in page is unavailable.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );
  }

  const transformed = new HTMLRewriter()
    .on("[data-admin-login-next]", {
      element(element) {
        element.setAttribute("value", options.nextPath);
      },
    })
    .on("[data-admin-login-username]", {
      element(element) {
        if (options.username) element.setAttribute("value", options.username);
      },
    })
    .on("[data-admin-login-error]", {
      element(element) {
        if (!options.error) return;

        element.removeAttribute("hidden");
        element.setInnerContent(options.error);
      },
    })
    .transform(assetResponse);

  return withAdminSecurityHeaders(
    new Response(transformed.body, {
      headers: transformed.headers,
      status: options.status ?? transformed.status,
      statusText:
        options.status && options.status !== transformed.status
          ? ""
          : transformed.statusText,
    }),
  );
}

async function isAdminAuthorized(
  request: Request,
  adminEnv: Env & Required<AdminBindings>,
): Promise<boolean> {
  const session = readCookie(request, adminSessionCookie);

  if (session && (await verifyAdminSession(session, adminEnv))) return true;

  const credentials = parseBasicAuth(request.headers.get("authorization"));

  return credentials
    ? credentialsMatch(credentials.username, credentials.password, adminEnv)
    : false;
}

async function credentialsMatch(
  username: string,
  password: string,
  adminEnv: Env & Required<AdminBindings>,
): Promise<boolean> {
  const [usernameMatches, passwordMatches] = await Promise.all([
    timingSafeEqual(username, adminEnv.ADMIN_USERNAME),
    timingSafeEqual(password, adminEnv.ADMIN_PASSWORD),
  ]);

  return usernameMatches && passwordMatches;
}

async function createAdminSessionCookie(
  adminEnv: Env & Required<AdminBindings>,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + adminSessionLifetimeSeconds;
  const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const payload = `v1.${expiresAt}.${nonce}`;
  const signature = await signAdminSession(payload, adminEnv);

  return `${adminSessionCookie}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${adminSessionLifetimeSeconds}`;
}

function clearAdminSessionCookie(): string {
  return `${adminSessionCookie}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function verifyAdminSession(
  value: string,
  adminEnv: Env & Required<AdminBindings>,
): Promise<boolean> {
  const match = adminSessionPattern.exec(value);

  if (!match) return false;

  const expiresAt = Number(match[1]);

  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000) {
    return false;
  }

  const payload = `v1.${match[1]}.${match[2]}`;
  const expectedSignature = await signAdminSession(payload, adminEnv);

  return timingSafeEqual(match[3]!, expectedSignature);
}

async function signAdminSession(
  payload: string,
  adminEnv: Env & Required<AdminBindings>,
): Promise<string> {
  const keyMaterial = `${adminEnv.ADMIN_USERNAME}\u0000${adminEnv.ADMIN_PASSWORD}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`admin-session-cookie:${keyMaterial}`),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );

  return base64UrlEncode(new Uint8Array(signature));
}

function hasAdminConfiguration(
  env: Env & AdminBindings,
): env is Env & Required<AdminBindings> {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD);
}

function getSafeAdminNextPath(
  value: FormDataEntryValue | string | null,
  requestUrl: string,
): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/admin/";

  try {
    const requestOrigin = new URL(requestUrl).origin;
    const candidate = new URL(value, requestOrigin);

    if (
      candidate.origin !== requestOrigin ||
      !isAdminProtectedPath(candidate.pathname) ||
      candidate.pathname.startsWith("/api/admin/") ||
      candidate.pathname === "/admin/logout" ||
      candidate.pathname === "/admin/logout/"
    ) {
      return "/admin/";
    }

    return `${candidate.pathname}${candidate.search}`;
  } catch {
    return "/admin/";
  }
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

async function readAdminLoginForm(
  request: Request,
): Promise<FormData | Response> {
  const contentLength = request.headers.get("content-length");

  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) {
      return new Response("Submit the sign-in form again.", { status: 400 });
    }

    if (Number(contentLength) > maxAdminLoginBodyBytes) {
      return new Response("The sign-in submission is too large.", {
        status: 413,
      });
    }
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return new Response("Submit the sign-in form again.", { status: 415 });
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

        if (totalBytes > maxAdminLoginBodyBytes) {
          await reader.cancel();

          return new Response("The sign-in submission is too large.", {
            status: 413,
          });
        }

        chunks.push(value);
      }
    } catch {
      return new Response("Submit the sign-in form again.", { status: 400 });
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
    return await new Request(request.url, {
      body,
      headers: { "content-type": contentType },
      method: "POST",
    }).formData();
  } catch {
    return new Response("Submit the sign-in form again.", { status: 400 });
  }
}

function normalizeUsername(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().slice(0, 254) : "";
}

function normalizePassword(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.slice(0, 4096) : "";
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

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [aHash, bHash] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);

  let difference = 0;

  for (let index = 0; index < aHash.byteLength; index++) {
    difference |= aHash[index]! ^ bHash[index]!;
  }

  return difference === 0;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return new Uint8Array(digest);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function redirectResponse(location: string, status: 303): Response {
  return new Response(null, { status, headers: { location } });
}
