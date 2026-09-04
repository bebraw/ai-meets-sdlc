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

const manifestPath = "/assets/social/manifest.json";
const speakerPromotionManifestPath = "/assets/social/speakers.json";
const renderOrigin = "https://social-render.invalid";
const immutableCacheControl = "public, max-age=31536000, immutable";
const pageTimeoutMilliseconds = 20_000;
const socialCache = (caches as CacheStorage & { readonly default: Cache })
  .default;

interface PromotionManifestSource {
  schemaVersion: number;
  speakers: Array<{
    id: string;
    name: string;
    photo: string;
    talks: Array<{
      assets: Array<{
        height: number;
        path: string;
        presetId: string;
        version: string;
        width: number;
      }>;
      id: string;
      slideId: string;
      title: string;
    }>;
  }>;
  version: string;
}

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
    const [manifest, records, sourceResponse] = await Promise.all([
      readManifest(env),
      readPublicCanonicalSpeakers(env),
      env.ASSETS.fetch(
        new Request(`${renderOrigin}${speakerPromotionManifestPath}`),
      ),
    ]);

    if (!sourceResponse.ok) {
      throw new Error(`Promotion manifest returned ${sourceResponse.status}.`);
    }

    const source = (await sourceResponse.json()) as PromotionManifestSource;

    if (source.schemaVersion !== 1 || !Array.isArray(source.speakers)) {
      throw new Error("Promotion manifest has an invalid contract.");
    }

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
          name: canonical.content.profile.name,
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

                    if (!asset) {
                      throw new Error(
                        `Unknown promotion asset: ${promotionAsset.path}`,
                      );
                    }

                    return {
                      ...promotionAsset,
                      version: await combineCanonicalVersion(
                        asset.version,
                        asset.speakerIds,
                        records,
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
    const version = await combineCanonicalVersion(
      source.version,
      records.map(({ speakerId }) => speakerId),
      records,
    );
    const body = JSON.stringify({ ...source, speakers, version });

    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=300",
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

  if (
    !url.pathname.startsWith("/assets/social/") ||
    !url.pathname.endsWith(".jpg")
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

  try {
    canonicalRecords = await readPublicCanonicalSpeakers(env);
  } catch (error) {
    console.error("social_render_canonical_content_error", {
      assetId: asset.id,
      error: getErrorMessage(error),
    });
    return unavailableResponse();
  }

  const effectiveVersion = await combineCanonicalVersion(
    asset.version,
    asset.speakerIds,
    canonicalRecords,
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

    if (!storedObject && requestedVersion !== effectiveVersion) {
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
    const response = responseFromObject(storedObject);
    cacheResponse(ctx, cacheKey, response.clone(), asset);

    return responseForMethod(response, request.method);
  }

  if (requestedVersion !== effectiveVersion) {
    return versionRedirect(request, asset, effectiveVersion);
  }

  try {
    const image = await renderSocialAsset(
      env,
      asset,
      manifest,
      canonicalRecords,
    );
    const stored = await env.SOCIAL_EXPORTS.put(objectKey, image, {
      customMetadata: {
        assetId: asset.id,
        renderer: manifest.renderer,
        version: effectiveVersion,
      },
      httpMetadata: {
        cacheControl: immutableCacheControl,
        contentType: "image/jpeg",
      },
    });
    const response = imageResponse(image, stored.httpEtag);

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
  return `social/v2/${version}/${asset.slideId}-${asset.presetId}.jpg`;
}

function getLegacyObjectKey(asset: SocialRenderAsset, version: string): string {
  return `social/v1/${version}/${asset.slideId}-${asset.presetId}.jpg`;
}

function responseFromObject(object: R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("cache-control", immutableCacheControl);
  headers.set("content-type", "image/jpeg");
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
}

function imageResponse(image: Uint8Array<ArrayBuffer>, etag: string): Response {
  return new Response(image, {
    headers: {
      "cache-control": immutableCacheControl,
      "content-length": String(image.byteLength),
      "content-type": "image/jpeg",
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
): Promise<Uint8Array<ArrayBuffer>> {
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch(env.SOCIAL_BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(pageTimeoutMilliseconds);
    await page.setViewport({ width: asset.width, height: asset.height });
    await page.setRequestInterception(true);
    page.on("request", (interceptedRequest) => {
      void respondWithRenderAsset(interceptedRequest, env, canonicalRecords);
    });

    const deckUrl = new URL(manifest.deckPath, renderOrigin);
    deckUrl.searchParams.set("slide", String(asset.slideNumber));
    await page.goto(deckUrl.href, { waitUntil: "domcontentloaded" });
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
      Math.abs(bounds.width - asset.width) > 1 ||
      Math.abs(bounds.height - asset.height) > 1
    ) {
      throw new Error(
        `Slide rendered at ${bounds?.width ?? 0}x${bounds?.height ?? 0}; expected ${asset.width}x${asset.height}.`,
      );
    }

    const screenshot = await slide.screenshot({
      type: "jpeg",
      quality: asset.quality,
    });
    const image = new Uint8Array(new ArrayBuffer(screenshot.byteLength));
    image.set(screenshot);

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
        { private: true },
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
