import seed from "../site/data/event-photos.json" with { type: "json" };
import initial from "../production/media-bank/initial-curation.json" with { type: "json" };
import { photoEventContext } from "../site/scripts/photo-context.ts";
import {
  originalContentType,
  photoDownloadName,
  photoObjectFilename,
} from "../site/scripts/photo-files.ts";
import * as v from "valibot";
import { Zip, ZipPassThrough } from "fflate";
import { hasAdminSession, withAdminSecurityHeaders } from "./admin-auth.ts";
import { authenticateSpeaker } from "./speaker-login.ts";
import { readCanonicalSpeaker } from "./canonical-content.ts";
import {
  isSameOriginMutation,
  readJsonWithinLimit,
} from "./speaker-workspace-utils.ts";
import { jsonResponse, requireAdminAction, sha256Hex } from "./form-utils.ts";

const reviewSchema = v.object({
  category: v.picklist([
    "talks",
    "panels",
    "audience",
    "posters",
    "networking",
    "venue",
    "group-photo",
    "behind-the-scenes",
    "uncategorized",
  ]),
  selection: v.picklist(["unreviewed", "selected", "alternate", "rejected"]),
  caption: v.pipe(v.string(), v.maxLength(2000)),
  altText: v.pipe(v.string(), v.maxLength(2000)),
  tags: v.pipe(v.array(v.pipe(v.string(), v.maxLength(100))), v.maxLength(20)),
  relatedTalkIds: v.pipe(v.array(v.string()), v.maxLength(20)),
  depictedSpeakerIds: v.pipe(v.array(v.string()), v.maxLength(20)),
  associationEvidence: v.pipe(v.string(), v.maxLength(2000)),
  notes: v.pipe(v.string(), v.maxLength(2000)),
  revision: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
type Review = v.InferOutput<typeof reviewSchema>;
type BasePhoto = (typeof seed.photos)[number];
type Photo = BasePhoto &
  Review & {
    originalAvailable: boolean;
    images: ReturnType<typeof imagePaths>;
    eventContext: ReturnType<typeof photoEventContext>;
  };
interface Access {
  admin: boolean;
  speakerId: string | null;
  talkIds: Set<string>;
}
interface ReviewRow {
  photo_id: string;
  review_json: string;
  revision: number;
}
const basePhotos = new Map(seed.photos.map((photo) => [photo.id, photo]));
const defaultReviews: Record<string, unknown> = initial.photos;
const knownTalks = new Set(seed.talks.map((talk) => talk.id));
const knownSpeakers = new Set(seed.speakers.map((speaker) => speaker.id));
const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie, Authorization",
  "x-robots-tag": "noindex, nofollow",
};

function parseReview(value: unknown): Review | null {
  const parsed = v.safeParse(reviewSchema, value);
  if (!parsed.success) return null;
  const review = parsed.output;
  if (
    review.relatedTalkIds.some((id) => !knownTalks.has(id)) ||
    review.depictedSpeakerIds.some((id) => !knownSpeakers.has(id)) ||
    (review.depictedSpeakerIds.length > 0 && !review.associationEvidence.trim())
  )
    return null;
  return review;
}

async function accessFor(request: Request, env: Env): Promise<Access> {
  const admin = await hasAdminSession(request, env);
  if (admin) return { admin, speakerId: null, talkIds: new Set() };
  if (
    !request.headers.get("cookie")?.includes("__Host-sdlcai-speaker-session=")
  )
    return { admin: false, speakerId: null, talkIds: new Set() };
  const session = await authenticateSpeaker(request, env);
  if (session instanceof Response) {
    await session.body?.cancel();
    return { admin: false, speakerId: null, talkIds: new Set() };
  }
  const canonical = await readCanonicalSpeaker(env, session.speaker_id);
  return {
    admin: false,
    speakerId: session.speaker_id,
    talkIds: new Set(canonical?.content.talks.map((talk) => talk.id) ?? []),
  };
}

function canReadOriginal(review: Review, access: Access): boolean {
  return (
    access.admin ||
    Boolean(
      access.speakerId &&
      (review.depictedSpeakerIds.includes(access.speakerId) ||
        review.relatedTalkIds.some((id) => access.talkIds.has(id))),
    )
  );
}
function isPublished(review: Review): boolean {
  return ["selected", "alternate"].includes(review.selection);
}
function objectKey(id: string, variant: string): string {
  return `event-photos/${seed.eventId}/${id}/${photoObjectFilename(basePhotos.get(id)!.filename, variant)}`;
}
function imagePaths(photo: BasePhoto) {
  const image = (variant: "thumbnail" | "preview" | "share") => ({
    ...photo.images[variant],
    path: `media/event-photos/${photo.id}/${variant}.jpg`,
  });
  return {
    thumbnail: image("thumbnail"),
    preview: image("preview"),
    share: image("share"),
  };
}

async function readReviews(env: Env): Promise<Map<string, Review>> {
  const rows = await env.INTERESTS.prepare(
    "SELECT photo_id, review_json, revision FROM event_photo_reviews ORDER BY photo_id",
  ).all<ReviewRow>();
  const reviews = new Map<string, Review>();
  for (const [id, value] of Object.entries(defaultReviews)) {
    const review = parseReview(value);
    if (review) reviews.set(id, review);
  }
  for (const row of rows.results) {
    const review = parseReview({
      ...JSON.parse(row.review_json),
      revision: row.revision,
    });
    if (!review) throw new Error("Invalid event photo review");
    reviews.set(row.photo_id, review);
  }
  return reviews;
}

async function catalog(
  request: Request,
  env: Env,
  admin: boolean,
  mine = false,
) {
  const access = await accessFor(request, env);
  if (admin && !access.admin)
    return jsonResponse(
      { error: "Organizer access required." },
      401,
      privateHeaders,
    );
  if (mine && !access.speakerId && !access.admin)
    return jsonResponse(
      {
        error:
          "Sign in through your speaker workspace to see your session photos.",
      },
      401,
      privateHeaders,
    );
  const reviews = await readReviews(env);
  const photos: Photo[] = [];
  for (const base of seed.photos) {
    const review = reviews.get(base.id);
    if (!review || (!admin && !isPublished(review))) continue;
    const originalAvailable = canReadOriginal(review, access);
    if (mine && !originalAvailable) continue;
    const images = imagePaths(base);
    photos.push({
      ...base,
      images,
      ...review,
      notes: admin ? review.notes : "",
      associationEvidence: admin ? review.associationEvidence : "",
      originalAvailable,
      eventContext: photoEventContext({ ...base, ...review }, seed.talks),
    });
  }
  const visibleIds = new Set(photos.map((photo) => photo.id));
  return jsonResponse(
    {
      ...seed,
      sources: seed.sources.filter(
        (source) =>
          admin || photos.some((photo) => photo.sourceId === source.id),
      ),
      similarGroups: admin
        ? seed.similarGroups
        : seed.similarGroups
            .map((group) => ({
              ...group,
              photoIds: group.photoIds.filter((id) => visibleIds.has(id)),
            }))
            .filter((group) => group.photoIds.length > 1),
      categories: admin
        ? seed.categories
        : seed.categories.filter((category) => category !== "uncategorized"),
      selections: admin ? seed.selections : ["selected", "alternate"],
      photos,
      canEdit: admin,
      canDownloadOriginals: access.admin || Boolean(access.speakerId),
      mine,
    },
    200,
    privateHeaders,
  );
}

function credit(photo: BasePhoto, variant: string): string {
  return `${photo.filename} — SDLCAI, 13 October 2026, Marsio, Espoo. Photo: ${photo.photographer}. ${seed.license}: ${seed.licenseUrl}. Source: https://sdlcai.org/2026/photos/?search=${encodeURIComponent(photo.filename)}${variant === "original" ? "" : " Resized and re-encoded for sharing."}`;
}

async function imageResponse(
  request: Request,
  env: Env,
  id: string,
  variant: string,
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  const base = basePhotos.get(id),
    reviews = await readReviews(env),
    review = reviews.get(id);
  if (!base || !review)
    return new Response("Photo not found.", { status: 404 });
  const privateImage = variant === "original";
  if (privateImage || !isPublished(review)) {
    const access = await accessFor(request, env);
    if (
      !canReadOriginal(review, access) ||
      (!isPublished(review) && !access.admin)
    )
      return new Response("Photo access required.", {
        status: 403,
        headers: privateHeaders,
      });
  }
  let body: R2ObjectBody | null = null;
  const object =
    request.method === "HEAD"
      ? await env.SPEAKER_UPLOADS.head(objectKey(id, variant))
      : (body = await env.SPEAKER_UPLOADS.get(objectKey(id, variant)));
  if (!object)
    return new Response("Photo is not available yet.", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  const headers = new Headers(
    privateImage || !isPublished(review)
      ? privateHeaders
      : { "cache-control": "public, max-age=300" },
  );
  headers.set(
    "content-type",
    privateImage ? originalContentType(base.filename) : "image/jpeg",
  );
  headers.set("etag", object.httpEtag);
  headers.set("x-content-type-options", "nosniff");
  headers.set("link", `<${seed.licenseUrl}>; rel="license"`);
  const url = new URL(request.url);
  if (privateImage || url.searchParams.has("download"))
    headers.set(
      "content-disposition",
      `attachment; filename="${photoDownloadName(base.filename, variant)}"`,
    );
  if (request.headers.get("if-none-match") === object.httpEtag) {
    await body?.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(body?.body ?? null, { headers });
}

async function zipResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!isSameOriginMutation(request))
    return jsonResponse({ error: "Origin not accepted." }, 403, privateHeaders);
  const body = await readJsonWithinLimit(request, 24 * 1024);
  if (body instanceof Response) return body;
  const parsed = v.safeParse(
    v.object({
      ids: v.pipe(
        v.array(v.string()),
        v.minLength(1),
        v.maxLength(seed.photos.length),
      ),
      variant: v.picklist(["original", "share"]),
    }),
    body,
  );
  if (!parsed.success)
    return jsonResponse({ error: "Choose photos and a download size." }, 400);
  const access = await accessFor(request, env),
    reviews = await readReviews(env);
  const photos: BasePhoto[] = [];
  for (const id of new Set(parsed.output.ids)) {
    const photo = basePhotos.get(id),
      review = reviews.get(id);
    if (
      !photo ||
      !review ||
      (!isPublished(review) && !access.admin) ||
      (parsed.output.variant === "original" && !canReadOriginal(review, access))
    )
      return jsonResponse(
        {
          error:
            "The selection includes photos you cannot download at this size.",
        },
        403,
        privateHeaders,
      );
    photos.push(photo);
  }
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let pending: Promise<void> = Promise.resolve();
  const zip = new Zip((error, bytes, final) => {
    pending = pending.then(async () => {
      if (error) throw error;
      await writer.write(bytes);
      if (final) await writer.close();
    });
  });
  const produce = async () => {
    try {
      for (const photo of photos) {
        const object = await env.SPEAKER_UPLOADS.get(
          objectKey(photo.id, parsed.output.variant),
        );
        if (!object) throw new Error("Photo unavailable");
        const entry = new ZipPassThrough(
          photoDownloadName(photo.filename, parsed.output.variant),
        );
        zip.add(entry);
        const reader = object.body.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            entry.push(value, false);
            await pending;
          }
          entry.push(new Uint8Array(), true);
          await pending;
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      const entry = new ZipPassThrough("CREDITS.txt");
      zip.add(entry);
      entry.push(
        new TextEncoder().encode(
          photos
            .map((photo) => credit(photo, parsed.output.variant))
            .join("\n\n") + "\n",
        ),
        true,
      );
      const metadata = new ZipPassThrough("catalog.json");
      zip.add(metadata);
      metadata.push(
        new TextEncoder().encode(
          JSON.stringify(
            {
              eventId: seed.eventId,
              license: seed.license,
              licenseUrl: seed.licenseUrl,
              photos: photos.map((photo) => ({
                id: photo.id,
                filename: photo.filename,
                photographer: photo.photographer,
                capturedLocal: photo.capturedLocal,
                caption: reviews.get(photo.id)!.caption,
                category: reviews.get(photo.id)!.category,
                relatedTalkIds: reviews.get(photo.id)!.relatedTalkIds,
                eventContext: photoEventContext(
                  {
                    ...photo,
                    ...reviews.get(photo.id)!,
                  },
                  seed.talks,
                ),
                attribution: credit(photo, parsed.output.variant),
              })),
            },
            null,
            2,
          ),
        ),
        true,
      );
      zip.end();
      await pending;
    } catch (error) {
      zip.terminate();
      await writer.abort(error).catch(() => {});
    }
  };
  ctx.waitUntil(produce());
  return new Response(stream.readable, {
    headers: {
      ...privateHeaders,
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="sdlcai-2026-${parsed.output.variant}-${photos.length}-photos.zip"`,
    },
  });
}

export async function backupEventPhotoReviews(env: Env): Promise<void> {
  const rows = (
    await env.INTERESTS.prepare(
      "SELECT * FROM event_photo_reviews ORDER BY photo_id",
    ).all()
  ).results;
  const hash = await sha256Hex(JSON.stringify(rows));
  const latest = await env.INTEREST_BACKUPS.head("event-photos/latest.json");
  if (latest?.customMetadata?.rows_hash === hash) return;
  const key = `event-photos/snapshots/${hash}.json`,
    exportedAt = new Date().toISOString();
  const options = {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: hash },
  };
  await env.INTEREST_BACKUPS.put(
    key,
    JSON.stringify({ exportedAt, rows }),
    options,
  );
  await env.INTEREST_BACKUPS.put(
    "event-photos/latest.json",
    JSON.stringify({ exportedAt, key, rows_hash: hash }),
    options,
  );
}

export async function handleEventPhotos(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url),
    pathname = url.pathname;
  if (
    !pathname.startsWith("/media/event-photos/") &&
    !pathname.startsWith("/api/photos/") &&
    !pathname.startsWith("/api/admin/photos/") &&
    pathname !== "/api/speaker/photo-bank"
  )
    return null;
  try {
    const image =
      /^\/media\/event-photos\/(photo-[a-f0-9]{20})\/(thumbnail|preview|share|original)\.jpg$/.exec(
        pathname,
      );
    if (image) return await imageResponse(request, env, image[1]!, image[2]!);
    if (pathname === "/api/photos/download" && request.method === "POST")
      return await zipResponse(request, env, ctx);
    if (
      [
        "/api/photos/catalog",
        "/api/admin/photos/catalog",
        "/api/speaker/photo-bank",
      ].includes(pathname) &&
      request.method === "GET"
    )
      return await catalog(
        request,
        env,
        pathname.includes("/admin/"),
        pathname.includes("/speaker/"),
      );
    if (pathname === "/api/photos/credits" && request.method === "GET") {
      const reviews = await readReviews(env);
      return new Response(
        seed.photos
          .filter((photo) => {
            const review = reviews.get(photo.id);
            return review && isPublished(review);
          })
          .map((photo) => credit(photo, "share"))
          .join("\n\n"),
        {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition":
              "attachment; filename=sdlcai-photo-credits.txt",
            "cache-control": "no-store",
          },
        },
      );
    }
    const edit = /^\/api\/admin\/photos\/(photo-[a-f0-9]{20})$/.exec(pathname);
    if (edit && request.method === "POST") {
      if (!(await hasAdminSession(request, env)))
        return jsonResponse(
          { error: "Organizer access required." },
          401,
          privateHeaders,
        );
      const forbidden = requireAdminAction(request, "save-event-photo");
      if (forbidden) return forbidden;
      if (!basePhotos.has(edit[1]!))
        return jsonResponse({ error: "Photo not found." }, 404);
      const body = await readJsonWithinLimit(request, 24 * 1024);
      if (body instanceof Response) return body;
      const review = parseReview(body);
      if (!review)
        return jsonResponse(
          {
            error:
              "Check the photo fields. Person tags require confirmation evidence.",
          },
          400,
        );
      const id = edit[1]!,
        defaults = parseReview(defaultReviews[id]);
      if (!defaults) throw new Error("Missing photo defaults");
      const result = await env.INTERESTS.prepare(
        `INSERT INTO event_photo_reviews (photo_id, review_json, revision, updated_at)
        SELECT ?1, ?2, ?3 + 1, ?4 WHERE ?3 = ?5 OR EXISTS (SELECT 1 FROM event_photo_reviews WHERE photo_id = ?1)
        ON CONFLICT(photo_id) DO UPDATE SET review_json = excluded.review_json, revision = excluded.revision, updated_at = excluded.updated_at WHERE event_photo_reviews.revision = ?3`,
      )
        .bind(
          id,
          JSON.stringify(review),
          review.revision,
          new Date().toISOString(),
          defaults.revision,
        )
        .run();
      if (!result.meta.changes)
        return jsonResponse(
          { error: "This photo changed. Reload before saving." },
          409,
          privateHeaders,
        );
      ctx.waitUntil(backupEventPhotoReviews(env));
      const base = basePhotos.get(id)!;
      return withAdminSecurityHeaders(
        jsonResponse({
          ...base,
          images: imagePaths(base),
          ...review,
          revision: review.revision + 1,
          originalAvailable: true,
          eventContext: photoEventContext({ ...base, ...review }, seed.talks),
        }),
      );
    }
    return jsonResponse(
      { error: "Not found or method not allowed." },
      404,
      privateHeaders,
    );
  } catch (error) {
    console.error("event_photo_bank_unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      { error: "The photo bank is temporarily unavailable. Please retry." },
      503,
      privateHeaders,
    );
  }
}
