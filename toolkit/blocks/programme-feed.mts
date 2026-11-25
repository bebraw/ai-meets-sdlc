import * as v from "valibot";
import { strictJsonObject } from "../json-object.mjs";
import { validateProgramme } from "./programme-validation.mjs";

// The published schema permits additive extensions. Intake accepts only its
// named public fields so a private roster column cannot enter the export.
const nonempty = v.pipe(v.string(), v.minCodePoints(1));
const publicUrl = v.pipe(nonempty, v.url(), v.regex(/^https:\/\//));
function calendarDate(value: string) {
  const midnight = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(midnight.valueOf()) &&
    midnight.toISOString().slice(0, 10) === value
  );
}
// The public feed accepts RFC 3339, including explicit UTC offsets, arbitrary
// fractional seconds, and the leap second at the end of a UTC day.
function feedTimestamp(value: string) {
  const parts =
    /^(\d{4}-\d{2}-\d{2})[t\s]([01]\d|2[0-3]):([0-5]\d):([0-5]\d|60)(?:\.\d+)?(?:z|([+-])([01]\d|2[0-3])(?::?([0-5]\d))?)$/iu.exec(
      value,
    );
  if (!parts || !calendarDate(parts[1]!)) return false;
  if (parts[4] !== "60") return true;
  const minutes = Number(parts[2]) * 60 + Number(parts[3]);
  const offset =
    (parts[5] === "-" ? -1 : 1) *
    (Number(parts[6] ?? 0) * 60 + Number(parts[7] ?? 0));
  return (minutes - offset + 1440) % 1440 === 1439;
}
export const timestamp = v.pipe(
  v.string(),
  v.check(feedTimestamp, "Expected a date and time with a valid UTC offset."),
  v.metadata({ format: "date-time" }),
);
const date = v.union([
  v.pipe(
    v.string(),
    v.isoDate(),
    v.check(calendarDate, "Expected a valid calendar date."),
  ),
  timestamp,
]);
const dated = { startDate: v.optional(date), endDate: v.optional(date) };
const references = v.pipe(
  v.array(nonempty),
  v.check(
    (ids) => new Set(ids).size === ids.length,
    "Expected unique references.",
  ),
  v.metadata({ uniqueItems: true }),
);
const sessionFields = strictJsonObject({
  id: nonempty,
  title: nonempty,
  summary: v.nullable(v.string()),
  contentStatus: v.picklist(["announced", "details-pending", "cancelled"]),
  url: publicUrl,
  speakerIds: references,
  topicIds: references,
  ...dated,
});
export const feedInput = strictJsonObject({
  updatedAt: timestamp,
  event: strictJsonObject({
    id: nonempty,
    name: nonempty,
    summary: nonempty,
    url: publicUrl,
    startDate: date,
    endDate: v.optional(date),
    timeZone: nonempty,
    venue: strictJsonObject({
      name: nonempty,
      city: nonempty,
      country: nonempty,
    }),
  }),
  topics: v.array(
    strictJsonObject({ id: nonempty, label: nonempty, summary: nonempty }),
  ),
  speakers: v.array(
    strictJsonObject({
      id: nonempty,
      name: nonempty,
      url: v.optional(publicUrl),
      summary: v.optional(nonempty),
    }),
  ),
  sessions: v.array(sessionFields),
  actions: v.array(
    strictJsonObject({
      id: nonempty,
      label: nonempty,
      url: publicUrl,
      kind: v.picklist(["registration", "information"]),
    }),
  ),
});
export type ProgrammeInput = v.InferOutput<typeof feedInput>;
export const feedExample = {
  updatedAt: "2026-06-10T09:00:00Z",
  event: {
    id: "field-notes",
    name: "Field Notes Forum",
    summary: "An exchange of field research.",
    url: "https://example.org/forum",
    startDate: "2026-06-20",
    timeZone: "Europe/Helsinki",
    venue: { name: "Assembly Hall", city: "Espoo", country: "FI" },
  },
  speakers: [{ id: "zoe", name: "Zoë Marin" }],
  topics: [
    { id: "fieldwork", label: "Fieldwork", summary: "Methods and practice" },
  ],
  sessions: [
    {
      id: "research",
      title: "Field research in practice",
      summary: null,
      contentStatus: "announced",
      url: "https://example.org/forum/research",
      speakerIds: ["zoe"],
      topicIds: ["fieldwork"],
    },
  ],
  actions: [],
} satisfies ProgrammeInput;
export async function buildProgrammeFeed(input: ProgrammeInput) {
  validateProgramme(input);
  const dataset = { schemaVersion: 1, ...input };
  const bytes = new TextEncoder().encode(JSON.stringify(dataset));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const revision = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...dataset, revision };
}
