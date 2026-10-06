import * as v from "valibot";
import { classifyDiet, summarizeAttendeeDiets } from "./attendee-diets.ts";
import type { AttendeeRecord } from "./attendee-model.ts";
import type { DietReview } from "./attendee-diet-reviews.ts";
export { dinnerDiet } from "./dinner-diets.ts";

export interface CateringSource {
  id: string;
  name: string;
  email?: string;
  kind: "speaker" | "dinner-guest" | "poster-presenter" | "volunteer";
  registrationId?: string | null;
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
  reservedMeals?: number;
  reviews?: DietReview[];
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
    throw new Error("Each catering source can only be mapped once.");
  return mappings;
}
export const maxReservedMeals = 2000;
const reservedMealsSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(maxReservedMeals),
);
export function parseCateringPreferences(value: unknown): {
  mappings: CateringMapping[];
  reservedMeals: number;
} {
  const saved = v.parse(
    v.object({
      mappings: v.unknown(),
      reservedMeals: v.optional(reservedMealsSchema, 0),
    }),
    value,
  );
  return {
    mappings: parseCateringMappings(saved.mappings),
    reservedMeals: saved.reservedMeals,
  };
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
  people: CateringPerson[];
  additional: number;
  pending: number;
  attendeeDiets: Record<string, string | undefined>;
  rows: { source: CateringSource; target: string | null; label: string }[];
}
export interface CateringPerson {
  id: string;
  name: string;
  status: "active" | "cancelled";
  diet?: string | undefined;
  sourceSignature: string;
  review?: DietReview | undefined;
  staleReview?: DietReview | undefined;
}
export function summarizeCateringPlan(
  roster: CateringRoster,
  reservedMeals = 0,
) {
  const reserve = v.parse(reservedMealsSchema, reservedMeals);
  const summary = summarizeAttendeeDiets(roster.people);
  return {
    ...summary,
    active: summary.active + reserve,
    missing: summary.missing + reserve,
  };
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
  const members = data.sources.filter(
    (source) =>
      source.kind === "poster-presenter" || source.kind === "volunteer",
  );
  const targets = new Map<string, { name: string; email?: string }>([
    ...active.map((person) => [`attendee:${person.id}`, person] as const),
    ...speakers.map((source) => [source.id, source] as const),
    ...members.map((source) => [source.id, source] as const),
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
  const origins = new Map(
    active.map((person) => [
      `attendee:${person.id}`,
      [[`attendee:${person.id}`, person.diet ?? ""]],
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
    const member = members.find((source) => source.id === target);
    if (member)
      return member.registrationId &&
        targets.has(`attendee:${member.registrationId}`)
        ? `attendee:${member.registrationId}`
        : null;
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
    if (source.kind === "poster-presenter" || source.kind === "volunteer")
      target = source.registrationId
        ? resolve(`attendee:${source.registrationId}`)
        : null;
    else if (mapping === "separate") target = source.id;
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
          members.some((source) => source.id === id)
            ? (resolve(id) ?? "")
            : linked === "separate"
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
    const sourceOrigins = origins.get(target) ?? [];
    sourceOrigins.push([source.id, source.diet ?? ""]);
    origins.set(target, sourceOrigins);
    const person = targets.get(target);
    rows.push({
      source,
      target,
      label:
        source.kind === "poster-presenter"
          ? `Attendee included (poster presenter): ${person!.name}`
          : source.kind === "volunteer"
            ? `Organizer included (volunteer): ${person!.name}`
            : target.startsWith("attendee:")
              ? `Already counted as attendee: ${person!.name}`
              : target.startsWith("organizer:")
                ? `Organizer: ${person!.name}`
                : source.kind === "speaker" || target.startsWith("speaker:")
                  ? "Speaker included"
                  : "Additional guest included",
    });
  }
  return {
    attendeeDiets: Object.fromEntries(
      active.map((person) => [
        person.id,
        combineDiets(diets.get(`attendee:${person.id}`) ?? []),
      ]),
    ),
    people: [
      ...attendees
        .filter((person) => person.status === "cancelled")
        .map((person) => ({
          id: `attendee:${person.id}`,
          name: person.name,
          status: "cancelled" as const,
          sourceSignature: "",
        })),
      ...[...diets].map(([id, values]): CateringPerson => {
        const sourceSignature = JSON.stringify(
          (origins.get(id) ?? []).sort((a, b) => a[0]!.localeCompare(b[0]!)),
        );
        const saved = data.reviews?.find((review) => review.personId === id);
        return {
          id,
          name:
            targets.get(id)?.name ??
            rows.find((row) => row.target === id)!.source.name,
          status: "active",
          diet: combineDiets(values),
          sourceSignature,
          review:
            saved?.sourceSignature === sourceSignature ? saved : undefined,
          staleReview:
            saved && saved.sourceSignature !== sourceSignature
              ? saved
              : undefined,
        };
      }),
    ],
    additional: diets.size - active.length,
    pending: rows.filter(
      (row) => !row.target && mappings.get(row.source.id) !== "exclude",
    ).length,
    rows,
  };
}
