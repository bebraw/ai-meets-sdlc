import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { photoEventContext } from "../../site/scripts/photo-context.ts";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const categories = [
  "talks",
  "panels",
  "audience",
  "posters",
  "networking",
  "venue",
  "group-photo",
  "behind-the-scenes",
  "uncategorized",
];
export const selections = ["unreviewed", "selected", "alternate", "rejected"];
export const variants = { thumbnail: 480, preview: 1800, share: 3200 };
export const defaultOutput = path.join(repoRoot, "output/media-bank");
export const curationPath = path.join(
  repoRoot,
  "production/media-bank/curation.json",
);

export function correctedTimestamp(raw, source) {
  if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(raw))
    throw new Error(`Missing or invalid capture time: ${raw}`);
  const [date, time] = raw.split(" ");
  const timestamp = Date.parse(
    `${date.replaceAll(":", "-")}T${time}${source.timezoneOffset}`,
  );
  if (!Number.isFinite(timestamp))
    throw new Error(`Invalid capture time: ${raw}`);
  return new Date(timestamp + source.clockShiftSeconds * 1000).toISOString();
}

export function localTimestamp(utc) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Helsinki",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(utc))
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function readCuration(filename = curationPath) {
  const initial = await readJson(
    path.join(repoRoot, "production/media-bank/initial-curation.json"),
    { schemaVersion: 1, photos: {} },
  );
  return readJson(filename, initial);
}

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [],
      err = [];
    process.stdout.on("data", (chunk) => out.push(chunk));
    process.stderr.on("data", (chunk) => err.push(chunk));
    process.on("error", reject);
    process.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(
            new Error(
              `${command} exited ${code}: ${Buffer.concat(err).toString().slice(0, 2000)}`,
            ),
          ),
    );
  });
}

async function hashFile(filename) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest("hex");
}

function differenceHash(bytes) {
  let hash = 0n;
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++)
      hash =
        (hash << 1n) | BigInt(bytes[row * 9 + col] > bytes[row * 9 + col + 1]);
  return hash.toString(16).padStart(16, "0");
}

export function hashDistance(first, second) {
  let value = BigInt(`0x${first}`) ^ BigInt(`0x${second}`),
    count = 0;
  while (value) {
    value &= value - 1n;
    count++;
  }
  return count;
}

export function findSimilarGroups(photos) {
  const parent = new Map(photos.map((photo) => [photo.id, photo.id]));
  const root = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  for (let i = 0; i < photos.length; i++) {
    for (let j = i + 1; j < photos.length; j++) {
      const first = photos[i],
        second = photos[j];
      if (Date.parse(second.capturedAt) - Date.parse(first.capturedAt) > 90_000)
        break;
      if (
        first.sourceId === second.sourceId &&
        hashDistance(first.differenceHash, second.differenceHash) <= 5
      )
        parent.set(root(second.id), root(first.id));
    }
  }
  const groups = new Map();
  for (const photo of photos) {
    const group = root(photo.id);
    groups.set(group, [...(groups.get(group) ?? []), photo.id]);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .map((ids) => ({
      id: `similar-${ids[0]}`,
      photoIds: ids,
      kind: "visual-similarity",
      reviewRequired: true,
    }));
}

export function attribution(photo, catalog, variant = "original") {
  return `${photo.filename} — SDLCAI, 13 October 2026, Marsio, Espoo. Photo: ${photo.photographer}. ${catalog.license}: ${catalog.licenseUrl}${variant === "original" ? "" : " Resized and re-encoded for sharing."}`;
}

export function applyCuration(catalog, curation) {
  return {
    ...catalog,
    photos: catalog.photos.map((photo) => {
      const review = curation.photos?.[photo.id] ?? {};
      const reviewed = {
        ...photo,
        category: "uncategorized",
        tags: [],
        caption: "",
        altText: "",
        selection: "unreviewed",
        relatedTalkIds: [],
        depictedSpeakerIds: [],
        associationEvidence: "",
        notes: "",
        ...review,
      };
      return {
        ...reviewed,
        eventContext: photoEventContext(reviewed, catalog.talks ?? []),
      };
    }),
  };
}

export function photoCollections(catalog) {
  const collections = [
    {
      id: "highlights",
      title: "Seminar highlights",
      photoIds: catalog.photos
        .filter((photo) => photo.selection === "selected")
        .map((photo) => photo.id),
    },
    ...catalog.categories
      .filter((category) => category !== "uncategorized")
      .map((category) => ({
        id: category,
        title: category.replaceAll("-", " "),
        photoIds: catalog.photos
          .filter((photo) => photo.category === category)
          .map((photo) => photo.id),
      })),
    ...catalog.talks.map((talk) => ({
      id: `talk-${talk.id}`,
      title: talk.title,
      relatedTalkId: talk.id,
      photoIds: catalog.photos
        .filter((photo) =>
          (photo.eventContext?.relatedTalkIds ?? photo.relatedTalkIds).includes(
            talk.id,
          ),
        )
        .map((photo) => photo.id),
    })),
    ...catalog.speakers.map((speaker) => ({
      id: `person-${speaker.id}`,
      title: speaker.name,
      depictedSpeakerId: speaker.id,
      photoIds: catalog.photos
        .filter((photo) => photo.depictedSpeakerIds.includes(speaker.id))
        .map((photo) => photo.id),
    })),
  ];
  return collections.filter((collection) => collection.photoIds.length);
}

async function mapConcurrent(items, count, callback) {
  let next = 0;
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(count, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await callback(items[index], index);
      }
    }),
  );
  return results;
}

