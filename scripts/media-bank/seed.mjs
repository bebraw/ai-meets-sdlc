import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultOutput, readJson, repoRoot } from "./catalog.mjs";

// Publish only immutable import fields. Hosted review edits live in D1;
// local notes, absolute paths, and mutable review files never enter this seed.
const args = process.argv.slice(2);
const index = args.indexOf("--output");
const output = index < 0 ? defaultOutput : path.resolve(args[index + 1]);
const inventory = await readJson(path.join(output, "inventory.json"));
const photos = [];
for (const photo of inventory.photos) {
  const images = {};
  for (const [variant, image] of Object.entries(photo.images)) {
    const bytes = await readFile(path.join(output, image.path));
    images[variant] = {
      width: image.width,
      height: image.height,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  const allowed = [
    "id",
    "filename",
    "sha256",
    "bytes",
    "width",
    "height",
    "sourceId",
    "photographer",
    "model",
    "rawCaptureTime",
    "rawTimezoneOffset",
    "clockShiftSeconds",
    "capturedAt",
    "capturedLocal",
    "calibrationStatus",
  ];
  photos.push({
    ...Object.fromEntries(allowed.map((key) => [key, photo[key]])),
    images,
  });
}
const keys = [
  "schemaVersion",
  "eventId",
  "eventDate",
  "timezone",
  "license",
  "licenseUrl",
  "sources",
  "categories",
  "selections",
  "speakers",
  "talks",
  "similarGroups",
];
const seed = {
  ...Object.fromEntries(keys.map((key) => [key, inventory[key]])),
  photos,
};
await writeFile(
  path.join(repoRoot, "site/data/event-photos.json"),
  JSON.stringify(seed, null, 2) + "\n",
);
console.log(
  `Prepared hosted seed for ${photos.length} photos; D1 review decisions are unchanged.`,
);
