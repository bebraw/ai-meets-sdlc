import puppeteer, {
  type Browser,
  type HTTPRequest,
} from "@cloudflare/puppeteer";
import {
  isSocialRenderVersion,
  matchSocialRenderAsset,
  parseSocialRenderManifest,
  type SocialRenderAsset,
  type SocialRenderManifest,
} from "./social-render-contract";
import {
  combineCanonicalVersion,
  getCanonicalPhotoUrl,
  getCanonicalTalks,
  readPublicCanonicalSpeakers,
  type CanonicalSpeakerRecord,
} from "./canonical-content";
import {
  applyCanonicalContentToResponse,
  serveCanonicalSpeakerPhoto,
} from "./public-content";
import {
  readScheduleOrder,
  scheduleSlideIds,
  withScheduleVersion,
  type ScheduleOrder,
} from "./schedule-order.ts";
import { parsePromotionManifestSource } from "./speaker-promotion-contract.ts";
import { formatSpeakerName } from "../site/scripts/speaker-name.ts";
import { sha256Hex } from "./form-utils.ts";
import {
  is4kPng,
  videoExportManifestPath,
  videoRenderCss,
  type VideoExportManifest,
} from "../site/scripts/video-export-contract.ts";

const manifestPath = "/assets/social/manifest.json";
const speakerPromotionManifestPath = "/assets/social/speakers.json";
const renderOrigin = "https://social-render.invalid";
const immutableCacheControl = "public, max-age=31536000, immutable";
const pageTimeoutMilliseconds = 20_000;
const socialCache = (caches as CacheStorage & { readonly default: Cache })
  .default;

export async function handleSpeakerPromotionManifestRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname !== speakerPromotionManifestPath) return null;

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  }

  try {
    const [manifest, records, sourceResponse, schedule] = await Promise.all([
      readManifest(env),
      readPublicCanonicalSpeakers(env),
      env.ASSETS.fetch(
        new Request(`${renderOrigin}${speakerPromotionManifestPath}`),
      ),
      readScheduleOrder(env),
    ]);

    if (!sourceResponse.ok) {
      throw new Error(`Promotion manifest returned ${sourceResponse.status}.`);
    }

    const source = parsePromotionManifestSource(await sourceResponse.json());

    const bySpeaker = new Map(
      records.map((record) => [record.speakerId, record]),
    );
    const talks = getCanonicalTalks(records);
    const assets = new Map(manifest.assets.map((asset) => [asset.path, asset]));
    const speakers = await Promise.all(
      source.speakers.map(async (speaker) => {
        const canonical = bySpeaker.get(speaker.id);

        if (!canonical) {
          throw new Error(`Unknown promotion speaker: ${speaker.id}`);
        }

        return {
          ...speaker,
          name: formatSpeakerName(canonical.content.profile),
          photo: getCanonicalPhotoUrl(canonical),
          talks: await Promise.all(
            speaker.talks.map(async (talk) => {
              const canonicalTalk = talks.get(talk.id);

              if (!canonicalTalk) {
                throw new Error(`Unknown promotion talk: ${talk.id}`);
              }

              return {
                ...talk,
                title: canonicalTalk.title,
                assets: await Promise.all(
                  talk.assets.map(async (promotionAsset) => {
                    const asset = assets.get(promotionAsset.path);

                    if (
                      !asset ||
                      asset.version !== promotionAsset.version ||
                      asset.slideId !== talk.slideId ||
                      asset.presetId !== promotionAsset.presetId ||
                      asset.width !== promotionAsset.width ||
                      asset.height !== promotionAsset.height
                    ) {
                      throw new Error(
                        `Promotion asset does not match render manifest: ${promotionAsset.path}`,
                      );
                    }

                    return {
                      ...promotionAsset,
                      version: await scheduleAssetVersion(
                        asset,
                        records,
                        schedule,
                      ),
                    };
                  }),
                ),
              };
            }),
          ),
        };
      }),
    );
    const version = await withScheduleVersion(
      await combineCanonicalVersion(
        source.version,
        records.map(({ speakerId }) => speakerId),
        records,
      ),
      schedule,
    );
    const body = JSON.stringify({ ...source, speakers, version });

    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "cache-control": "no-store",
        "content-length": String(new TextEncoder().encode(body).byteLength),
        "content-type": "application/json; charset=utf-8",
        "x-sdlcai-content-source": "d1",
        "x-sdlcai-content-version": version,
      },
    });
  } catch (error) {
    console.error("speaker_promotion_manifest_error", {
      error: getErrorMessage(error),
    });
    return new Response(
      JSON.stringify({
        error: "Promotion graphics are temporarily unavailable.",
      }),
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
          "retry-after": "60",
        },
      },
    );
  }
}

