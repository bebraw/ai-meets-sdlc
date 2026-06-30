import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const announcementsDirectory = path.resolve("site/announcements");
const schedulePath = path.resolve("site/data/schedule.json");
const scheduleSchemaPath = path.resolve("site/data/schedule.schema.json");
const seminarPath = path.resolve("site/data/seminar.json");
const seminarSchemaPath = path.resolve("site/data/seminar.schema.json");
const speakersPath = path.resolve("site/data/speakers.json");
const speakersSchemaPath = path.resolve("site/data/speakers.schema.json");
const timeRangePattern =
  /^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const speakerIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];

const [
  schedule,
  scheduleSchema,
  seminar,
  seminarSchema,
  speakers,
  speakersSchema,
] = await Promise.all([
  readJson(schedulePath),
  readJson(scheduleSchemaPath),
  readJson(seminarPath),
  readJson(seminarSchemaPath),
  readJson(speakersPath),
  readJson(speakersSchemaPath),
]);

await validateAnnouncements(announcementsDirectory);
validateScheduleSchema(scheduleSchema);
validateSeminarSchema(seminarSchema);
validateSeminar(seminar);
validateSpeakersSchema(speakersSchema);
const speakerIds = await validateSpeakers(speakers);
validateSchedule(schedule, speakerIds);

