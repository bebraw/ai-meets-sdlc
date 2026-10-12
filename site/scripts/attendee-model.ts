import * as v from "valibot";
import {
  badgeCompany,
  importCsv,
  parseCsv,
  type CsvRecord,
} from "./badge-model.ts";

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
export const attendeeTypeSchema = v.picklist([
  "attendee",
  "sponsor",
  "organizer",
]);
export type AttendeeType = v.InferOutput<typeof attendeeTypeSchema>;
export const attendeeInputSchema = v.object({
  name: text(300),
  company: text(300),
  email: text(254),
  ticketCode: text(100),
  status: v.picklist(["active", "cancelled"]),
  badge: v.boolean(),
  type: v.optional(attendeeTypeSchema),
  diet: v.optional(text(2000)),
  orderCode: v.optional(text(100)),
  unassigned: v.optional(v.boolean()),
});
export type AttendeeInput = v.InferOutput<typeof attendeeInputSchema>;
export type StoredAttendeeSource = "tito" | "webropol" | "manual";
export interface AttendeeRecord extends AttendeeInput {
  type: AttendeeType;
  id: string;
  source: StoredAttendeeSource | "poster" | "volunteer";
  sourceKey: string;
  assignedAtDesk?: boolean | undefined;
}
export interface Attendee extends AttendeeRecord {
  arrivedAt: string | null;
  arrivedBy: string | null;
  arrivalRevision: number;
  arrivalId?: string;
}
export interface AttendeeList {
  revision: number;
  attendees: Attendee[];
  role: "admin" | "registration";
  pendingRegistrations?: number;
}
export interface RegistrationGrant {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  link: string | null;
}
export function isStoredAttendee(
  person: Pick<AttendeeRecord, "source">,
): boolean {
  return ["tito", "webropol", "manual"].includes(person.source);
}
export function parseAttendeeInput(value: unknown): AttendeeInput {
  const input = v.parse(attendeeInputSchema, value);
  input.name = input.name.trim().normalize("NFC");
  input.company = input.company.trim().normalize("NFC");
  input.email = input.email.trim().toLowerCase();
  input.ticketCode = input.ticketCode.trim();
  if (input.orderCode !== undefined) input.orderCode = input.orderCode.trim();
  if (input.diet !== undefined) input.diet = input.diet.trim().normalize("NFC");
  if (input.unassigned) {
    if (!input.ticketCode || input.name || input.email)
      throw new Error(
        "An unassigned ticket needs a ticket code and blank attendee name and email.",
      );
    input.badge = false;
  } else if (!input.name || (!input.ticketCode && !input.email))
    throw new Error(
      "Each attendee needs a name and a ticket code or attendee email.",
    );
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(input.email))
    throw new Error("Invalid attendee email.");
  input.company = badgeCompany(input.email, input.company);
  return input;
}
export function attendeeSourceKey(input: AttendeeInput): string {
  return input.ticketCode
    ? `ticket:${input.ticketCode.toLowerCase()}`
    : `email:${input.email}`;
}
export function attendeeOrderCode(
  person: Pick<AttendeeRecord, "source" | "ticketCode" | "orderCode">,
): string {
  return (
    person.orderCode ||
    (person.source === "tito"
      ? (person.ticketCode.match(/^(.+)-\d+$/u)?.[1] ?? "")
      : "")
  );
}
export function parseAttendeeRoster(value: unknown): AttendeeRecord[] {
  const records = v.parse(
    v.pipe(
      v.array(
        v.object({
          ...attendeeInputSchema.entries,
          type: v.optional(attendeeTypeSchema, "attendee"),
          id: v.pipe(text(100), v.minLength(1)),
          source: v.picklist(["tito", "webropol", "manual"]),
          sourceKey: v.pipe(text(400), v.minLength(1)),
          assignedAtDesk: v.optional(v.boolean()),
        }),
      ),
      v.maxLength(2000),
    ),
    value,
  );
  if (
    new Set(records.map((p) => p.id)).size !== records.length ||
    new Set(records.map((p) => `${p.source}:${p.sourceKey}`)).size !==
      records.length
  )
    throw new Error("Duplicate attendee identities.");
  const ticketKeys = records
    .filter((p) => p.ticketCode.trim())
    .map((p) => `${p.source}:${p.ticketCode.trim().toLowerCase()}`);
  if (new Set(ticketKeys).size !== ticketKeys.length)
    throw new Error(
      "A ticket code appears more than once in the same registration source.",
    );
  return records.map((record) => ({
    ...record,
    ...parseStoredInput(record),
    type: record.type,
  }));
}
function parseStoredInput(record: AttendeeRecord): AttendeeInput {
  if (record.unassigned && record.source !== "tito")
    throw new Error("Only Tito tickets can be unassigned.");
  return parseAttendeeInput(record);
}
export function addManualAttendee(
  current: AttendeeRecord[],
  value: unknown,
): AttendeeRecord[] {
  const input = parseAttendeeInput(value);
  const sourceKey = attendeeSourceKey(input);
  if (current.some((p) => p.source === "manual" && p.sourceKey === sourceKey))
    throw new Error(
      "A manual attendee with this ticket code or email already exists. Edit the existing attendee.",
    );
  return parseAttendeeRoster([
    ...current,
    {
      ...input,
      type: input.type ?? "attendee",
      id: crypto.randomUUID(),
      source: "manual",
      sourceKey,
    },
  ]);
}
export function mergeAttendeeImport(
  current: AttendeeRecord[],
  source: "tito" | "webropol",
  rows: AttendeeInput[],
): AttendeeRecord[] {
  if (!rows.length || rows.length > 2000)
    throw new Error("Import 1 to 2,000 attendees.");
  const result = current.map((p) => ({ ...p }));
  const keys = new Set<string>();
  for (const row of rows) {
    const input = parseAttendeeInput(row);
    const sourceKey = attendeeSourceKey(input);
    if (keys.has(sourceKey))
      throw new Error(
        "Duplicate ticket code or email in this import. Map individual ticket codes when an email has multiple tickets.",
      );
    keys.add(sourceKey);
    const index = result.findIndex(
      (p) => p.source === source && p.sourceKey === sourceKey,
    );
    if (index >= 0) {
      // Unmapped diets/types, badge choices, and arrivals survive a source refresh.
      const { diet, type, ...details } = input;
      const existing = result[index]!;
      const keepDeskAssignment = existing.assignedAtDesk && input.unassigned;
      result[index] = {
        ...existing,
        ...details,
        ...(diet === undefined || keepDeskAssignment ? {} : { diet }),
        ...(keepDeskAssignment
          ? {
              name: existing.name,
              email: existing.email,
              company: existing.company,
              unassigned: false,
            }
          : { unassigned: input.unassigned ?? false, assignedAtDesk: false }),
        type: type ?? existing.type,
        badge:
          existing.unassigned && !input.unassigned
            ? input.badge
            : existing.badge,
      };
    } else
      result.push({
        ...input,
        type: input.type ?? "attendee",
        id: crypto.randomUUID(),
        source,
        sourceKey,
      });
  }
  return parseAttendeeRoster(result);
}
export interface AttendeeMapping {
  name: number;
  company: number;
  email: number;
  first: number;
  last: number;
  ticketCode: number;
  status: number;
  diet?: number;
  orderCode?: number;
}

