import {
  getCanonicalPhotoUrl,
  getCanonicalTalks,
  hashCanonicalVersions,
  readCanonicalSpeaker,
  renderCanonicalMarkdown,
  type CanonicalSpeakerRecord,
  type SpeakerProfileContent,
} from "./canonical-content";

const canonicalHtmlCacheControl =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
const immutableCacheControl = "public, max-age=31536000, immutable";
const canonicalPhotoPattern =
  /^\/media\/speakers\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.webp$/u;

const socialLinks = [
  ["website", "Website"],
  ["linkedin", "LinkedIn"],
  ["scholar", "Scholar"],
  ["github", "GitHub"],
  ["devto", "DEV"],
  ["x", "X"],
] as const satisfies readonly [keyof SpeakerProfileContent, string][];

export function isCanonicalPublicHtmlPath(pathname: string): boolean {
  return new Set([
    "/admin/slides/",
    "/admin/slides/deck/",
    "/admin/slides/schedule/",
    "/schedule/",
    "/slides/deck/",
    "/slides/schedule/",
    "/speakers/",
  ]).has(pathname);
}

export async function applyCanonicalContentToResponse(
  response: Response,
  records: readonly CanonicalSpeakerRecord[],
  options: { private?: boolean } = {},
): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("text/html")) {
    return response;
  }

  const speakers = new Map(records.map((record) => [record.speakerId, record]));
  const talks = getCanonicalTalks(records);
  const transformed = new HTMLRewriter()
    .on("[data-canonical-speaker-name]", {
      element(element) {
        const record = getSpeakerForElement(element, speakers);
        if (record) element.setInnerContent(record.content.profile.name);
      },
    })
    .on("[data-canonical-speaker-role]", {
      element(element) {
        const record = getSpeakerForElement(element, speakers);
        if (record) element.setInnerContent(record.content.profile.role);
      },
    })
    .on("[data-canonical-speaker-bio]", {
      element(element) {
        const record = getSpeakerForElement(element, speakers);
        if (record) {
          element.setInnerContent(
            renderCanonicalMarkdown(record.content.profile.bio),
            { html: true },
          );
        }
      },
    })
    .on("[data-canonical-speaker-photo]", {
      element(element) {
        const record = getSpeakerForElement(element, speakers);
        if (record) {
          element.setAttribute("src", getCanonicalPhotoUrl(record));
          element.setAttribute("alt", record.content.profile.name);
        }
      },
    })
    .on("[data-canonical-speaker-socials]", {
      element(element) {
        const record = getSpeakerForElement(element, speakers);
        if (record) {
          element.setInnerContent(renderSocialLinks(record.content.profile), {
            html: true,
          });
        }
      },
    })
    .on("[data-canonical-talk-title]", {
      element(element) {
        const talkId = element.getAttribute("data-canonical-talk-id");
        const talk = talkId ? talks.get(talkId) : null;
        if (talk) element.setInnerContent(talk.title);
      },
    })
    .on("[data-canonical-talk-abstract]", {
      element(element) {
        const talkId = element.getAttribute("data-canonical-talk-id");
        const talk = talkId ? talks.get(talkId) : null;
        if (talk) {
          element.setInnerContent(renderCanonicalMarkdown(talk.abstract), {
            html: true,
          });
        }
      },
    })
    .transform(response);
  const headers = new Headers(transformed.headers);

  headers.delete("content-length");
  headers.delete("etag");
  headers.set(
    "cache-control",
    options.private ? "private, no-store" : canonicalHtmlCacheControl,
  );
  headers.set("x-sdlcai-content-source", "d1");
  headers.set("x-sdlcai-content-version", await hashCanonicalVersions(records));

  return new Response(transformed.body, {
    headers,
    status: transformed.status,
    statusText: transformed.statusText,
  });
}

export async function serveCanonicalSpeakerPhoto(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = canonicalPhotoPattern.exec(url.pathname);

  if (!match) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }

  const [, speakerId, requestedHash] = match;

  if (!speakerId || !requestedHash) return null;

  const record = await readCanonicalSpeaker(env, speakerId);

  if (
    !record ||
    record.photoContentHash !== requestedHash ||
    !record.photoR2Key
  ) {
    return new Response("Speaker photo not found.", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const etag = `"${requestedHash}"`;

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { "cache-control": immutableCacheControl, etag },
    });
  }

  const object = await env.SPEAKER_UPLOADS.get(record.photoR2Key);

  if (!object) {
    console.error("canonical_speaker_photo_missing", {
      key: record.photoR2Key,
      speakerId,
    });
    return new Response("Speaker photo temporarily unavailable.", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    });
  }

  const headers = new Headers({
    "cache-control": immutableCacheControl,
    "content-length": String(object.size),
    "content-type": "image/webp",
    etag,
    "x-content-type-options": "nosniff",
  });

  return new Response(request.method === "HEAD" ? null : object.body, {
    headers,
  });
}

function getSpeakerForElement(
  element: Element,
  records: ReadonlyMap<string, CanonicalSpeakerRecord>,
): CanonicalSpeakerRecord | null {
  const speakerId = element.getAttribute("data-canonical-speaker-id");
  return speakerId ? (records.get(speakerId) ?? null) : null;
}

function renderSocialLinks(profile: SpeakerProfileContent): string {
  return socialLinks
    .flatMap(([field, label]) => {
      const url = profile[field];

      return typeof url === "string" && isSafePublicUrl(url)
        ? [
            `<a href="${escapeAttribute(url)}" rel="me noopener noreferrer" class="border border-ink px-3 py-2 text-sm font-bold uppercase transition hover:bg-ink hover:text-paper">${label}</a>`,
          ]
        : [];
    })
    .join("");
}

function isSafePublicUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
