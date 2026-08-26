export interface SocialRenderAsset {
  height: number;
  id: string;
  legacyPath: string;
  maxBytes: number;
  path: string;
  presetId: string;
  quality: number;
  slideId: string;
  slideNumber: number;
  version: string;
  width: number;
}

export interface SocialRenderManifest {
  assets: SocialRenderAsset[];
  deckPath: string;
  renderer: string;
  schemaVersion: number;
  version: string;
}

export interface SocialRenderMatch {
  asset: SocialRenderAsset;
  isLegacy: boolean;
  requestedVersion: string | null;
}

const digestPattern = /^[a-f0-9]{64}$/u;
const slideIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
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

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSocialRenderAsset(value: unknown): value is SocialRenderAsset {
  if (!value || typeof value !== "object") return false;

  const asset = value as Record<string, unknown>;
  const preset =
    typeof asset.presetId === "string" && asset.presetId in presetContracts
      ? presetContracts[asset.presetId as keyof typeof presetContracts]
      : undefined;
  const dimensions = preset ? `${preset.width}x${preset.height}` : "";
  const expectedPath = preset
    ? `/assets/social/${asset.presetId}/sdlcai-2026-${asset.slideId}-${asset.presetId}-${dimensions}.jpg`
    : "";
  const expectedLegacyPath = preset
    ? `/assets/social/${asset.presetId}/sdlcai-2026-slide-${String(asset.slideNumber).padStart(2, "0")}-${asset.presetId}-${dimensions}.jpg`
    : "";

  return (
    Boolean(preset) &&
    asset.id === `${asset.slideId}:${asset.presetId}` &&
    typeof asset.slideId === "string" &&
    slideIdPattern.test(asset.slideId) &&
    asset.path === expectedPath &&
    asset.legacyPath === expectedLegacyPath &&
    typeof asset.version === "string" &&
    digestPattern.test(asset.version) &&
    isPositiveInteger(asset.slideNumber) &&
    asset.width === preset?.width &&
    asset.height === preset?.height &&
    asset.maxBytes === preset?.maxBytes &&
    asset.quality === preset?.quality
  );
}

export function parseSocialRenderManifest(
  value: unknown,
): SocialRenderManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Social render manifest is not an object.");
  }

  const manifest = value as Record<string, unknown>;

  if (
    manifest.schemaVersion !== 1 ||
    manifest.renderer !== "browser-run-v1" ||
    manifest.deckPath !== "/slides/deck/" ||
    typeof manifest.version !== "string" ||
    !digestPattern.test(manifest.version) ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.every(isSocialRenderAsset)
  ) {
    throw new Error("Social render manifest has an invalid contract.");
  }

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

  return manifest as unknown as SocialRenderManifest;
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