export const attendeeColumnAliases = {
  name: ["name", "full name", "ticket full name", "nimi"],
  company: [
    "company",
    "company name",
    "ticket company name",
    "organisaatio",
    "yritys",
  ],
  email: [
    "email",
    "email address",
    "ticket email",
    "ticket email address",
    "sähköposti",
  ],
  first: ["first name", "ticket first name", "etunimi"],
  last: ["last name", "ticket last name", "sukunimi"],
  ticketCode: [
    "ticket code",
    "ticket reference",
    "reference",
    "ticket id",
    "ticket number",
    "barcode",
  ],
  orderCode: [
    "registration reference",
    "order reference",
    "order code",
    "order id",
  ],
  status: [
    "status",
    "ticket status",
    "registration status",
    "void status",
    "tila",
  ],
  diet: [
    "diet",
    "dietary requirements",
    "dietary restrictions",
    "food restrictions",
    "food allergies",
    "allergies",
    "special diet",
    "ruokarajoitteet",
    "ruokarajoitukset",
    "erityisruokavalio",
    "what kind of food restrictions do you have?",
  ],
} satisfies Record<keyof AttendeeMapping, string[]>;

export function detectAttendeeMapping(
  header: string[],
): Required<AttendeeMapping> {
  const mapping: Required<AttendeeMapping> = {
    name: -1,
    company: -1,
    email: -1,
    first: -1,
    last: -1,
    ticketCode: -1,
    status: -1,
    diet: -1,
    orderCode: -1,
  };
  for (const key of Object.keys(
    attendeeColumnAliases,
  ) as (keyof AttendeeMapping)[])
    mapping[key] = header.reduce(
      (found, label, index) =>
        attendeeColumnAliases[key].includes(label.trim().toLowerCase())
          ? index
          : found,
      -1,
    );
  return mapping;
}

