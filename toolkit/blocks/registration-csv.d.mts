export interface CsvRecord {
  row: number;
  cells: string[];
}
export interface CsvMapping {
  name: number;
  company: number;
  email: number;
  first: number;
  last: number;
}
export interface TicketMapping extends CsvMapping {
  ticketCode: number;
  status: number;
  orderCode: number;
  diet: number;
}
export const attendeeColumnAliases: Record<keyof TicketMapping, string[]>;
export function parseCsv(
  input: string,
  delimiter: string,
  maxRecords?: number,
): CsvRecord[];
export function readCsvPeople(
  records: CsvRecord[],
  mapping: CsvMapping,
  source: string,
): {
  id: string;
  name: string;
  company: string;
  email: string;
  source: string;
  role: "attendee";
  included: boolean;
  duplicateReviewed: boolean;
}[];
export function detectAttendeeMapping(header: string[]): TicketMapping;
export function prepareAttendeeCsv(
  csv: string,
  delimiter?: string,
): {
  records: CsvRecord[];
  delimiter: string;
  ignoredRows: number;
};
export function importTicketStatus(
  header: CsvRecord,
  record: CsvRecord,
  column: number,
): "active" | "cancelled";
