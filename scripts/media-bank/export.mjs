import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { Zip, ZipPassThrough } from "fflate";
import {
  applyCuration,
  attribution,
  defaultOutput,
  photoCollections,
  readJson,
  readCuration,
} from "./catalog.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const output = path.resolve(option("--output", defaultOutput));
const collectionId = option("--collection", "highlights");
const variant = option("--size", "share");
if (!["share", "original"].includes(variant))
  throw new Error("Choose --size share or --size original.");
const catalog = applyCuration(
  await readJson(path.join(output, "inventory.json")),
  await readCuration(),
);
const collection = photoCollections(catalog).find(
  (item) => item.id === collectionId,
);
if (!collection)
  throw new Error(`Unknown or empty collection: ${collectionId}`);
const photos = catalog.photos.filter((photo) =>
  collection.photoIds.includes(photo.id),
);
const { input } = await readJson(path.join(output, "source.json"));
const directory = path.join(output, "collections");
await mkdir(directory, { recursive: true });
const filename = path.join(directory, `${collectionId}-${variant}.zip`);
const sink = createWriteStream(filename);
const complete = once(sink, "finish");
let blocked = Promise.resolve();
const zip = new Zip((error, bytes, final) => {
  if (error) {
    sink.destroy(error);
    return;
  }
  if (!sink.write(bytes)) blocked = once(sink, "drain");
  if (final) sink.end();
});
try {
  for (const photo of photos) {
    const entry = new ZipPassThrough(
      `${path.parse(photo.filename).name}${variant === "share" ? "-share" : ""}.jpg`,
    );
    zip.add(entry);
    const source =
      variant === "original"
        ? path.join(input, photo.filename)
        : path.join(output, photo.images.share.path);
    for await (const bytes of createReadStream(source)) {
      entry.push(bytes, false);
      await blocked;
    }
    entry.push(new Uint8Array(), true);
    await blocked;
  }
  const credits = `SDLCAI 2026 — ${collection.title}\n${catalog.license}: ${catalog.licenseUrl}\nCredit the photographer and link to the license. Indicate any further edits.\n\n${photos.map((photo) => attribution(photo, catalog, variant)).join("\n\n")}\n`;
  for (const [name, text] of [
    ["CREDITS.txt", credits],
    [
      "catalog.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          eventId: catalog.eventId,
          license: catalog.license,
          licenseUrl: catalog.licenseUrl,
          collection,
          photos,
        },
        null,
        2,
      ),
    ],
  ]) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(new TextEncoder().encode(text), true);
  }
  zip.end();
  await complete;
  await writeFile(path.join(directory, `${collectionId}-credits.txt`), credits);
  console.log(`Exported ${photos.length} photos: ${filename}`);
} catch (error) {
  zip.terminate();
  sink.destroy();
  throw error;
}
