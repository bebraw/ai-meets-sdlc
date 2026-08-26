export const socialRenderContract = "browser-run-v1";
export const socialRenderManifestPath = "assets/social/manifest.json";

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