/** Keep original line numbers while removing Webropol metadata and merging its two header rows. */
export function prepareAttendeeCsv(
  csv: string,
  delimiter = "auto",
): {
  records: CsvRecord[];
  delimiter: string;
  ignoredRows: number;
} {
  const choices = delimiter === "auto" ? [",", ";", "\t"] : [delimiter];
  let best:
    | {
        records: CsvRecord[];
        delimiter: string;
        ignoredRows: number;
        score: number;
      }
    | undefined;
  let failure: unknown;
  for (const separator of choices) {
    try {
      const records = parseCsv(csv, separator, 2021);
      const headerIndex = records.slice(0, 20).findIndex((record) => {
        const mapping = detectAttendeeMapping(record.cells);
        return mapping.name >= 0 || (mapping.first >= 0 && mapping.last >= 0);
      });
      const start = Math.max(0, headerIndex);
      let header = records[start]!;
      let next = start + 1;
      const continuation = records[next];
      const allAliases = new Set(Object.values(attendeeColumnAliases).flat());
      if (
        headerIndex >= 0 &&
        continuation &&
        continuation.cells.length === header.cells.length &&
        continuation.cells.every(
          (cell) =>
            !cell.trim() ||
            cell.trim() === "-" ||
            allAliases.has(cell.trim().toLowerCase()),
        ) &&
        Object.values(detectAttendeeMapping(continuation.cells)).filter(
          (index) => index >= 0,
        ).length >= 2
      ) {
        header = {
          row: continuation.row,
          cells: header.cells.map((cell, index) => {
            const extra = continuation.cells[index]?.trim();
            return extra && extra !== "-" ? extra : cell;
          }),
        };
        next++;
      }
      const recognized = Object.values(
        detectAttendeeMapping(header.cells),
      ).filter((index) => index >= 0).length;
      const score = recognized * 1000 + header.cells.length;
      if (!best || score > best.score)
        best = {
          records: [header, ...records.slice(next)],
          delimiter: separator,
          ignoredRows: next - 1,
          score,
        };
    } catch (error) {
      failure = error;
    }
  }
  if (!best)
    throw failure instanceof Error ? failure : new Error("Unable to read CSV.");
  return {
    records: best.records,
    delimiter: best.delimiter,
    ignoredRows: best.ignoredRows,
  };
}
function importTicketStatus(
  header: CsvRecord,
  record: CsvRecord,
  column: number,
): AttendeeInput["status"] {
  let rawStatus =
    column < 0 ? "active" : (record.cells[column] ?? "").trim().toLowerCase();
  if (header.cells[column]?.trim().toLowerCase() === "void status") {
    if (["", "false", "no", "not void", "not voided"].includes(rawStatus))
      rawStatus = "active";
    else if (["true", "yes"].includes(rawStatus)) rawStatus = "voided";
  }
  const active = [
    "active",
    "valid",
    "confirmed",
    "paid",
    "complete",
    "completed",
    "issued",
    "registered",
    "assigned",
    "ilmoittautunut",
    "vahvistettu",
    "maksettu",
  ];
  const cancelled = [
    "cancelled",
    "canceled",
    "void",
    "voided",
    "refunded",
    "expired",
    "deleted",
    "peruttu",
    "peruutettu",
  ];
  if (active.includes(rawStatus)) return "active";
  if (cancelled.includes(rawStatus)) return "cancelled";
  throw new Error(
    `Row ${record.row}: unknown ticket status. Map a valid status column or remove inactive tickets before importing.`,
  );
}

export function importAttendeeCsv(
  records: CsvRecord[],
  mapping: AttendeeMapping,
  type?: AttendeeType,
  source?: "tito" | "webropol",
): AttendeeInput[] {
  const header = records[0]!;
  const unassignedRows = new Set<number>();
  const validationRecords = records.map((record, index) => {
    if (
      index &&
      source === "tito" &&
      mapping.ticketCode >= 0 &&
      mapping.email >= 0 &&
      (mapping.name >= 0 || (mapping.first >= 0 && mapping.last >= 0)) &&
      record.cells.length === header.cells.length &&
      record.cells[mapping.ticketCode]?.trim() &&
      ![mapping.name, mapping.first, mapping.last, mapping.email].some(
        (column) => column >= 0 && record.cells[column]?.trim(),
      )
    ) {
      unassignedRows.add(index);
      // Validate all other CSV fields without persisting a placeholder as a person's name.
      const cells = [...record.cells];
      cells[mapping.name >= 0 ? mapping.name : mapping.first] =
        "Unassigned ticket";
      return { ...record, cells };
    }
    return record;
  });
  const people = importCsv(validationRecords, mapping, "Registration");
  return people.map((person, index) => {
    const record = records[index + 1]!;
    const status = importTicketStatus(header, record, mapping.status);
    const ticketCode =
      mapping.ticketCode < 0 ? "" : (record.cells[mapping.ticketCode] ?? "");
    const orderCode =
      mapping.orderCode !== undefined && mapping.orderCode >= 0
        ? (record.cells[mapping.orderCode]?.trim() ?? "")
        : source === "tito"
          ? attendeeOrderCode({ source, ticketCode, orderCode: "" })
          : "";
    const unassigned = unassignedRows.has(index + 1);
    try {
      return parseAttendeeInput({
        ...person,
        ...(unassigned ? { name: "", unassigned: true } : {}),
        ticketCode,
        ...(orderCode ? { orderCode } : {}),
        status,
        badge: !unassigned,
        ...(type === undefined ? {} : { type }),
        ...(mapping.diet !== undefined && mapping.diet >= 0
          ? { diet: record.cells[mapping.diet] ?? "" }
          : {}),
      });
    } catch (error) {
      throw new Error(
        `Row ${record.row}: ${error instanceof Error ? error.message : "Invalid attendee."}`,
      );
    }
  });
}