export async function handleSocialRenderRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (url.pathname === videoExportManifestPath)
    return handleVideoExportManifest(request, env);

  if (
    !url.pathname.startsWith("/assets/social/") ||
    !(
      url.pathname.endsWith(".jpg") ||
      (url.pathname.startsWith("/assets/social/video/") &&
        url.pathname.endsWith(".png"))
    )
  ) {
    return null;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed.", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  let manifest: SocialRenderManifest;

  try {
    manifest = await readManifest(env);
  } catch (error) {
    console.error("social_render_manifest_error", {
      error: getErrorMessage(error),
    });

    return unavailableResponse();
  }

  const match = matchSocialRenderAsset(url, manifest);

  if (!match) {
    return new Response("Social graphic not found.", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  const { asset } = match;
  let canonicalRecords: CanonicalSpeakerRecord[];
  let schedule: ScheduleOrder;

  try {
    [canonicalRecords, schedule] = await Promise.all([
      readPublicCanonicalSpeakers(env),
      readScheduleOrder(env),
    ]);
  } catch (error) {
    console.error("social_render_canonical_content_error", {
      assetId: asset.id,
      error: getErrorMessage(error),
    });
    return unavailableResponse();
  }

  const effectiveVersion = await scheduleAssetVersion(
    asset,
    canonicalRecords,
    schedule,
  );

  if (
    match.isLegacy ||
    !isSocialRenderVersion(match.requestedVersion) ||
    (!match.isLegacy && match.requestedVersion === null)
  ) {
    return versionRedirect(request, asset, effectiveVersion);
  }

  const requestedVersion = match.requestedVersion;
  const cacheKey = getCacheKey(request, asset, requestedVersion);
  const cachedResponse = await readCachedResponse(cacheKey, asset);

  if (cachedResponse) {
    return responseForMethod(cachedResponse, request.method);
  }

  const objectKey = getObjectKey(asset, requestedVersion);
  let storedObject: R2ObjectBody | null;

  try {
    storedObject = await env.SOCIAL_EXPORTS.get(objectKey);

    if (
      !storedObject &&
      requestedVersion !== effectiveVersion &&
      asset.presetId !== "video"
    ) {
      storedObject = await env.SOCIAL_EXPORTS.get(
        getLegacyObjectKey(asset, requestedVersion),
      );
    }
  } catch (error) {
    console.error("social_render_r2_read_error", {
      assetId: asset.id,
      error: getErrorMessage(error),
      version: requestedVersion,
    });

    return unavailableResponse();
  }

  if (storedObject) {
    const response = responseFromObject(storedObject, asset);
    cacheResponse(ctx, cacheKey, response.clone(), asset);

    return responseForMethod(response, request.method);
  }

  if (requestedVersion !== effectiveVersion) {
    if (asset.presetId === "video" && url.searchParams.get("snapshot") === "1")
      return new Response("The slides changed. Please restart the download.", {
        status: 409,
        headers: { "cache-control": "no-store" },
      });
    return versionRedirect(request, asset, effectiveVersion);
  }

  try {
    const image = await renderSocialAsset(
      env,
      asset,
      manifest,
      canonicalRecords,
      schedule,
    );
    const stored = await env.SOCIAL_EXPORTS.put(objectKey, image, {
      customMetadata: {
        assetId: asset.id,
        renderer: manifest.renderer,
        version: effectiveVersion,
      },
      httpMetadata: {
        cacheControl: immutableCacheControl,
        contentType: imageContentType(asset),
      },
    });
    const response = imageResponse(image, stored.httpEtag, asset);

    cacheResponse(ctx, cacheKey, response.clone(), asset);
    console.log("social_render_generated", {
      assetId: asset.id,
      bytes: image.byteLength,
      version: effectiveVersion,
    });

    return responseForMethod(response, request.method);
  } catch (error) {
    console.error("social_render_failed", {
      assetId: asset.id,
      error: getErrorMessage(error),
      version: effectiveVersion,
    });

    return unavailableResponse();
  }
}

async function handleVideoExportManifest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method not allowed.", {
      status: 405,
      headers: { allow: "GET, HEAD", "cache-control": "no-store" },
    });
  try {
    const [manifest, records, schedule] = await Promise.all([
      readManifest(env),
      readPublicCanonicalSpeakers(env),
      readScheduleOrder(env),
    ]);
    const bySlide = new Map(
      manifest.assets
        .filter((asset) => asset.presetId === "video")
        .map((asset) => [asset.slideId, asset]),
    );
    const assets = await Promise.all(
      scheduleSlideIds(schedule).map(async (slideId, index) => {
        const asset = bySlide.get(slideId);
        if (!asset) throw new Error(`Missing video export for ${slideId}.`);
        return {
          slideId,
          path: asset.path,
          version: await scheduleAssetVersion(asset, records, schedule),
          filename: `${String(index + 1).padStart(2, "0")}-${slideId}.png`,
        };
      }),
    );
    const version = await sha256Hex(JSON.stringify(assets));
    const body: VideoExportManifest = {
      filename: `sdlcai-2026-session-slides-4k-${version.slice(0, 12)}.zip`,
      assets,
    };
    return new Response(
      request.method === "HEAD" ? null : JSON.stringify(body),
      {
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  } catch (error) {
    console.error("video_export_manifest_error", {
      error: getErrorMessage(error),
    });
    return unavailableResponse();
  }
}

async function readCachedResponse(
  cacheKey: Request,
  asset: SocialRenderAsset,
): Promise<Response | undefined> {
  try {
    return await socialCache.match(cacheKey);
  } catch (error) {
    console.warn("social_render_cache_read_error", {
      assetId: asset.id,
      error: getErrorMessage(error),
    });
    return undefined;
  }
}

function cacheResponse(
  ctx: ExecutionContext,
  cacheKey: Request,
  response: Response,
  asset: SocialRenderAsset,
): void {
  ctx.waitUntil(
    socialCache.put(cacheKey, response).catch((error: unknown) => {
      console.warn("social_render_cache_write_error", {
        assetId: asset.id,
        error: getErrorMessage(error),
      });
    }),
  );
}

async function readManifest(env: Env): Promise<SocialRenderManifest> {
  const response = await env.ASSETS.fetch(
    new Request(`${renderOrigin}${manifestPath}`),
  );

  if (!response.ok) {
    throw new Error(`Manifest asset returned ${response.status}.`);
  }

  return parseSocialRenderManifest(await response.json());
}

function versionRedirect(
  request: Request,
  asset: SocialRenderAsset,
  version: string,
): Response {
  const url = new URL(asset.path, request.url);
  url.search = "";
  url.searchParams.set("v", version);

  return Response.redirect(url, 307);
}

function getCacheKey(
  request: Request,
  asset: SocialRenderAsset,
  version: string,
): Request {
  const url = new URL(asset.path, request.url);
  url.search = "";
  url.searchParams.set("v", version);

  return new Request(url, { method: "GET" });
}

function getObjectKey(asset: SocialRenderAsset, version: string): string {
  if (asset.presetId === "video")
    return `social/video/v1/${version}/${asset.slideId}.png`;
  return `social/v2/${version}/${asset.slideId}-${asset.presetId}.jpg`;
}

function getLegacyObjectKey(asset: SocialRenderAsset, version: string): string {
  return `social/v1/${version}/${asset.slideId}-${asset.presetId}.jpg`;
}

function imageContentType(asset: SocialRenderAsset): string {
  return asset.presetId === "video" ? "image/png" : "image/jpeg";
}

function responseFromObject(
  object: R2ObjectBody,
  asset: SocialRenderAsset,
): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", immutableCacheControl);
  headers.set("content-type", imageContentType(asset));
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
}

