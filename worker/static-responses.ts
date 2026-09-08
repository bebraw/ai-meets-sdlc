const immutableAssetCacheControl = "public, max-age=31536000, immutable";

const adminSlideAssetPaths = new Map([
  ["/admin/slides/", "/admin-slides/"],
  ["/admin/slides/deck/", "/admin-slide-deck/"],
  ["/admin/slides/schedule/", "/admin-slide-schedule/"],
]);

const internalAdminSlidePrefixes = [
  "/admin-slides",
  "/admin-slide-deck",
  "/admin-slide-schedule",
];

export function withStaticAssetCache(response: Response, url: URL): Response {
  if (response.status !== 200 || !isImmutableAssetPath(url.pathname)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", immutableAssetCacheControl);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isImmutableAssetPath(pathname: string): boolean {
  return /^\/tailwind-[a-z0-9]+\.css$/.test(pathname);
}

export function getAssetRequest(request: Request, url: URL): Request {
  const assetPath = adminSlideAssetPaths.get(url.pathname);

  if (!assetPath) return request;

  const assetUrl = new URL(url);
  assetUrl.pathname = assetPath;

  return new Request(assetUrl, request);
}

export function isInternalAdminSlidesPath(pathname: string): boolean {
  return internalAdminSlidePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function getAdminSlideRedirect(url: URL): string | null {
  const canonicalPath = adminSlideAssetPaths.has(`${url.pathname}/`)
    ? `${url.pathname}/`
    : null;

  return canonicalPath ? `${url.origin}${canonicalPath}${url.search}` : null;
}

export function acceptsHtml(request: Request): boolean {
  if (!["GET", "HEAD"].includes(request.method)) return false;

  const accept = request.headers.get("accept") ?? "";

  return accept.includes("text/html");
}

export async function serveNotFound(
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

export async function injectRuntimeConfig(
  response: Response,
  env: Env,
  status = response.status,
): Promise<Response> {
  const html = await response.text();
  const showInterestForm = env.SHOW_INTEREST_FORM === "true";

  return new Response(
    html
      .replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? "")
      .replaceAll(
        "data-interest-section hidden",
        showInterestForm
          ? "data-interest-section"
          : "data-interest-section hidden",
      ),
    {
      headers: response.headers,
      status,
      statusText:
        status === response.status ? response.statusText : "Not Found",
    },
  );
}

export function calendarResponse(): Response {
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