export async function prepare({
  input,
  output = defaultOutput,
  magick = "magick",
}) {
  input = path.resolve(input);
  output = path.resolve(output);
  if (output === input || output.startsWith(`${input}${path.sep}`))
    throw new Error("Choose an output folder outside the source photo folder.");
  const settings = await readJson(
    path.join(repoRoot, "production/media-bank/sources.json"),
  );
  const speakers = (
    await readJson(path.join(repoRoot, "site/data/speakers.json"))
  ).items
    .filter((item) => !item.workspaceOnly)
    .map(({ id, name }) => ({ id, name }));
  const talks = (
    await readJson(path.join(repoRoot, "site/data/schedule.json"))
  ).items.flatMap((session) =>
    (session.talks ?? []).map(({ id, title, speakers }) => ({
      id,
      title,
      speakerIds: speakers,
      sessionId: session.id,
    })),
  );
  const titleSnapshot = await readJson(
    path.join(repoRoot, "production/media-bank/talks.json"),
    { titles: {} },
  );
  for (const talk of talks)
    talk.title = titleSnapshot.titles[talk.id] ?? talk.title;
  await mkdir(output, { recursive: true });
  const previous = await readJson(path.join(output, "inventory.json"), {
    photos: [],
  });
  const byHash = new Map(previous.photos.map((photo) => [photo.sha256, photo]));
  const filenames = (await readdir(input))
    .filter((name) => /\.(jpe?g)$/i.test(name))
    .sort();
  if (!filenames.length) throw new Error("The input folder has no JPEGs.");
  const photos = await mapConcurrent(filenames, 3, async (filename, index) => {
    const file = path.join(input, filename);
    if (!(await stat(file)).isFile())
      throw new Error(`Not a regular file: ${filename}`);
    const sha256 = await hashFile(file);
    const id = `photo-${sha256.slice(0, 20)}`;
    const metadata = (
      await run(magick, [
        "identify",
        "-quiet",
        "-ping",
        "-format",
        "%w\t%h\t%[EXIF:DateTimeOriginal]\t%[EXIF:Model]\t%[EXIF:OffsetTimeOriginal]",
        file,
      ])
    )
      .toString()
      .split("\t");
    const [width, height, rawCaptureTime, model, rawTimezoneOffset] = metadata;
    const source = settings.sources.find((item) => item.model === model);
    if (!source)
      throw new Error(
        `No camera/credit configuration for ${filename}: ${model}`,
      );
    const capturedAt = correctedTimestamp(rawCaptureTime, source);
    const derivativeDir = path.join(output, "images", id);
    await mkdir(derivativeDir, { recursive: true });
    const cached = byHash.get(sha256);
    const photo = {
      id,
      filename,
      sha256,
      bytes: (await stat(file)).size,
      width: Number(width),
      height: Number(height),
      sourceId: source.id,
      photographer: source.photographer,
      model,
      rawCaptureTime,
      rawTimezoneOffset: rawTimezoneOffset || null,
      clockShiftSeconds: source.clockShiftSeconds,
      capturedAt,
      capturedLocal: localTimestamp(capturedAt),
      calibrationStatus:
        source.calibrationStatus ??
        (source.clockShiftSeconds ? "user-confirmed" : "exif-timezone"),
      images: {},
    };
    for (const [variant, size] of Object.entries(variants)) {
      const relative = `images/${id}/${variant}.jpg`;
      const target = path.join(output, relative);
      let exists = false;
      try {
        await stat(target);
        exists = true;
      } catch {}
      if (!exists)
        await run(magick, [
          file,
          "-auto-orient",
          "-resize",
          `${size}x${size}>`,
          "-strip",
          "-colorspace",
          "sRGB",
          "-sampling-factor",
          "4:2:0",
          "-quality",
          variant === "share" ? "88" : "82",
          "-set",
          "comment",
          attribution(photo, settings, variant),
          target,
        ]);
      const dimensions = (
        await run(magick, ["identify", "-ping", "-format", "%w %h", target])
      )
        .toString()
        .split(" ")
        .map(Number);
      photo.images[variant] = {
        path: relative,
        width: dimensions[0],
        height: dimensions[1],
        bytes: (await stat(target)).size,
      };
    }
    photo.differenceHash =
      cached?.differenceHash ??
      differenceHash(
        await run(magick, [
          path.join(derivativeDir, "thumbnail.jpg"),
          "-colorspace",
          "gray",
          "-resize",
          "9x8!",
          "-depth",
          "8",
          "gray:-",
        ]),
      );
    if ((index + 1) % 20 === 0 || index + 1 === filenames.length)
      console.log(`Prepared ${index + 1}/${filenames.length} photos`);
    return photo;
  });
  photos.sort(
    (a, b) =>
      a.capturedAt.localeCompare(b.capturedAt) ||
      a.filename.localeCompare(b.filename),
  );
  const inventory = {
    schemaVersion: 1,
    ...settings,
    categories,
    selections,
    speakers,
    talks,
    photos,
    similarGroups: findSimilarGroups(photos),
  };
  await writeFile(
    path.join(output, "inventory.json"),
    JSON.stringify(inventory, null, 2) + "\n",
  );
  const catalog = applyCuration(inventory, await readCuration());
  await exportCatalog(catalog, output);
  await writeFile(
    path.join(output, "source.json"),
    JSON.stringify({ input, generatedAt: new Date().toISOString() }, null, 2) +
      "\n",
  );
  await contactSheets(catalog, output, magick);
  console.log(
    `Media bank ready: ${photos.length} photos; ${inventory.similarGroups.length} groups to compare.`,
  );
  return catalog;
}

