import * as v from "valibot";

const digestPattern = /^[a-f0-9]{64}$/u;
const slideIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const speakerIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const presetContracts = {
  bluesky: { height: 900, maxBytes: 1_000_000, quality: 86, width: 1600 },
  linkedin: {
    height: 627,
    maxBytes: 5 * 1024 * 1024,
    quality: 92,
    width: 1200,
  },
  x: {
    height: 900,
    maxBytes: 5 * 1024 * 1024,
    quality: 92,
    width: 1600,
  },
} as const;

const socialRenderAssetSchema = v.object({
  height: v.number(),
  id: v.string(),
  legacyPath: v.string(),
  maxBytes: v.number(),
  path: v.string(),
  presetId: v.picklist(["bluesky", "linkedin", "x"]),
  quality: v.number(),
  slideId: v.pipe(v.string(), v.regex(slideIdPattern)),
  slideNumber: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  speakerIds: v.array(v.pipe(v.string(), v.regex(speakerIdPattern))),
  version: v.pipe(v.string(), v.regex(digestPattern)),
  width: v.number(),
});
const socialRenderManifestSchema = v.object({
  assets: v.array(socialRenderAssetSchema),
  deckPath: v.literal("/slides/deck/"),
  renderer: v.literal("browser-run-v2"),
  schemaVersion: v.literal(2),
  version: v.pipe(v.string(), v.regex(digestPattern)),
});
export type SocialRenderAsset = v.InferOutput<typeof socialRenderAssetSchema>;
export type SocialRenderManifest = v.InferOutput<
  typeof socialRenderManifestSchema
>;

export interface SocialRenderMatch {
  asset: SocialRenderAsset;
  isLegacy: boolean;
  requestedVersion: string | null;
}

function isSocialRenderAsset(asset: SocialRenderAsset): boolean {
  const preset = presetContracts[asset.presetId];
  const dimensions = `${preset.width}x${preset.height}`;
  const expectedPath = `/assets/social/${asset.presetId}/sdlcai-2026-${asset.slideId}-${asset.presetId}-${dimensions}.jpg`;
  const expectedLegacyPath = `/assets/social/${asset.presetId}/sdlcai-2026-slide-${String(asset.slideNumber).padStart(2, "0")}-${asset.presetId}-${dimensions}.jpg`;

  return (
    asset.id === `${asset.slideId}:${asset.presetId}` &&
    asset.path === expectedPath &&
    asset.legacyPath === expectedLegacyPath &&
    asset.width === preset.width &&
    asset.height === preset.height &&
    asset.maxBytes === preset.maxBytes &&
    asset.quality === preset.quality &&
    asset.speakerIds.every(
      (speakerId, index) =>
        index === 0 || speakerId > String(asset.speakerIds[index - 1]),
    )
  );
}

export function parseSocialRenderManifest(
  value: unknown,
): SocialRenderManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Social render manifest is not an object.");
  }

  const result = v.safeParse(socialRenderManifestSchema, value);
  if (!result.success || !result.output.assets.every(isSocialRenderAsset)) {
    throw new Error("Social render manifest has an invalid contract.");
  }
  const manifest = result.output;

  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();

  for (const asset of manifest.assets) {
    if (
      assetIds.has(asset.id) ||
      assetPaths.has(asset.path) ||
      assetPaths.has(asset.legacyPath)
    ) {
      throw new Error("Social render manifest contains duplicate identifiers.");
    }

    assetIds.add(asset.id);
    assetPaths.add(asset.path);
    assetPaths.add(asset.legacyPath);
  }

  return manifest;
}

export function matchSocialRenderAsset(
  url: URL,
  manifest: SocialRenderManifest,
): SocialRenderMatch | null {
  const asset = manifest.assets.find(
    (candidate) =>
      candidate.path === url.pathname || candidate.legacyPath === url.pathname,
  );

  if (!asset) return null;

  return {
    asset,
    isLegacy: url.pathname === asset.legacyPath,
    requestedVersion: url.searchParams.get("v"),
  };
}

export function isSocialRenderVersion(value: string | null): value is string {
  return Boolean(value && digestPattern.test(value));
}
