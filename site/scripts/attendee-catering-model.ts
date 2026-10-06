import * as v from "valibot";
import { classifyDiet } from "./attendee-diets.ts";
import type { AttendeeRecord } from "./attendee-model.ts";

export interface CateringSource {
  id: string;
  name: string;
  email?: string;
  kind: "speaker" | "dinner-guest";
  diet?: string | undefined;
}
export interface CateringMapping {
  sourceId: string;
  target: string;
}
export interface CateringData {
  revision: number;
  version: string;
  mappings: CateringMapping[];
  sources: CateringSource[];
  organizers: { id: string; name: string }[];
}
export function parseCateringMappings(value: unknown): CateringMapping[] {
  const mappings = v.parse(
    v.pipe(
      v.array(
        v.object({
          sourceId: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
          target: v.pipe(
            v.string(),
            v.regex(
              /^(?:separate|exclude|(?:attendee|organizer):[a-zA-Z0-9_-]{1,100})$/u,
            ),
          ),
        }),
      ),
      v.maxLength(2000),
    ),
    value,
  );
  if (new Set(mappings.map((item) => item.sourceId)).size !== mappings.length)
    throw new Error("Each dinner response can only be mapped once.");
  return mappings;
}

interface DinnerDiet {
  meal_preference: "" | "omnivore" | "vegetarian" | "vegan" | "other";
  food_requirements: string;
  cross_contamination: "" | "yes" | "no" | "unsure";
}

/** Dinner attendance is independent of daytime catering. Keep the original food notes. */
export function dinnerDiet(response: DinnerDiet | null): string | undefined {
  if (!response) return undefined;
  const parts: string[] = [];
  if (["vegan", "vegetarian"].includes(response.meal_preference))
    parts.push(response.meal_preference);
  const requirements = response.food_requirements.trim();
  if (requirements && classifyDiet(requirements).response === "requirements")
    parts.push(requirements);
  if (response.cross_contamination === "yes")
    parts.push("Cross-contamination is a concern.");
  if (response.cross_contamination === "unsure")
    parts.push("Cross-contamination: unsure.");
  if (parts.length) return parts.join("; ");
  if (response.meal_preference === "other")
    return requirements || "Other meal preference; details not supplied.";
  if (
    response.meal_preference === "omnivore" &&
    response.cross_contamination === "no"
  )
    return classifyDiet(requirements).response === "none"
      ? requirements
      : "No restrictions";
  return requirements || undefined;
}

const nameKey = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const emailKey = (value: string) => value.trim().toLowerCase();

function combineDiets(values: string[]): string | undefined {
  const unique = [
    ...new Map(
      values
        .filter((value) => value.trim())
        .map((value) => [nameKey(value), value.trim()]),
    ).values(),
  ];
  const requirements = unique.filter(
    (value) => classifyDiet(value).response === "requirements",
  );
  // A general "none" answer must not dilute a restriction supplied elsewhere.
  return requirements.length
    ? requirements.join("; ")
    : unique.find((value) => classifyDiet(value).response === "none");
}

export interface CateringRoster {
  people: { status: "active" | "cancelled"; diet?: string | undefined }[];
  additional: number;
  pending: number;
  rows: { source: CateringSource; target: string | null; label: string }[];
}

export function buildCateringRoster(
  attendees: readonly AttendeeRecord[],
  data: CateringData,
): CateringRoster {
  const active = attendees.filter((person) => person.status === "active");
  const mappings = new Map(
    data.mappings.map((item) => [item.sourceId, item.target]),
  );
  const speakers = data.sources.filter((source) => source.kind === "speaker");
  const targets = new Map<string, { name: string; email?: string }>([
    ...active.map((person) => [`attendee:${person.id}`, person] as const),
    ...speakers.map((source) => [source.id, source] as const),
    ...data.organizers.map(
      (person) => [`organizer:${person.id}`, person] as const,
    ),
  ]);
  const diets = new Map(
    active.map((person) => [
      `attendee:${person.id}`,
      person.diet ? [person.diet] : [],
    ]),
  );
  const matchingAttendees = (person: { name: string; email?: string }) => {
    const emails = person.email
      ? active.filter(
          (item) => emailKey(item.email) === emailKey(person.email!),
        )
      : [];
    return emails.length
      ? emails
      : active.filter((item) => nameKey(item.name) === nameKey(person.name));
  };
  function resolve(target: string): string | null {
    const person = targets.get(target);
    if (!person) return null;
    if (target.startsWith("attendee:")) return target;
    const matches = matchingAttendees(person);
    if (matches.length > 1) return null;
    return matches[0] ? `attendee:${matches[0].id}` : target;
  }
  const rows: CateringRoster["rows"] = [];
  for (const source of data.sources) {
    const mapping = mappings.get(source.id);
    let target: string | null = null;
    if (mapping === "exclude") {
      rows.push({
        source,
        target: null,
        label: "Excluded from daytime catering",
      });
      continue;
    }
    if (mapping === "separate") target = source.id;
    else if (mapping) target = resolve(mapping);
    else if (source.kind === "speaker") target = resolve(source.id);
    else {
      const candidates = matchingAttendees(source).map(
        (person) => `attendee:${person.id}`,
      );
      for (const [id, person] of targets) {
        if (
          id.startsWith("attendee:") ||
          nameKey(person.name) !== nameKey(source.name)
        )
          continue;
        // An excluded speaker must not be brought back by a shared dinner response.
        if (mappings.get(id) === "exclude") continue;
        const linked = mappings.get(id);
        candidates.push(
          linked === "separate"
            ? id
            : linked
              ? (resolve(linked) ?? "")
              : (resolve(id) ?? ""),
        );
      }
      const unique = new Set(candidates);
      if (unique.size === 1 && !unique.has("")) target = [...unique][0]!;
    }
    if (!target) {
      rows.push({
        source,
        target: null,
        label: "Needs mapping · not counted yet",
      });
      continue;
    }
    const responses = diets.get(target) ?? [];
    if (source.diet) responses.push(source.diet);
    diets.set(target, responses);
    const person = targets.get(target);
    rows.push({
      source,
      target,
      label: target.startsWith("attendee:")
        ? `Already counted as attendee: ${person!.name}`
        : target.startsWith("organizer:")
          ? `Organizer: ${person!.name}`
          : source.kind === "speaker" || target.startsWith("speaker:")
            ? "Speaker included"
            : "Additional guest included",
    });
  }
  return {
    people: [
      ...attendees
        .filter((person) => person.status === "cancelled")
        .map((person) => ({ status: "cancelled" as const })),
      ...[...diets.values()].map((values) => ({
        status: "active" as const,
        diet: combineDiets(values),
      })),
    ],
    additional: diets.size - active.length,
    pending: rows.filter(
      (row) => !row.target && mappings.get(row.source.id) !== "exclude",
    ).length,
    rows,
  };
}