export async function exportCatalog(catalog, output) {
  await writeFile(
    path.join(output, "collections.json"),
    JSON.stringify(photoCollections(catalog), null, 2) + "\n",
  );
  await writeFile(
    path.join(output, "catalog.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );
  const fields = [
    "id",
    "filename",
    "photographer",
    "capturedLocal",
    "rawCaptureTime",
    "clockShiftSeconds",
    "category",
    "selection",
    "caption",
    "altText",
    "tags",
    "relatedTalkIds",
    "depictedSpeakerIds",
    "associationEvidence",
    "notes",
    "programmeSegment",
    "programmeTitle",
    "talkContextIds",
    "talkContextSpeakerIds",
    "contextConfidence",
  ];
  const csv = (value) =>
    `"${String(Array.isArray(value) ? value.join(" | ") : (value ?? "")).replaceAll('"', '""')}"`;
  await writeFile(
    path.join(output, "catalog.csv"),
    [
      fields.map(csv).join(","),
      ...catalog.photos.map((photo) =>
        fields
          .map((field) =>
            csv(
              {
                ...photo,
                programmeSegment: photo.eventContext?.segmentId,
                programmeTitle: photo.eventContext?.title,
                talkContextIds: photo.eventContext?.relatedTalkIds,
                talkContextSpeakerIds: photo.eventContext?.programmeSpeakerIds,
                contextConfidence: photo.eventContext?.association,
              }[field],
            ),
          )
          .join(","),
      ),
    ].join("\r\n") + "\r\n",
  );
  await writeFile(
    path.join(output, "CREDITS.txt"),
    `SDLCAI 2026 photo collection\n13 October 2026, Marsio, Espoo, Finland\nLicense: ${catalog.license}\n${catalog.licenseUrl}\nCredit the named photographer and link to this license. Indicate any crops or edits you make.\n\n${catalog.photos.map((photo) => attribution(photo, catalog)).join("\n\n")}\n`,
  );
  const uploads = catalog.photos.flatMap((photo) => [
    {
      photoId: photo.id,
      source: "original",
      localFilename: photo.filename,
      key: `event-photos/${catalog.eventId}/${photo.id}/original.jpg`,
      contentType: "image/jpeg",
      access: "private",
      sha256: photo.sha256,
    },
    ...Object.entries(photo.images).map(([variant, image]) => ({
      photoId: photo.id,
      source: "derivative",
      path: image.path,
      key: `event-photos/${catalog.eventId}/${photo.id}/${variant}.jpg`,
      contentType: "image/jpeg",
      access: "private",
    })),
  ]);
  await writeFile(
    path.join(output, "upload-plan.json"),
    JSON.stringify({ schemaVersion: 1, uploads }, null, 2) + "\n",
  );
}

export async function contactSheets(catalog, output, magick) {
  await mkdir(path.join(output, "contact-sheets"), { recursive: true });
  for (const source of catalog.sources) {
    const photos = catalog.photos.filter(
      (photo) => photo.sourceId === source.id,
    );
    for (let offset = 0; offset < photos.length; offset += 30) {
      const font =
        process.env.MEDIA_BANK_FONT ??
        (process.platform === "darwin"
          ? "/System/Library/Fonts/Supplemental/Arial.ttf"
          : "DejaVu-Sans");
      const args = [
        "montage",
        "-font",
        font,
        "-pointsize",
        "12",
        "-background",
        "#171717",
        "-fill",
        "#f6f4ef",
      ];
      for (const photo of photos.slice(offset, offset + 30))
        args.push(
          "-label",
          `${photo.filename}\n${photo.capturedLocal.slice(11)} · ${photo.category}`,
          path.join(output, photo.images.thumbnail.path),
        );
      args.push(
        "-thumbnail",
        "250x170",
        "-tile",
        "5x",
        "-geometry",
        "260x205+6+6",
        path.join(
          output,
          "contact-sheets",
          `${source.id}-${String(offset / 30 + 1).padStart(2, "0")}.jpg`,
        ),
      );
      await run(magick, args);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
  };
  const input = option("--input"),
    output = path.resolve(option("--output", defaultOutput));
  if (args.includes("--contact-sheets-only")) {
    const catalog = applyCuration(
      await readJson(path.join(output, "inventory.json")),
      await readCuration(),
    );
    await exportCatalog(catalog, output);
    await contactSheets(catalog, output, option("--magick", "magick"));
  } else {
    if (!input)
      throw new Error(
        "Usage: node scripts/media-bank/catalog.mjs --input /path/to/photos [--output output/media-bank] [--magick magick]",
      );
    await prepare({ input, output, magick: option("--magick", "magick") });
  }
}
