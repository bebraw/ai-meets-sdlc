import {
  getCanonicalTalks,
  readPublicCanonicalSpeakers,
  type CanonicalSpeakerRecord,
} from "./canonical-content.ts";
import {
  plainText,
  reviseFeed,
  sessionContent,
  type EventFeed,
} from "./event-feed-data.ts";

export async function applyFeedContent(
  seed: EventFeed,
  records: readonly CanonicalSpeakerRecord[],
): Promise<EventFeed> {
  const feed = structuredClone(seed);
  const speakers = new Map(records.map((record) => [record.speakerId, record]));
  const talks = getCanonicalTalks(records);
  feed.speakers = feed.speakers.map((speaker) => {
    const record = speakers.get(speaker.id);
    if (!record) throw new Error(`Missing published speaker: ${speaker.id}`);
    const updatedAt = new Date(record.updatedAt).toISOString();
    if (updatedAt > feed.updatedAt) feed.updatedAt = updatedAt;
    return {
      ...speaker,
      name: plainText(record.content.profile.name),
      summary: plainText(record.content.profile.bio),
    };
  });
  feed.sessions = feed.sessions.map((session) => {
    const talk = talks.get(session.id);
    if (!talk) throw new Error(`Missing published talk: ${session.id}`);
    return { ...session, ...sessionContent(talk.title, talk.abstract) };
  });
  return reviseFeed(feed);
}

export function feedResponse(
  request: Request,
  body: string,
  etag: string,
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "ETag",
    "cache-control": "public, max-age=300",
    etag,
  });
  const matches = request.headers
    .get("if-none-match")
    ?.split(",")
    .some(
      (value) =>
        value.trim().replace(/^W\//, "") === etag || value.trim() === "*",
    );
  return new Response(matches || request.method === "HEAD" ? null : body, {
    status: matches ? 304 : 200,
    headers,
  });
}

export async function handleEventFeed(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "If-None-Match",
      },
    });
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", {
      status: 405,
      headers: {
        allow: "GET, HEAD, OPTIONS",
        "access-control-allow-origin": "*",
      },
    });
  try {
    const url = new URL(request.url);
    const asset = await env.ASSETS.fetch(
      new Request(new URL(url.pathname, url.origin)),
    );
    if (!asset.ok) throw new Error("Feed asset unavailable");
    if (url.pathname === "/event.schema.json") {
      const body = await asset.text();
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body),
      );
      const etag = `"${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
      return feedResponse(request, body, etag);
    }
    const seed = await asset.json<EventFeed>();
    const feed = await applyFeedContent(
      seed,
      await readPublicCanonicalSpeakers(env),
    );
    return feedResponse(request, JSON.stringify(feed), `"${feed.revision}"`);
  } catch {
    // A failed refresh must not replace a consumer's last valid snapshot with stale seed data.
    return new Response(
      JSON.stringify({ error: "Event feed temporarily unavailable" }),
      {
        status: 503,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
          "retry-after": "60",
        },
      },
    );
  }
}