if (errors.length) {
  console.error("Data validation failed:");

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log("Data validation passed.");

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(process.cwd(), filePath)} is not valid JSON.`);

    if (error instanceof Error) {
      errors.push(error.message);
    }

    return null;
  }
}

function validateScheduleSchema(schema) {
  if (!isObject(schema)) return;

  if (schema.title !== "SDLCAI schedule") {
    errors.push("site/data/schedule.schema.json has an unexpected title.");
  }

  const itemProperties = schema.properties?.items?.items?.properties;
  const required = schema.properties?.items?.items?.required;

  for (const field of ["time", "title", "body"]) {
    if (!itemProperties?.[field]) {
      errors.push(`site/data/schedule.schema.json is missing ${field}.`);
    }

    if (!required?.includes(field)) {
      errors.push(`site/data/schedule.schema.json must require ${field}.`);
    }
  }

  if (!itemProperties?.talks) {
    errors.push("site/data/schedule.schema.json is missing talks.");
  }
}

function validateSeminarSchema(schema) {
  if (!isObject(schema)) return;

  if (schema.title !== "SDLCAI seminar") {
    errors.push("site/data/seminar.schema.json has an unexpected title.");
  }

  for (const field of ["name", "date", "venue", "location"]) {
    if (!schema.properties?.[field]) {
      errors.push(`site/data/seminar.schema.json is missing ${field}.`);
    }

    if (!schema.required?.includes(field)) {
      errors.push(`site/data/seminar.schema.json must require ${field}.`);
    }
  }
}

function validateSpeakersSchema(schema) {
  if (!isObject(schema)) return;

  if (schema.title !== "SDLCAI speakers") {
    errors.push("site/data/speakers.schema.json has an unexpected title.");
  }

  const itemProperties = schema.properties?.items?.items?.properties;
  const required = schema.properties?.items?.items?.required;

  for (const field of ["id", "name", "role", "bio"]) {
    if (!itemProperties?.[field]) {
      errors.push(`site/data/speakers.schema.json is missing ${field}.`);
    }

    if (!required?.includes(field)) {
      errors.push(`site/data/speakers.schema.json must require ${field}.`);
    }
  }
}

function validateSeminar(seminar) {
  if (!isObject(seminar)) {
    errors.push("site/data/seminar.json must be an object.");
    return;
  }

  const allowedRootKeys = new Set([
    "$schema",
    "name",
    "date",
    "venue",
    "location",
  ]);

  for (const key of Object.keys(seminar)) {
    if (!allowedRootKeys.has(key)) {
      errors.push(`site/data/seminar.json has unknown root field "${key}".`);
    }
  }

  if (!isNonEmptyString(seminar.name)) {
    errors.push("site/data/seminar.json name must be a non-empty string.");
  }

  if (!isObject(seminar.date)) {
    errors.push("site/data/seminar.json date must be an object.");
  }

  validateOptionalObject({
    value: seminar.date,
    path: "site/data/seminar.json date",
    allowedFields: ["iso", "display"],
    requiredFields: ["iso", "display"],
  });

  if (isNonEmptyString(seminar.date?.iso)) {
    if (!isoDatePattern.test(seminar.date.iso)) {
      errors.push("site/data/seminar.json date.iso must use YYYY-MM-DD.");
    } else if (Number.isNaN(Date.parse(`${seminar.date.iso}T00:00:00Z`))) {
      errors.push("site/data/seminar.json date.iso must be a valid date.");
    }
  }

  if (!isObject(seminar.venue)) {
    errors.push("site/data/seminar.json venue must be an object.");
  }

  validateOptionalObject({
    value: seminar.venue,
    path: "site/data/seminar.json venue",
    allowedFields: ["name", "shortName"],
    requiredFields: ["name", "shortName"],
  });

  if (!isObject(seminar.location)) {
    errors.push("site/data/seminar.json location must be an object.");
  }

  validateOptionalObject({
    value: seminar.location,
    path: "site/data/seminar.json location",
    allowedFields: ["city", "country", "display"],
    requiredFields: ["city", "country", "display"],
  });
}

function validateSchedule(schedule, speakerIds) {
  if (!isObject(schedule)) {
    errors.push("site/data/schedule.json must be an object.");
    return;
  }

  const allowedRootKeys = new Set(["$schema", "items"]);

  for (const key of Object.keys(schedule)) {
    if (!allowedRootKeys.has(key)) {
      errors.push(`site/data/schedule.json has unknown root field "${key}".`);
    }
  }

  if (!Array.isArray(schedule.items)) {
    errors.push("site/data/schedule.json items must be an array.");
    return;
  }

  if (schedule.items.length === 0) {
    errors.push("site/data/schedule.json items must not be empty.");
  }

  let previousEnd = -1;

  for (const [index, item] of schedule.items.entries()) {
    const itemPath = `site/data/schedule.json items[${index}]`;

    if (!isObject(item)) {
      errors.push(`${itemPath} must be an object.`);
      continue;
    }

    const allowedItemKeys = new Set(["time", "title", "body", "talks"]);

    for (const key of Object.keys(item)) {
      if (!allowedItemKeys.has(key)) {
        errors.push(`${itemPath} has unknown field "${key}".`);
      }
    }

    for (const field of ["time", "title", "body"]) {
      if (!isNonEmptyString(item[field])) {
        errors.push(`${itemPath}.${field} must be a non-empty string.`);
      }
    }

    let start = null;
    let end = null;

    if (isNonEmptyString(item.time) && timeRangePattern.test(item.time)) {
      [start, end] = item.time.split("-").map(timeToMinutes);

      if (end <= start) {
        errors.push(`${itemPath}.time must end after it starts.`);
      }

      if (start < previousEnd) {
        errors.push(`${itemPath}.time overlaps the previous schedule item.`);
      }

      previousEnd = end;
    } else if (isNonEmptyString(item.time)) {
      errors.push(`${itemPath}.time must use HH:MM-HH:MM in 24-hour time.`);
    }

    validateTalks(item.talks, `${itemPath}.talks`, speakerIds);
  }
}

async function validateAnnouncements(directory) {
  let fileNames = [];

  try {
    fileNames = (await readdir(directory)).filter((fileName) =>
      fileName.endsWith(".md"),
    );
  } catch {
    errors.push("site/announcements must be a readable directory.");
    return;
  }

  if (fileNames.length === 0) {
    errors.push("site/announcements must contain at least one Markdown post.");
  }

  const slugs = new Set();

  for (const fileName of fileNames) {
    const postPath = `site/announcements/${fileName}`;
    const slug = path.basename(fileName, ".md");

    if (!slugPattern.test(slug)) {
      errors.push(`${postPath} filename must be a lowercase slug.`);
      continue;
    }

    if (slugs.has(slug)) {
      errors.push(`${postPath} duplicates another announcement slug.`);
      continue;
    }

    slugs.add(slug);

    const source = await readFile(path.join(directory, fileName), "utf8");
    const parsed = parseMarkdownPost(source, postPath);

    if (!parsed) continue;

    const { frontMatter, markdown } = parsed;
    const allowedFields = new Set([
      "title",
      "subtitle",
      "summary",
      "date",
      "updated",
      "author",
      "eyebrow",
    ]);

    for (const key of Object.keys(frontMatter)) {
      if (!allowedFields.has(key)) {
        errors.push(`${postPath} front matter has unknown field "${key}".`);
      }
    }

    for (const field of ["title", "summary", "date", "eyebrow"]) {
      if (!isNonEmptyString(frontMatter[field])) {
        errors.push(`${postPath} front matter ${field} is required.`);
      }
    }

    if (
      typeof frontMatter.subtitle !== "undefined" &&
      !isNonEmptyString(frontMatter.subtitle)
    ) {
      errors.push(`${postPath} front matter subtitle must not be empty.`);
    }

    if (
      typeof frontMatter.author !== "undefined" &&
      !isNonEmptyString(frontMatter.author)
    ) {
      errors.push(`${postPath} front matter author must not be empty.`);
    }

    validateAnnouncementDate(frontMatter.date, `${postPath} front matter date`);

    if (typeof frontMatter.updated !== "undefined") {
      validateAnnouncementDate(
        frontMatter.updated,
        `${postPath} front matter updated`,
      );
    }

    if (!isNonEmptyString(markdown)) {
      errors.push(`${postPath} body must not be empty.`);
    }
  }
}

function validateAnnouncementDate(date, datePath) {
  if (isNonEmptyString(date)) {
    if (!isoDatePattern.test(date)) {
      errors.push(`${datePath} must use YYYY-MM-DD.`);
    } else if (Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      errors.push(`${datePath} must be a valid date.`);
    }
  }
}

function parseMarkdownPost(source, postPath) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    errors.push(`${postPath} is missing front matter.`);
    return undefined;
  }

  return {
    frontMatter: parseFrontMatter(match[1], postPath),
    markdown: match[2].trim(),
  };
}

function parseFrontMatter(source, postPath) {
  const frontMatter = {};

  for (const line of source.split("\n")) {
    if (!line.trim()) continue;

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      errors.push(`${postPath} has invalid front matter line: ${line}`);
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    frontMatter[key] = value;
  }

  return frontMatter;
}

async function validateSpeakers(speakers) {
  const speakerIds = new Set();

  if (!isObject(speakers)) {
    errors.push("site/data/speakers.json must be an object.");
    return speakerIds;
  }

  const allowedRootKeys = new Set(["$schema", "items"]);

  for (const key of Object.keys(speakers)) {
    if (!allowedRootKeys.has(key)) {
      errors.push(`site/data/speakers.json has unknown root field "${key}".`);
    }
  }

  if (!Array.isArray(speakers.items)) {
    errors.push("site/data/speakers.json items must be an array.");
    return speakerIds;
  }

  if (speakers.items.length === 0) {
    errors.push("site/data/speakers.json items must not be empty.");
  }

  for (const [index, speaker] of speakers.items.entries()) {
    const speakerPath = `site/data/speakers.json items[${index}]`;

    if (!isObject(speaker)) {
      errors.push(`${speakerPath} must be an object.`);
      continue;
    }

    validateOptionalObject({
      value: speaker,
      path: speakerPath,
      allowedFields: [
        "id",
        "name",
        "role",
        "photo",
        "website",
        "linkedin",
        "scholar",
        "github",
        "x",
        "bio",
      ],
      requiredFields: ["id", "name", "role", "bio"],
    });

    if (isNonEmptyString(speaker.id)) {
      if (!speakerIdPattern.test(speaker.id)) {
        errors.push(`${speakerPath}.id must be a lowercase slug.`);
      } else if (speakerIds.has(speaker.id)) {
        errors.push(`${speakerPath}.id duplicates another speaker.`);
      } else {
        speakerIds.add(speaker.id);
      }
    }

    await validateSpeakerLinks(speaker, speakerPath);
  }

  return speakerIds;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionalObject({
  value,
  path: objectPath,
  allowedFields,
  requiredFields,
}) {
  if (typeof value === "undefined") return;

  if (!isObject(value)) {
    errors.push(`${objectPath} must be an object.`);
    return;
  }

  const allowedFieldSet = new Set(allowedFields);

  for (const key of Object.keys(value)) {
    if (!allowedFieldSet.has(key)) {
      errors.push(`${objectPath} has unknown field "${key}".`);
    }
  }

  for (const field of requiredFields) {
    if (!isNonEmptyString(value[field])) {
      errors.push(`${objectPath}.${field} must be a non-empty string.`);
    }
  }

  for (const [field, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue !== "undefined" && !isNonEmptyString(fieldValue)) {
      errors.push(`${objectPath}.${field} must be a non-empty string.`);
    }
  }
}

async function validateSpeakerLinks(speaker, speakerPath) {
  if (!isObject(speaker)) return;

  for (const field of ["website", "linkedin", "scholar", "github", "x"]) {
    if (typeof speaker[field] === "undefined") continue;

    try {
      new URL(speaker[field]);
    } catch {
      errors.push(`${speakerPath}.${field} must be a valid URL.`);
    }
  }

  if (typeof speaker.photo === "undefined") return;

  if (!/^\/assets\/.+\.(webp|png|jpg|jpeg)$/.test(speaker.photo)) {
    errors.push(
      `${speakerPath}.photo must point to a web image under /assets/.`,
    );
    return;
  }

  try {
    const photoPath = path.resolve(speaker.photo.slice(1));

    await access(photoPath);
    await validateSquareImage(photoPath, `${speakerPath}.photo`);
  } catch {
    errors.push(`${speakerPath}.photo points to a missing file.`);
  }
}

async function validateSquareImage(filePath, imagePath) {
  const image = await readFile(filePath);
  const dimensions = getImageDimensions(image);

  if (!dimensions) {
    errors.push(`${imagePath} must point to a readable web image.`);
    return;
  }

  if (dimensions.width !== dimensions.height) {
    errors.push(
      `${imagePath} must be square, got ${dimensions.width}x${dimensions.height}.`,
    );
  }
}

function getImageDimensions(image) {
  return (
    getPngDimensions(image) ??
    getJpegDimensions(image) ??
    getWebpDimensions(image)
  );
}

function getPngDimensions(image) {
  if (
    image.length < 24 ||
    image[0] !== 0x89 ||
    image.toString("ascii", 1, 4) !== "PNG"
  ) {
    return undefined;
  }

  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20),
  };
}

function getJpegDimensions(image) {
  if (image.length < 4 || image[0] !== 0xff || image[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  while (offset + 9 < image.length) {
    if (image[offset] !== 0xff) return undefined;

    const marker = image[offset + 1];
    const segmentLength = image.readUInt16BE(offset + 2);

    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        width: image.readUInt16BE(offset + 7),
        height: image.readUInt16BE(offset + 5),
      };
    }

    offset += 2 + segmentLength;
  }

  return undefined;
}

function getWebpDimensions(image) {
  if (
    image.length < 30 ||
    image.toString("ascii", 0, 4) !== "RIFF" ||
    image.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return undefined;
  }

  const chunkType = image.toString("ascii", 12, 16);

  if (chunkType === "VP8 ") {
    return {
      width: image.readUInt16LE(26) & 0x3fff,
      height: image.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L") {
    const byte1 = image[21];
    const byte2 = image[22];
    const byte3 = image[23];
    const byte4 = image[24];

    return {
      width: 1 + byte1 + ((byte2 & 0x3f) << 8),
      height: 1 + ((byte2 & 0xc0) >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10),
    };
  }

  if (chunkType === "VP8X") {
    return {
      width: 1 + image.readUIntLE(24, 3),
      height: 1 + image.readUIntLE(27, 3),
    };
  }

  return undefined;
}

function validateTalks(talks, talksPath, speakerIds) {
  if (typeof talks === "undefined") return;

  if (!Array.isArray(talks)) {
    errors.push(`${talksPath} must be an array.`);
    return;
  }

  if (talks.length === 0) {
    errors.push(`${talksPath} must not be empty.`);
  }

  for (const [index, talk] of talks.entries()) {
    const talkPath = `${talksPath}[${index}]`;

    if (!isObject(talk)) {
      errors.push(`${talkPath} must be an object.`);
      continue;
    }

    const allowedTalkKeys = new Set(["title", "abstract", "speakers"]);

    for (const key of Object.keys(talk)) {
      if (!allowedTalkKeys.has(key)) {
        errors.push(`${talkPath} has unknown field "${key}".`);
      }
    }

    for (const field of ["title", "abstract"]) {
      if (!isNonEmptyString(talk[field])) {
        errors.push(`${talkPath}.${field} must be a non-empty string.`);
      }
    }

    if (!Array.isArray(talk.speakers)) {
      errors.push(`${talkPath}.speakers must be an array.`);
    } else if (talk.speakers.length === 0) {
      errors.push(`${talkPath}.speakers must not be empty.`);
    } else {
      const seenSpeakerIds = new Set();

      for (const [speakerIndex, speakerId] of talk.speakers.entries()) {
        const speakerPath = `${talkPath}.speakers[${speakerIndex}]`;

        validateTalkSpeaker(speakerId, speakerPath, speakerIds);

        if (seenSpeakerIds.has(speakerId)) {
          errors.push(`${speakerPath} duplicates another talk speaker.`);
        }

        seenSpeakerIds.add(speakerId);
      }
    }
  }
}

function validateTalkSpeaker(speakerId, speakerPath, speakerIds) {
  if (!isNonEmptyString(speakerId)) {
    errors.push(`${speakerPath} must be a non-empty string.`);
    return;
  }

  if (!speakerIdPattern.test(speakerId)) {
    errors.push(`${speakerPath} must be a lowercase slug.`);
  }

  if (!speakerIds.has(speakerId)) {
    errors.push(`${speakerPath} must reference a speaker id.`);
  }
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}