function imageResponse(
  image: Uint8Array<ArrayBuffer>,
  etag: string,
  asset: SocialRenderAsset,
): Response {
  return new Response(image, {
    headers: {
      "cache-control": immutableCacheControl,
      "content-length": String(image.byteLength),
      "content-type": imageContentType(asset),
      etag,
    },
  });
}

function responseForMethod(response: Response, method: string): Response {
  if (method !== "HEAD") return response;

  return new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function renderSocialAsset(
  env: Env,
  asset: SocialRenderAsset,
  manifest: SocialRenderManifest,
  canonicalRecords: readonly CanonicalSpeakerRecord[],
  schedule: ScheduleOrder,
): Promise<Uint8Array<ArrayBuffer>> {
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch(env.SOCIAL_BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(pageTimeoutMilliseconds);
    const isVideo = asset.presetId === "video";
    const scale = isVideo ? 2 : 1;
    await page.setViewport({
      width: asset.width / scale,
      height: asset.height / scale,
      deviceScaleFactor: scale,
    });
    if (isVideo)
      await page.emulateMediaFeatures([
        { name: "prefers-reduced-motion", value: "reduce" },
      ]);
    await page.setRequestInterception(true);
    page.on("request", (interceptedRequest) => {
      void respondWithRenderAsset(
        interceptedRequest,
        env,
        canonicalRecords,
        schedule,
      );
    });

    const deckUrl = new URL(manifest.deckPath, renderOrigin);
    deckUrl.searchParams.set("slideId", asset.slideId);
    await page.goto(deckUrl.href, { waitUntil: "domcontentloaded" });
    if (isVideo) await page.addStyleTag({ content: videoRenderCss });
    await page.evaluate(async () => {
      await document.fonts.ready;
      const activeImages = [
        ...document.querySelectorAll<HTMLImageElement>(
          ".presentation-slide.is-active img",
        ),
      ];

      await Promise.all(
        activeImages.map(async (image) => {
          await image.decode();
          if (image.naturalWidth === 0) {
            throw new Error(`Could not decode slide image: ${image.src}`);
          }
        }),
      );
    });

    const slide = await page.$(
      `[data-presentation-slide][data-slide-id="${asset.slideId}"].is-active`,
    );

    if (!slide) throw new Error("Expected slide did not become active.");

    const bounds = await slide.boundingBox();

    if (
      !bounds ||
      Math.abs(bounds.width - asset.width / scale) > 1 ||
      Math.abs(bounds.height - asset.height / scale) > 1
    ) {
      throw new Error(
        `Slide rendered at ${bounds?.width ?? 0}x${bounds?.height ?? 0}; expected ${asset.width}x${asset.height}.`,
      );
    }

    const screenshot = await slide.screenshot(
      isVideo
        ? { type: "png" }
        : {
            type: "jpeg",
            quality: asset.quality ?? 92,
          },
    );
    const image = new Uint8Array(new ArrayBuffer(screenshot.byteLength));
    image.set(screenshot);

    if (isVideo && !is4kPng(image))
      throw new Error("Video export is not a 3840x2160 PNG.");

    if (image.byteLength > asset.maxBytes) {
      throw new Error(
        `Rendered image is ${image.byteLength} bytes; limit is ${asset.maxBytes}.`,
      );
    }

    return image;
  } finally {
    await browser?.close();
  }
}

async function respondWithRenderAsset(
  interceptedRequest: HTTPRequest,
  env: Env,
  canonicalRecords: readonly CanonicalSpeakerRecord[],
  schedule: ScheduleOrder,
): Promise<void> {
  const url = new URL(interceptedRequest.url());
  const isAllowed =
    url.origin === renderOrigin &&
    (url.pathname === "/slides/deck/" ||
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/media/speakers/") ||
      /^\/tailwind-[a-z0-9]+\.css$/u.test(url.pathname));

  if (!isAllowed) {
    await interceptedRequest.abort("blockedbyclient");
    return;
  }

  try {
    const renderRequest = new Request(
      `${renderOrigin}${url.pathname}${url.search}`,
    );
    const photoResponse = await serveCanonicalSpeakerPhoto(renderRequest, env);
    let assetResponse =
      photoResponse ?? (await env.ASSETS.fetch(renderRequest));

    if (url.pathname === "/slides/deck/" && assetResponse.ok) {
      assetResponse = await applyCanonicalContentToResponse(
        assetResponse,
        canonicalRecords,
        { private: true, schedule },
      );
    }
    const body = new Uint8Array(await assetResponse.arrayBuffer());
    const headers: Record<string, string> = {};

    for (const name of [
      "cache-control",
      "content-type",
      "etag",
      "last-modified",
    ]) {
      const value = assetResponse.headers.get(name);
      if (value) headers[name] = value;
    }

    await interceptedRequest.respond({
      body,
      headers,
      status: assetResponse.status,
    });
  } catch (error) {
    console.error("social_render_asset_error", {
      error: getErrorMessage(error),
      pathname: url.pathname,
    });
    await interceptedRequest.abort("failed");
  }
}

function unavailableResponse(): Response {
  return new Response("Social graphic generation is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": "60",
    },
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function scheduleAssetVersion(
  asset: SocialRenderAsset,
  records: readonly CanonicalSpeakerRecord[],
  order: ScheduleOrder,
): Promise<string> {
  const group = order.groups.find(
    (item) => `session-${item.id}` === asset.slideId,
  );
  const speakerIds = group
    ? records
        .filter((record) =>
          record.content.talks.some((talk) => group.talkIds.includes(talk.id)),
        )
        .map((record) => record.speakerId)
    : asset.speakerIds;
  return withScheduleVersion(
    await combineCanonicalVersion(asset.version, speakerIds, records),
    order,
  );
}
