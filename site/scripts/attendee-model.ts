import * as v from "valibot";
import { badgeCompany, importCsv, type CsvRecord } from "./badge-model.ts";

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
export const attendeeInputSchema = v.object({
  name: text(300),
  company: text(300),
  email: text(254),
  ticketCode: text(100),
  status: v.picklist(["active", "cancelled"]),
  badge: v.boolean(),
});
export type AttendeeInput = v.InferOutput<typeof attendeeInputSchema>;
export interface AttendeeRecord extends AttendeeInput {
  id: string;
  source: "tito" | "webropol";
  sourceKey: string;
}
export interface Attendee extends AttendeeRecord {
  arrivedAt: string | null;
  arrivedBy: string | null;
  arrivalRevision: number;
}
export interface AttendeeList {
  revision: number;
  attendees: Attendee[];
  role: "admin" | "registration";
}
export interface RegistrationGrant {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  link: string | null;
}
export function parseAttendeeInput(value: unknown): AttendeeInput {
  const input = v.parse(attendeeInputSchema, value);
  input.name = input.name.trim().normalize("NFC");
  input.company = input.company.trim().normalize("NFC");
  input.email = input.email.trim().toLowerCase();
  input.ticketCode = input.ticketCode.trim();
  if (!input.name || (!input.ticketCode && !input.email))
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
export function parseAttendeeRoster(value: unknown): AttendeeRecord[] {
  const records = v.parse(
    v.pipe(
      v.array(
        v.object({
          ...attendeeInputSchema.entries,
          id: v.pipe(text(100), v.minLength(1)),
          source: v.picklist(["tito", "webropol"]),
          sourceKey: v.pipe(text(400), v.minLength(1)),
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
    ...parseAttendeeInput(record),
  }));
}
export function mergeAttendeeImport(
  current: AttendeeRecord[],
  source: AttendeeRecord["source"],
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
      // Badge choices and arrival records survive a source refresh.
      result[index] = {
        ...result[index]!,
        ...input,
        badge: result[index]!.badge,
      };
    } else
      result.push({ ...input, id: crypto.randomUUID(), source, sourceKey });
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
}
export function importAttendeeCsv(
  records: CsvRecord[],
  mapping: AttendeeMapping,
): AttendeeInput[] {
  const people = importCsv(records, mapping, "Registration");
  return people.map((person, index) => {
    const record = records[index + 1]!;
    const rawStatus =
      mapping.status < 0
        ? "active"
        : (record.cells[mapping.status] ?? "").trim().toLowerCase();
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
    ];
    const cancelled = [
      "cancelled",
      "canceled",
      "void",
      "voided",
      "refunded",
      "expired",
      "deleted",
    ];
    if (!active.includes(rawStatus) && !cancelled.includes(rawStatus))
      throw new Error(
        `Row ${record.row}: unknown ticket status. Map a valid status column or remove inactive tickets before importing.`,
      );
    try {
      return parseAttendeeInput({
        ...person,
        ticketCode:
          mapping.ticketCode < 0
            ? ""
            : (record.cells[mapping.ticketCode] ?? ""),
        status: cancelled.includes(rawStatus) ? "cancelled" : "active",
        badge: true,
      });
    } catch (error) {
      throw new Error(
        `Row ${record.row}: ${error instanceof Error ? error.message : "Invalid attendee."}`,
      );
    }
  });
}
