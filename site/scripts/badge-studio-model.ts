import * as v from "valibot";
import {
  badgeSettingsSchema,
  type BadgePerson,
  type BadgeSettings,
} from "./badge-model.ts";

const overrideSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  signature: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)),
  name: v.pipe(v.string(), v.minLength(1), v.maxLength(300)),
  company: v.pipe(v.string(), v.maxLength(300)),
  duplicateReviewed: v.boolean(),
});
export const maxSpareAttendeeBadges = 2000;
const spareBadgeCountSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(maxSpareAttendeeBadges),
);
export const printPreferencesSchema = v.object({
  settings: badgeSettingsSchema,
  overrides: v.array(overrideSchema),
  spareAttendeeBadges: v.optional(spareBadgeCountSchema, 0),
  retiredLegacyIds: v.optional(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
    () => [],
  ),
});
export type BadgeOverride = v.InferOutput<typeof overrideSchema>;
export type PrintPreferences = v.InferOutput<typeof printPreferencesSchema>;
export interface BadgeStudioData {
  revision: number;
  people: BadgePerson[];
  signatures: Record<string, string>;
  preferences: PrintPreferences;
  legacyCount: number;
  legacyWorkspace: { people: BadgePerson[]; settings: BadgeSettings } | null;
}
export function parsePrintPreferences(value: unknown): PrintPreferences {
  const data = v.parse(printPreferencesSchema, value);
  if (
    new Set(data.overrides.map((p) => p.id)).size !== data.overrides.length ||
    data.overrides.some((p) => !p.name.trim()) ||
    new Set(data.retiredLegacyIds).size !== data.retiredLegacyIds.length
  )
    throw new Error("Invalid badge overrides.");
  return data;
}
export function requestedSpareAttendeeBadges(
  search: string,
): number | undefined {
  const value = new URLSearchParams(search).get("spares");
  if (value === null || !/^\d+$/u.test(value)) return undefined;
  const parsed = v.safeParse(spareBadgeCountSchema, Number(value));
  return parsed.success ? parsed.output : undefined;
}
export function applyPrintPreferences(
  people: BadgePerson[],
  preferences: PrintPreferences,
  signatures: Record<string, string>,
): BadgePerson[] {
  const overrides = new Map(preferences.overrides.map((p) => [p.id, p]));
  const retired = new Set(preferences.retiredLegacyIds);
  return people
    .filter((person) => !isLegacyBadgeId(person.id) || !retired.has(person.id))
    .map((person) => {
      const override = overrides.get(person.id);
      return override && override.signature === signatures[person.id]
        ? {
            ...person,
            name: override.name,
            company: override.company,
            duplicateReviewed: override.duplicateReviewed,
          }
        : { ...person };
    });
}
export function isLegacyBadgeId(id: string): boolean {
  return !/^(attendees|speakers|organizers|volunteers):/u.test(id);
}
