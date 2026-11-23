import {
  strictJsonObject,
  partialJsonObject,
  jsonObject,
} from "../json-object.mjs";
import * as v from "valibot";
import { defineOperation, type InternalBlock } from "../contracts.mjs";
import {
  text,
  integer,
  boundedNumber,
  list,
  color,
} from "./supplied-fields.mjs";
import { prepareBadgeRun } from "./badge-artwork.mjs";
import { lanyardsCount } from "./lanyard-count.mjs";
import { printPdf, withPrintPage } from "./print-browser.mjs";
import { printResults } from "./print-results.mjs";
import {
  detectAttendeeMapping,
  importTicketStatus,
  prepareAttendeeCsv,
} from "./registration-csv.mjs";

const role = text(36);
const colors = list(
  strictJsonObject({ role, background: color, foreground: color }),
  32,
);
const spares = list(strictJsonObject({ role, count: integer(0, 2000) }), 32);
const logo = v.pipe(
  v.string(),
  v.maxCodePoints(1400000),
  v.regex(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/),
  v.description("Embedded PNG, JPEG, WebP or SVG logo as a base64 data URL."),
);
const geometry = partialJsonObject({
  diameter: v.pipe(
    boundedNumber(70, 150),
    v.description("Trim diameter in mm (default 100)."),
  ),
  bleed: v.pipe(
    boundedNumber(0, 10),
    v.description("Bleed in mm on each edge."),
  ),
  safe: boundedNumber(3, 15),
  top: boundedNumber(10, 30),
  minName: integer(14, 24),
  maxName: integer(24, 40),
  companySize: integer(9, 16),
  guides: v.boolean(),
  doubleSided: v.boolean(),
});
const badgeSchema = strictJsonObject({
  people: list(
    strictJsonObject({
      name: text(300),
      company: v.optional(text(300, 0)),
      role,
    }),
    2000,
  ),
  spares: v.optional(spares),
  settings: v.optional(geometry),
  colors: v.optional(colors),
  logo: v.optional(logo),
});
const badgeExample = {
  logo:
    "data:image/svg+xml;base64," +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8" fill="#7746b5"/><path d="M12 12h24v5H18v5h14v5H18v9h-6z" fill="white"/></svg>',
    ).toString("base64"),
  people: [
    { name: "Zoë Marin", company: "Field Notes", role: "speaker" },
    { name: "Ari Chen", company: "Local Lab", role: "speaker" },
  ],
  spares: [{ role: "attendee", count: 1 }],
  settings: { diameter: 100, bleed: 3 },
};
async function badgeRun(
  input: v.InferOutput<typeof badgeSchema>,
  exportPdf: boolean,
) {
  const { rows, settings, badges, widthMm, pageCount } = prepareBadgeRun(input);
  return withPrintPage(async (page) => {
    await page.addStyleTag({
      content: `@page{size:${widthMm}mm ${widthMm}mm;margin:0}article{width:${widthMm}mm;height:${widthMm}mm}`,
    });
    const issues = await page.evaluate(
      async ({ rows, settings, logo }) => {
        const artworkPath: string = "/badge-artwork.mjs";
        const {
          loadBadgeFont,
          renderBadgeArtwork,
          verifyBadgeLogo,
        }: typeof import("./badge-artwork.mjs") = await import(artworkPath);
        const font = await loadBadgeFont(
          await (await fetch("/font.ttf")).arrayBuffer(),
        );
        await verifyBadgeLogo(logo);
        const issues = [];
        for (const { person, quantity, source, row, appearance } of rows) {
          const result = renderBadgeArtwork(
            person,
            settings,
            font,
            false,
            source === "spares",
            appearance,
            logo,
          );
          if (result.issues.length)
            issues.push({ row, source, messages: result.issues });
          const sheet = document.createElement("article");
          sheet.append(result.svg);
          const copies = quantity * (settings.doubleSided ? 2 : 1);
          for (let index = 0; index < copies; index++)
            document.body.append(index ? sheet.cloneNode(true) : sheet);
        }
        await document.fonts.ready;
        return issues;
      },
      { rows, settings, logo: input.logo ?? null },
    );
    const summary = {
      ready: issues.length === 0,
      badges,
      pageCount,
      widthMm,
      heightMm: widthMm,
      issues,
    };
    if (exportPdf)
      return issues.length
        ? summary
        : { ...summary, artifact: await printPdf(page, "badges.pdf") };
    return {
      ...summary,
      artifact: {
        name: "badge-proof.png",
        mimeType: "image/png",
        bytes: await page.locator("article").first().screenshot(),
      },
    };
  });
}

