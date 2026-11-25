import { resultSchema } from "../result-schema.mjs";

const badgeSummary = resultSchema(
  {
    ready: "boolean",
    badges: "integer",
    paper: { enum: ["single", "a4", "letter"] },
    badgeSizeMm: "number",
    sheetCount: "integer",
    perSheet: "integer",
    columns: "integer",
    rows: "integer",
    pageCount: "integer",
    heightMm: "number",
    widthMm: "number",
    issues: {
      type: "array",
      items: resultSchema(
        {
          row: "integer",
          source: { enum: ["people", "spares"] },
          messages: { type: "array", items: { type: "string" } },
        },
        ["row", "source", "messages"],
      ),
    },
    artifact: "object",
  },
  [
    "ready",
    "badges",
    "paper",
    "badgeSizeMm",
    "sheetCount",
    "perSheet",
    "columns",
    "rows",
    "pageCount",
    "heightMm",
    "widthMm",
    "issues",
  ],
);
const sheet = resultSchema(
  {
    pageCount: "integer",
    heightMm: "number",
    widthMm: "number",
    artifact: "object",
  },
  ["pageCount", "heightMm", "widthMm", "artifact"],
);
export const printResults = {
  badges_preflight: badgeSummary,
  badges_export_pdf: badgeSummary,
  lanyards_count: resultSchema(
    {
      roles: {
        type: "array",
        items: resultSchema({
          role: "string",
          color: "string",
          named: "integer",
          spares: "integer",
          total: "integer",
        }),
      },
      byColor: { type: "object", additionalProperties: { type: "integer" } },
      total: "integer",
    },
    ["roles", "byColor", "total"],
  ),
  registration_import_csv: resultSchema(
    {
      records: "array",
      imported: "integer",
      delimiter: "string",
      ignoredRows: "integer",
      mapping: "object",
    },
    ["records", "imported", "delimiter", "ignoredRows", "mapping"],
  ),
  venue_signs_export_pdf: sheet,
  table_tents_export_pdf: sheet,
};
