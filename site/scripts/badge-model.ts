import { readCsvPeople } from "../../toolkit/blocks/registration-csv.mts";
import {
  badgeShapes,
  badgeAttachments,
} from "../../toolkit/blocks/badge-artwork.mts";
import { badgePaperSizes } from "../../toolkit/blocks/badge-sheets.mts";
import { printFontIds } from "../../toolkit/blocks/print-fonts.mts";
export { parseCsv } from "../../toolkit/blocks/registration-csv.mts";
import * as v from "valibot";
import { badgeRoles } from "./badge-roles.ts";
export { badgeRoles, badgeRoleAppearance } from "./badge-roles.ts";
const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
export const badgeRoleSchema = v.picklist(badgeRoles);
export const badgePersonSchema = v.object({
  id: text(100),
  name: text(300),
  company: text(300),
  email: text(254),
  role: badgeRoleSchema,
  source: text(200),
  included: v.boolean(),
  duplicateReviewed: v.boolean(),
});
const mm = (min: number, max: number) =>
  v.pipe(v.number(), v.minValue(min), v.maxValue(max));
export const badgeSettingsSchema = v.object({
  shape: v.optional(v.picklist(badgeShapes), "circle"),
  font: v.optional(v.picklist(printFontIds), "noto-sans"),
  attachment: v.optional(v.picklist(badgeAttachments), "lanyard"),
  showLogo: v.optional(v.boolean(), true),
  paper: v.optional(v.picklist(badgePaperSizes), "single"),
  sheetMargin: v.optional(mm(0, 50), 5),
  cutMarks: v.optional(v.boolean(), true),
  diameter: mm(70, 150),
  bleed: mm(0, 10),
  safe: mm(3, 15),
  top: mm(10, 30),
  minName: mm(14, 24),
  maxName: mm(24, 40),
  companySize: mm(9, 16),
  guides: v.boolean(),
  doubleSided: v.boolean(),
});
export const badgeWorkspaceSchema = v.object({
  // Live badge runs combine bounded registration imports with other sources.
  people: v.array(badgePersonSchema),
  settings: badgeSettingsSchema,
});
export type BadgePerson = v.InferOutput<typeof badgePersonSchema>;
export type BadgeRole = BadgePerson["role"];
export type BadgeSettings = v.InferOutput<typeof badgeSettingsSchema>;
export type BadgeWorkspace = v.InferOutput<typeof badgeWorkspaceSchema>;
export function badgeCompany(email: string, company: string): string {
  return !company.trim() && email.trim().toLowerCase().endsWith("aalto.fi")
    ? "Aalto University"
    : company;
}
export const defaultSettings: BadgeSettings = {
  shape: "circle",
  font: "noto-sans",
  attachment: "lanyard",
  showLogo: true,
  paper: "single",
  sheetMargin: 5,
  cutMarks: true,
  diameter: 100,
  bleed: 0,
  safe: 5,
  top: 14,
  minName: 18,
  maxName: 30,
  companySize: 12,
  guides: false,
  doubleSided: false,
};
export function parseWorkspace(value: unknown): BadgeWorkspace {
  const data = v.parse(badgeWorkspaceSchema, value);
  if (
    new Set(data.people.map((p) => p.id)).size !== data.people.length ||
    data.people.some((p) => !p.id)
  )
    throw new Error("Badge IDs must be unique.");
  for (const person of data.people)
    person.company = badgeCompany(person.email, person.company);
  return data;
}
export function duplicateIds(people: readonly BadgePerson[]): Set<string> {
  const emails = new Map<string, BadgePerson[]>();
  for (const person of people.filter((p) => p.included)) {
    const email = person.email.trim().toLowerCase();
    if (email) emails.set(email, [...(emails.get(email) ?? []), person]);
  }
  return new Set(
    [...emails.values()]
      .filter((group) => group.length > 1)
      .flatMap((group) =>
        group.filter((p) => !p.duplicateReviewed).map((p) => p.id),
      ),
  );
}
export interface CsvRecord {
  row: number;
  cells: string[];
}
export function importCsv(
  records: CsvRecord[],
  mapping: {
    name: number;
    company: number;
    email: number;
    first: number;
    last: number;
  },
  source: string,
): BadgePerson[] {
  return readCsvPeople(records, mapping, source).map((person) => ({
    ...person,
    company: badgeCompany(person.email, person.company),
  }));
}
