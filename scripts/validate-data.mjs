import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const schedulePath = path.resolve("site/data/schedule.json");
const scheduleSchemaPath = path.resolve("site/data/schedule.schema.json");
const timeRangePattern =
  /^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/;

const errors = [];

const [schedule, scheduleSchema] = await Promise.all([
  readJson(schedulePath),
  readJson(scheduleSchemaPath),
]);

validateScheduleSchema(scheduleSchema);
validateSchedule(schedule);

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
}

function validateSchedule(schedule) {
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

  schedule.items.forEach((item, index) => {
    const itemPath = `site/data/schedule.json items[${index}]`;

    if (!isObject(item)) {
      errors.push(`${itemPath} must be an object.`);
      return;
    }

    const allowedItemKeys = new Set(["time", "title", "body"]);

    for (const key of Object.keys(item)) {
      if (!allowedItemKeys.has(key)) {
        errors.push(`${itemPath} has unknown field "${key}".`);
      }
    }

    for (const field of allowedItemKeys) {
      if (!isNonEmptyString(item[field])) {
        errors.push(`${itemPath}.${field} must be a non-empty string.`);
      }
    }

    if (!isNonEmptyString(item.time)) return;

    if (!timeRangePattern.test(item.time)) {
      errors.push(`${itemPath}.time must use HH:MM-HH:MM in 24-hour time.`);
      return;
    }

    const [start, end] = item.time.split("-").map(timeToMinutes);

    if (end <= start) {
      errors.push(`${itemPath}.time must end after it starts.`);
    }

    if (start < previousEnd) {
      errors.push(`${itemPath}.time overlaps the previous schedule item.`);
    }

    previousEnd = end;
  });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);

  return hours * 60 + minutes;
}
