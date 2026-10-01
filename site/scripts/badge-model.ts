import * as v from "valibot";
const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
export const badgeRoleSchema = v.picklist(["attendee", "speaker", "organizer"]);
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
  people: v.pipe(v.array(badgePersonSchema), v.maxLength(2000)),
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
export function duplicateIds(people: BadgePerson[]): Set<string> {
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
export function parseCsv(input: string, delimiter: string): CsvRecord[] {
  if (![",", ";", "\t"].includes(delimiter))
    throw new Error("Choose a CSV delimiter.");
  const source = input.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let start = 1;
  const finish = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim())) records.push({ row: start, cells });
    cells = [];
    cell = "";
    closed = false;
    start = line + 1;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === delimiter) {
      cells.push(cell);
      cell = "";
      closed = false;
    } else if (char === "\n") finish();
    else if (char === '"' && !cell && !closed) quoted = true;
    else {
      if (closed || char === '"')
        throw new Error(`Malformed CSV quoting on line ${line}.`);
      cell += char;
    }
    if (char === "\n") line++;
  }
  if (quoted) throw new Error(`Unclosed quote starting on line ${start}.`);
  if (cell || cells.length || closed) finish();
  if (!records.length) throw new Error("CSV is empty.");
  if (records.length > 2001) throw new Error("Import at most 2,000 rows.");
  return records;
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
  const header = records[0];
  if (!header) throw new Error("CSV is empty.");
  if (mapping.name < 0 && (mapping.first < 0 || mapping.last < 0))
    throw new Error("Map a full name, or both first and last names.");
  return records.slice(1).map((record) => {
    if (record.cells.length !== header.cells.length)
      throw new Error(
        `Row ${record.row}: expected ${header.cells.length} columns, found ${record.cells.length}.`,
      );
    const get = (index: number) =>
      (record.cells[index] ?? "").trim().normalize("NFC");
    const name =
      mapping.name >= 0
        ? get(mapping.name)
        : [get(mapping.first), get(mapping.last)].filter(Boolean).join(" ");
    if (!name || name.length > 300)
      throw new Error(`Row ${record.row}: name is missing or too long.`);
    const email = get(mapping.email).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new Error(`Row ${record.row}: invalid attendee email.`);
    const company = get(mapping.company);
    if (company.length > 300 || email.length > 254)
      throw new Error(`Row ${record.row}: field is too long.`);
    return {
      id: crypto.randomUUID(),
      name,
      company: badgeCompany(email, company),
      email,
      source: `${source} / row ${record.row}`,
      role: "attendee",
      included: true,
      duplicateReviewed: false,
    };
  });
}
