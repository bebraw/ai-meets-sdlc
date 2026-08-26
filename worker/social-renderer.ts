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

const manifestPath = "/assets/social/manifest.json";
const renderOrigin = "https://social-render.invalid";
const immutableCacheControl = "public, max-age=31536000, immutable";
const pageTimeoutMilliseconds = 20_000;
const socialCache = (caches as CacheStorage & { readonly default: Cache })
  .default;

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

  if (
    match.isLegacy ||
    !isSocialRenderVersion(match.requestedVersion) ||
    (!match.isLegacy && match.requestedVersion === null)
  ) {
    return versionRedirect(request, asset);
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

  if (requestedVersion !== asset.version) {
    return versionRedirect(request, asset);
  }

  try {
    const image = await renderSocialAsset(env, asset, manifest);
    const stored = await env.SOCIAL_EXPORTS.put(objectKey, image, {
      customMetadata: {
        assetId: asset.id,
        renderer: manifest.renderer,
        version: asset.version,
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
      version: asset.version,
    });

    return responseForMethod(response, request.method);
  } catch (error) {
    console.error("social_render_failed", {
      assetId: asset.id,
      error: getErrorMessage(error),
      version: asset.version,
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

function versionRedirect(request: Request, asset: SocialRenderAsset): Response {
  const url = new URL(asset.path, request.url);
  url.search = "";
  url.searchParams.set("v", asset.version);

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
): Promise<Uint8Array<ArrayBuffer>> {
  let browser: Browser | undefined;

  try {
    browser = await puppeteer.launch(env.SOCIAL_BROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(pageTimeoutMilliseconds);
    await page.setViewport({ width: asset.width, height: asset.height });
    await page.setRequestInterception(true);
    page.on("request", (interceptedRequest) => {
      void respondWithStaticAsset(interceptedRequest, env);
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

async function respondWithStaticAsset(
  interceptedRequest: HTTPRequest,
  env: Env,
): Promise<void> {
  const url = new URL(interceptedRequest.url());
  const isAllowed =
    url.origin === renderOrigin &&
    (url.pathname === "/slides/deck/" ||
      url.pathname.startsWith("/assets/") ||
      /^\/tailwind-[a-z0-9]+\.css$/u.test(url.pathname));

  if (!isAllowed) {
    await interceptedRequest.abort("blockedbyclient");
    return;
  }

  try {
    const assetResponse = await env.ASSETS.fetch(
      new Request(`${renderOrigin}${url.pathname}${url.search}`),
    );
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
