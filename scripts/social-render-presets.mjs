export const socialRenderContract = "browser-run-v3";
export const socialRenderManifestPath = "assets/social/manifest.json";
export const speakerPromotionManifestPath = "assets/social/speakers.json";

export const videoRenderPreset = {
  id: "video",
  label: "4K PNG",
  width: 3840,
  height: 2160,
  viewportWidth: 1920,
  viewportHeight: 1080,
  deviceScaleFactor: 2,
  format: "png",
  omitSlideCounter: true,
  contract: "video-png-v1",
  maxBytes: 40 * 1024 * 1024,
};

export const socialRenderPresets = [
  {
    id: "linkedin",
    label: "LinkedIn",
    width: 1200,
    height: 627,
    quality: 92,
    maxBytes: 5 * 1024 * 1024,
    note: "1.91:1 landscape",
  },
  {
    id: "x",
    label: "X",
    width: 1600,
    height: 900,
    quality: 92,
    maxBytes: 5 * 1024 * 1024,
    note: "16:9 landscape",
  },
  {
    id: "bluesky",
    label: "Bluesky",
    width: 1600,
    height: 900,
    quality: 86,
    maxBytes: 1_000_000,
    note: "16:9 / under 1 MB",
  },
];

export const slideRenderPresets = [...socialRenderPresets, videoRenderPreset];