const column = v.pipe(
  integer(-1, 2048),
  v.description("Zero-based column index, or -1 to ignore."),
);
const mapping = partialJsonObject({
  name: column,
  first: column,
  last: column,
  company: column,
  email: column,
  ticketCode: column,
  orderCode: column,
  status: column,
  diet: column,
});
const previousRecord = jsonObject(
  v.looseObject({
    id: text(160),
    source: text(60),
    sourceKey: text(340),
  }),
);
const registrationSchema = strictJsonObject({
  csv: v.pipe(
    text(3_000_000),
    v.description("Paste a ticket export including its header row."),
  ),
  source: v.picklist(["tito", "webropol", "csv"]),
  delimiter: v.optional(v.picklist(["auto", ",", ";", "\t"])),
  mapping: v.optional(mapping),
  previous: v.optional(list(previousRecord, 2000)),
});

function importRegistrations({
  csv,
  source,
  delimiter = "auto",
  mapping = {},
  previous = [],
}: v.InferOutput<typeof registrationSchema>) {
  const data = prepareAttendeeCsv(csv, delimiter);
  const [header, ...rows] = data.records;
  const columns = { ...detectAttendeeMapping(header.cells), ...mapping };
  if (Object.values(columns).some((n) => n >= header.cells.length))
    throw new Error("A mapped column is outside the CSV header.");
  if (columns.name < 0 && (columns.first < 0 || columns.last < 0))
    throw new Error("Map a full name or first and last names.");
  if (columns.ticketCode < 0 && columns.email < 0)
    throw new Error("Map a ticket code or attendee email.");
  if (!rows.length || rows.length > 2000)
    throw new Error("Import 1 to 2,000 registration rows.");
  const records = new Map<string, v.InferOutput<typeof previousRecord>>(),
    ids = new Set<string>();
  for (const p of previous) {
    const key = JSON.stringify([p.source, p.sourceKey]);
    if (records.has(key) || ids.has(p.id))
      throw new Error(
        "Previous registrations must have distinct IDs and source keys.",
      );
    ids.add(p.id);
    records.set(key, { ...p });
  }
  const seen = new Set();
  for (const row of rows) {
    if (row.cells.length !== header.cells.length)
      throw new Error(
        `Row ${row.row}: expected ${header.cells.length} columns, found ${row.cells.length}.`,
      );
    const get = (key: keyof typeof columns) =>
      (row.cells[columns[key]] ?? "").trim().normalize("NFC");
    const name =
      columns.name >= 0
        ? get("name")
        : [get("first"), get("last")].filter(Boolean).join(" ");
    const email = get("email").toLowerCase(),
      ticketCode = get("ticketCode");
    const unassigned =
      source === "tito" &&
      Boolean(ticketCode) &&
      !name &&
      !email &&
      columns.email >= 0;
    if ((!name && !unassigned) || (!email && !ticketCode))
      throw new Error(
        `Row ${row.row}: supply a name and a ticket code or attendee email.`,
      );
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
      throw new Error(`Row ${row.row}: invalid attendee email.`);
    if (
      name.length > 300 ||
      get("company").length > 300 ||
      email.length > 254 ||
      ticketCode.length > 100 ||
      get("orderCode").length > 100 ||
      get("diet").length > 2000
    )
      throw new Error(`Row ${row.row}: field is too long.`);
    const sourceKey = ticketCode
      ? `ticket:${ticketCode.toLowerCase()}`
      : `email:${email}`;
    if (seen.has(sourceKey))
      throw new Error(
        `Row ${row.row}: repeated ticket code or email within this source.`,
      );
    seen.add(sourceKey);
    const key = JSON.stringify([source, sourceKey]),
      old = records.get(key);
    const keepDeskAssignment = old?.assignedAtDesk && unassigned;
    const record: v.InferOutput<typeof previousRecord> = {
      ...old,
      id: old?.id ?? crypto.randomUUID(),
      source,
      sourceKey,
      name,
      company: get("company"),
      email,
      ticketCode,
      orderCode:
        get("orderCode") ||
        (source === "tito" ? (ticketCode.match(/^(.+)-\d+$/u)?.[1] ?? "") : ""),
      type: old?.type ?? "attendee",
      badge: old?.badge ?? !unassigned,
      unassigned,
      status: importTicketStatus(header, row, columns.status),
    };
    if (columns.diet >= 0) record.diet = get("diet");
    if (keepDeskAssignment)
      Object.assign(record, {
        name: old.name,
        email: old.email,
        company: old.company,
        unassigned: false,
        diet: old.diet,
      });
    else if (old?.assignedAtDesk) record.assignedAtDesk = false;
    if (old?.unassigned && !unassigned) record.badge = true;
    records.set(key, record);
  }
  if (records.size > 2000)
    throw new Error("The merged roster exceeds 2,000 registrations.");
  return {
    records: [...records.values()],
    imported: rows.length,
    delimiter: data.delimiter,
    ignoredRows: data.ignoredRows,
    mapping: columns,
  };
}

