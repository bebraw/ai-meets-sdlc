export const videoExportManifestPath = "/assets/social/video/manifest.json";
export const videoRenderCss =
  "[data-slide-progress] { display: none !important; } .presentation-slide { animation: none !important; }";

export interface VideoExportAsset {
  slideId: string;
  path: string;
  version: string;
  filename: string;
}

export interface VideoExportManifest {
  filename: string;
  assets: VideoExportAsset[];
}

export function parseVideoExportManifest(value: unknown): VideoExportManifest {
  if (!value || typeof value !== "object")
    throw new Error("Invalid slide export manifest.");
  const manifest = value as Partial<VideoExportManifest>;
  if (
    typeof manifest.filename !== "string" ||
    !/^sdlcai-2026-session-slides-4k-[a-f0-9]{12}\.zip$/u.test(
      manifest.filename,
    ) ||
    !Array.isArray(manifest.assets) ||
    !manifest.assets.length ||
    manifest.assets.length > 100
  )
    throw new Error("Invalid slide export manifest.");
  const ids = new Set<string>();
  for (const [index, asset] of manifest.assets.entries()) {
    if (
      !asset ||
      typeof asset.slideId !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(asset.slideId) ||
      typeof asset.version !== "string" ||
      !/^[a-f0-9]{64}$/u.test(asset.version) ||
      asset.path !==
        `/assets/social/video/sdlcai-2026-${asset.slideId}-video-3840x2160.png` ||
      asset.filename !==
        `${String(index + 1).padStart(2, "0")}-${asset.slideId}.png` ||
      ids.has(asset.slideId)
    )
      throw new Error("Invalid slide export manifest.");
    ids.add(asset.slideId);
  }
  return { filename: manifest.filename, assets: manifest.assets };
}

export function is4kPng(bytes: Uint8Array): boolean {
  const signature = [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  ];
  if (
    bytes.length < 24 ||
    signature.some((byte, index) => bytes[index] !== byte)
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(16) === 3840 && view.getUint32(20) === 2160;
}
