export function parseCsv(input, delimiter, maxRecords = 2001) {
  if (![",", ";", "\t"].includes(delimiter))
    throw new Error("Choose a CSV delimiter.");
  const source = input.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const records = [];
  let cells = [];
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
    const char = source[i];
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
  if (records.length > maxRecords)
    throw new Error("Import at most 2,000 rows.");
  return records;
}
export function readCsvPeople(
  records,
  mapping,

  source,
) {
  const header = records[0];
  if (!header) throw new Error("CSV is empty.");
  if (mapping.name < 0 && (mapping.first < 0 || mapping.last < 0))
    throw new Error("Map a full name, or both first and last names.");
  return records.slice(1).map((record) => {
    if (record.cells.length !== header.cells.length)
      throw new Error(
        `Row ${record.row}: expected ${header.cells.length} columns, found ${record.cells.length}.`,
      );
    const get = (index) => (record.cells[index] ?? "").trim().normalize("NFC");
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
      company,
      email,
      source: `${source} / row ${record.row}`,
      role: "attendee",
      included: true,
      duplicateReviewed: false,
    };
  });
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
};

export function detectAttendeeMapping(header) {
  const mapping = {
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
  for (const key of Object.keys(attendeeColumnAliases))
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
export function prepareAttendeeCsv(csv, delimiter = "auto") {
  const choices = delimiter === "auto" ? [",", ";", "\t"] : [delimiter];
  let best;
  let failure;
  for (const separator of choices) {
    try {
      const records = parseCsv(csv, separator, 2021);
      const headerIndex = records.slice(0, 20).findIndex((record) => {
        const mapping = detectAttendeeMapping(record.cells);
        return mapping.name >= 0 || (mapping.first >= 0 && mapping.last >= 0);
      });
      const start = Math.max(0, headerIndex);
      let header = records[start];
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
export function importTicketStatus(header, record, column) {
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
