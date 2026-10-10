import { withAdminSecurityHeaders } from "./admin-auth.ts";

// Immutable review revisions. Only these objects are exposed, after admin auth.
const prefix = "/api/admin/intro/";
const assets = new Map([
  [
    "draft-03/preview.mp4",
    {
      key: "intro/draft-03-20261010/preview.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-draft-03-1080p.mp4",
    },
  ],
  [
    "draft-03/4k.mp4",
    {
      key: "intro/draft-03-20261010/4k.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-draft-03-4k.mp4",
    },
  ],
  [
    "draft-03/poster.jpg",
    {
      key: "intro/draft-03-20261010/poster.jpg",
      type: "image/jpeg",
      filename: "sdlcai-intro-draft-03.jpg",
    },
  ],
  [
    "draft-03/music-credit.txt",
    {
      key: "intro/draft-03-20261010/music-credit.txt",
      type: "text/plain; charset=utf-8",
      filename: "sdlcai-intro-draft-03-music-credit.txt",
    },
  ],
  [
    "draft-01/preview.mp4",
    {
      key: "intro/draft-01-20261010/preview.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-draft-01-1080p.mp4",
    },
  ],
  [
    "draft-01/4k.mp4",
    {
      key: "intro/draft-01-20261010/4k.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-draft-01-4k.mp4",
    },
  ],
  [
    "draft-01/poster.jpg",
    {
      key: "intro/draft-01-20261010/poster.jpg",
      type: "image/jpeg",
      filename: "sdlcai-intro-draft-01.jpg",
    },
  ],
  [
    "draft-01/music-credit.txt",
    {
      key: "intro/draft-01-20261010/music-credit.txt",
      type: "text/plain; charset=utf-8",
      filename: "sdlcai-intro-music-credit.txt",
    },
  ],
  [
    "prototypes-02/a.mp4",
    {
      key: "intro/prototypes-02-20261010/a.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-prototype-a-1080p.mp4",
    },
  ],
  [
    "prototypes-02/b.mp4",
    {
      key: "intro/prototypes-02-20261010/b.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-prototype-b-1080p.mp4",
    },
  ],
  [
    "prototypes-02/c.mp4",
    {
      key: "intro/prototypes-02-20261010/c.mp4",
      type: "video/mp4",
      filename: "sdlcai-intro-prototype-c-1080p.mp4",
    },
  ],
  [
    "prototypes-02/a-poster.jpg",
    {
      key: "intro/prototypes-02-20261010/a-poster.jpg",
      type: "image/jpeg",
      filename: "sdlcai-intro-prototype-a.jpg",
    },
  ],
  [
    "prototypes-02/b-poster.jpg",
    {
      key: "intro/prototypes-02-20261010/b-poster.jpg",
      type: "image/jpeg",
      filename: "sdlcai-intro-prototype-b.jpg",
    },
  ],
  [
    "prototypes-02/c-poster.jpg",
    {
      key: "intro/prototypes-02-20261010/c-poster.jpg",
      type: "image/jpeg",
      filename: "sdlcai-intro-prototype-c.jpg",
    },
  ],
  [
    "prototypes-02/music-credit.txt",
    {
      key: "intro/prototypes-02-20261010/music-credit.txt",
      type: "text/plain; charset=utf-8",
      filename: "sdlcai-intro-prototypes-music-credit.txt",
    },
  ],
]);

export async function handleIntroVideoRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(prefix)) return null;
  const asset = assets.get(url.pathname.slice(prefix.length));
  const respond = (
    body: BodyInit | null,
    status: number,
    headers: HeadersInit = {},
  ) => withAdminSecurityHeaders(new Response(body, { status, headers }));
  if (!asset) return respond("Intro asset not found.", 404);
  if (request.method !== "GET" && request.method !== "HEAD")
    return respond("Method not allowed.", 405, { allow: "GET, HEAD" });

  try {
    const key = asset.key;
    const metadata = await env.SOCIAL_EXPORTS.head(key);
    if (!metadata) return respond("Intro asset not found.", 404);
    const headers = new Headers({
      "accept-ranges": "bytes",
      "content-type": asset.type,
      "content-length": String(metadata.size),
      "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${asset.filename}"`,
      etag: metadata.httpEtag,
      "last-modified": metadata.uploaded.toUTCString(),
      "x-content-type-options": "nosniff",
    });
    // HEAD describes the full representation and ignores Range (RFC 9110).
    if (request.method === "HEAD") return respond(null, 200, headers);
    const ifRange = request.headers.get("if-range");
    const range =
      !ifRange ||
      ifRange === metadata.httpEtag ||
      (Number.isFinite(Date.parse(ifRange)) &&
        Math.floor(metadata.uploaded.getTime() / 1000) <=
          Date.parse(ifRange) / 1000)
        ? parseRange(request.headers.get("range"), metadata.size)
        : null;
    if (range === "unsatisfiable") {
      headers.set("content-range", `bytes */${metadata.size}`);
      headers.set("content-length", "0");
      return respond(null, 416, headers);
    }
    const object = await env.SOCIAL_EXPORTS.get(key, {
      ...(range ? { range } : {}),
      onlyIf: { etagMatches: metadata.etag },
    });
    if (!object) return respond("Intro asset not found.", 404);
    if (!("body" in object))
      return respond("The draft changed. Reload and try again.", 412);
    if (range) {
      headers.set("content-length", String(range.length));
      headers.set(
        "content-range",
        `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`,
      );
    }
    // Stream from R2; never buffer a whole video in Worker memory.
    return respond(object.body, range ? 206 : 200, headers);
  } catch {
    return respond(
      "The intro video is temporarily unavailable. Please try again.",
      503,
      {
        "retry-after": "30",
      },
    );
  }
}

function parseRange(
  value: string | null,
  size: number,
): { offset: number; length: number } | "unsatisfiable" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(value.trim());
  // Ignore unsupported multi-ranges and malformed headers; send the full file.
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  if (
    (start !== null && !Number.isSafeInteger(start)) ||
    (end !== null && !Number.isSafeInteger(end))
  )
    return null;
  if (
    !size ||
    (start === null && end === 0) ||
    (start !== null && (start >= size || (end !== null && end < start)))
  )
    return "unsatisfiable";
  const offset = start ?? Math.max(0, size - end!);
  const last =
    start === null || end === null ? size - 1 : Math.min(end, size - 1);
  return { offset, length: last - offset + 1 };
}
