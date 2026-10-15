import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCuration,
  contactSheets,
  correctedTimestamp,
  defaultOutput,
  exportCatalog,
  findSimilarGroups,
  localTimestamp,
  readCuration,
  readJson,
  repoRoot,
} from "./catalog.mjs";

// Recalculate catalog metadata from preserved EXIF fields. JPEGs are untouched.
const args = process.argv.slice(2);
const index = args.indexOf("--output");
const output = index < 0 ? defaultOutput : path.resolve(args[index + 1]);
const settings = await readJson(
  path.join(repoRoot, "production/media-bank/sources.json"),
);
const inventory = await readJson(path.join(output, "inventory.json"));
Object.assign(inventory, settings);
for (const photo of inventory.photos) {
  const source = settings.sources.find((item) => item.id === photo.sourceId);
  if (!source) throw new Error(`Unknown source: ${photo.sourceId}`);
  photo.clockShiftSeconds = source.clockShiftSeconds;
  photo.capturedAt = correctedTimestamp(photo.rawCaptureTime, source);
  photo.capturedLocal = localTimestamp(photo.capturedAt);
  photo.calibrationStatus =
    source.calibrationStatus ??
    (source.clockShiftSeconds ? "user-confirmed" : "exif-timezone");
}
inventory.photos.sort(
  (a, b) =>
    a.capturedAt.localeCompare(b.capturedAt) ||
    a.filename.localeCompare(b.filename),
);
inventory.similarGroups = findSimilarGroups(inventory.photos);
await writeFile(
  path.join(output, "inventory.json"),
  JSON.stringify(inventory, null, 2) + "\n",
);
const catalog = applyCuration(inventory, await readCuration());
await exportCatalog(catalog, output);
await contactSheets(catalog, output, "magick");
console.log(
  `Refreshed programme context and clock calibration for ${catalog.photos.length} photos without changing image files.`,
);