const signSchema = strictJsonObject({
  eventName: text(120),
  accent: v.optional(color),
  signs: list(
    strictJsonObject({
      title: text(100),
      detail: v.optional(text(280, 0)),
      direction: v.optional(v.picklist(["left", "right", "ahead"])),
      url: v.optional(
        v.pipe(v.string(), v.regex(/^https?:\/\//), v.maxCodePoints(400)),
      ),
    }),
    64,
    1,
  ),
});
const tentSchema = strictJsonObject({
  eventName: text(120),
  accent: v.optional(color),
  tables: list(
    strictJsonObject({
      label: text(50),
      topic: text(100),
      question: v.optional(text(280)),
    }),
    64,
    1,
  ),
});
type SignInput = v.InferOutput<typeof signSchema>;
type TentInput = v.InferOutput<typeof tentSchema>;
type PrintEntry =
  | TentInput["tables"][number]
  | (SignInput["signs"][number] & { qr?: string });
async function printSigns(input: SignInput | TentInput) {
  const tents = "tables" in input;
  let entries: PrintEntry[];
  if (tents) entries = input.tables;
  else {
    const qr = input.signs.some((row) => row.url)
      ? (await import("qrcode")).default
      : undefined;
    entries = await Promise.all(
      input.signs.map(async (row) => ({
        ...row,
        ...(row.url && qr
          ? {
              qr: await qr.toDataURL(row.url, {
                width: 430,
                margin: 4,
                errorCorrectionLevel: "M",
              }),
            }
          : {}),
      })),
    );
  }
  return withPrintPage(async (page) => {
    await page.addStyleTag({
      content: `@page{size:A4 portrait;margin:0}article{width:210mm;height:297mm;overflow:hidden;--accent:${input.accent ?? "#245c49"}}.sign{padding:14mm;display:flex;flex-direction:column;gap:8mm}.brand{font-size:18pt;font-weight:700;color:var(--accent)}h1,p{margin:0}h1{font-size:46pt;line-height:1.07;overflow-wrap:anywhere}p{font-size:20pt;line-height:1.25;overflow-wrap:anywhere}.arrow{height:45mm;width:45mm;color:var(--accent)}.qr{width:48mm;height:48mm;align-self:start;margin-top:auto}.face{height:99mm;padding:8mm 12mm;display:flex;flex-direction:column;justify-content:center;gap:3mm;overflow:hidden}.face h1{font-size:27pt}.face p{font-size:13pt}.face .brand{font-size:11pt}.face:first-child{transform:rotate(180deg)}.fold{height:0;border-top:0.3mm dashed #888;position:relative;margin-bottom:-0.3mm}`,
    });
    await page.evaluate(
      async ({ eventName, entries, tents }) => {
        function element<K extends keyof HTMLElementTagNameMap>(
          tag: K,
          value?: string | null,
          cls?: string,
        ): HTMLElementTagNameMap[K] {
          const node = document.createElement(tag);
          if (value) node.textContent = value;
          if (cls) node.className = cls;
          return node;
        }
        for (const [index, row] of entries.entries()) {
          const sheet = element("article");
          document.body.append(sheet);
          if ("topic" in row) {
            const face = element("section", null, "face");
            face.append(
              element("div", `${eventName} · ${row.label}`, "brand"),
              element("h1", row.topic),
            );
            if (row.question) face.append(element("p", row.question));
            sheet.append(
              face,
              element("div", null, "fold"),
              face.cloneNode(true),
              element("div", null, "fold"),
            );
          } else {
            sheet.className = "sign";
            sheet.append(element("div", eventName, "brand"));
            if (row.direction) {
              const ns = "http://www.w3.org/2000/svg",
                arrow = document.createElementNS(ns, "svg"),
                path = document.createElementNS(ns, "path");
              arrow.setAttribute("viewBox", "0 0 100 100");
              arrow.setAttribute("class", "arrow");
              arrow.setAttribute("aria-label", row.direction);
              path.setAttribute("d", "M10 39 H57 V16 L92 50 L57 84 V61 H10 Z");
              path.setAttribute("fill", "currentColor");
              path.setAttribute(
                "transform",
                `rotate(${{ right: 0, left: 180, ahead: -90 }[row.direction]} 50 50)`,
              );
              arrow.append(path);
              sheet.append(arrow);
            }
            sheet.append(element("h1", row.title));
            if (row.detail) sheet.append(element("p", row.detail));
            if (row.qr) {
              const image = element("img", null, "qr");
              image.src = row.qr;
              image.alt = "QR code";
              sheet.append(image);
            }
          }
          sheet.dataset.index = String(index + 1);
        }
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
        for (const node of document.querySelectorAll(tents ? ".face" : ".sign"))
          if (
            node.scrollHeight > node.clientHeight + 1 ||
            node.scrollWidth > node.clientWidth + 1
          )
            throw new Error(
              `Page ${node.closest("article")?.dataset.index} exceeds the print area. Shorten the text.`,
            );
      },
      { eventName: input.eventName, entries, tents },
    );
    return {
      pageCount: entries.length,
      widthMm: 210,
      heightMm: 297,
      artifact: await printPdf(
        page,
        tents ? "table-tents.pdf" : "venue-signs.pdf",
      ),
    };
  });
}

export const blocks = [
  {
    id: "badges",
    title: "Print name badges",
    description: "Check round badge artwork and export a measured PDF.",
    operations: [
      defineOperation({
        name: "badges_preflight",
        outputSchema: printResults.badges_preflight,
        description:
          "Preview the first badge and check every row for missing glyphs and fit.",
        schema: badgeSchema,
        example: badgeExample,
        run: (input) => badgeRun(input, false),
      }),
      defineOperation({
        name: "badges_export_pdf",
        outputSchema: printResults.badges_export_pdf,
        description: "Prepare a printable PDF when every row passes preflight.",
        schema: badgeSchema,
        example: badgeExample,
        run: (input) => badgeRun(input, true),
      }),
    ],
  },
  {
    id: "lanyards",
    title: "Order lanyards",
    description: "Count named and spare lanyards by role and color.",
    operations: [
      defineOperation({
        name: "lanyards_count",
        outputSchema: printResults.lanyards_count,
        description:
          "Count one lanyard per included badge plus requested spares.",
        schema: strictJsonObject({
          people: list(
            strictJsonObject({ role, included: v.optional(v.boolean(), true) }),
            4000,
          ),
          spares: v.optional(spares),
          colors: v.optional(
            list(strictJsonObject({ role, color: text(40) }), 32),
          ),
        }),
        example: {
          people: [{ role: "speaker" }, { role: "speaker" }],
          spares: [{ role: "attendee", count: 1 }],
          colors: [
            { role: "speaker", color: "Blue" },
            { role: "attendee", color: "Green" },
          ],
        },
        run: lanyardsCount,
      }),
    ],
  },
  {
    id: "registration-import",
    title: "Import a registration CSV",
    description:
      "Detect Tito, Webropol or custom ticket columns and merge repeat imports.",
    operations: [
      defineOperation({
        name: "registration_import_csv",
        outputSchema: printResults.registration_import_csv,
        description:
          "Normalize registration records. Supply previous records to preserve their IDs on reimport.",
        schema: registrationSchema,
        example: {
          source: "tito",
          csv: "Ticket Full Name,Ticket Company Name,Ticket Email,Ticket Reference\nZoë Marin,Field Notes,zoe@example.test,FN-1",
        },
        run: importRegistrations,
      }),
    ],
  },
  {
    id: "venue-signs",
    title: "Print venue signs",
    description:
      "Create an A4 wayfinding pack with arrows and scannable links.",
    operations: [
      defineOperation({
        name: "venue_signs_export_pdf",
        outputSchema: printResults.venue_signs_export_pdf,
        description:
          "Export one A4 page per sign. To print an individual sign, supply one entry.",
        schema: signSchema,
        example: {
          eventName: "Field Notes Forum",
          signs: [
            {
              title: "Registration",
              direction: "left",
              detail: "Collect your badge in the foyer.",
            },
            {
              title: "Today’s programme",
              url: "https://example.org/programme",
            },
          ],
        },
        run: printSigns,
      }),
    ],
  },
  {
    id: "table-tents",
    title: "Print discussion table tents",
    description: "Generate foldable A4 table cards with two readable faces.",
    operations: [
      defineOperation({
        name: "table_tents_export_pdf",
        outputSchema: printResults.table_tents_export_pdf,
        description:
          "Export one foldable sheet per table with a topic and optional starter question.",
        schema: tentSchema,
        example: {
          eventName: "Field Notes Forum",
          tables: [
            {
              label: "Table 1",
              topic: "Local knowledge",
              question: "What should we learn from our neighbors?",
            },
          ],
        },
        run: printSigns,
      }),
    ],
  },
] satisfies InternalBlock[];
