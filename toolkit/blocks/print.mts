import { printFontIds, printFonts, printFontUrl } from "./print-fonts.mjs";
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
import { badgeShapes, prepareBadgeRun } from "./badge-artwork.mjs";
import { lanyardsCount } from "./lanyard-count.mjs";
import { printPdf, withPrintPage } from "./print-browser.mjs";
import { printResults } from "./print-results.mjs";
import { importRegistrations } from "./registration-csv.mjs";
import {
  renderVenueSheets,
  venueSheetCss,
  type VenuePrintEntry,
} from "./venue-sheet.mjs";

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
  shape: v.pipe(
    v.picklist(badgeShapes),
    v.description("Cut outline. Round badges are the default."),
  ),
  font: v.pipe(
    v.picklist(printFontIds),
    v.description("Bundled typeface for badge text. Noto Sans is the default."),
  ),
  diameter: v.pipe(
    boundedNumber(70, 150),
    v.title("Trim size (mm)"),
    v.description(
      "Diameter of a circle or side of a square, before bleed. Defaults to 100 mm.",
    ),
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
  settings: {
    shape: "circle" as const,
    font: "noto-sans" as const,
    diameter: 100,
    bleed: 3,
  },
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
      async ({ rows, settings, logo, fontUrl, fontWeight, preview }) => {
        const artworkPath: string = "/badge-artwork.mjs";
        const {
          loadBadgeFont,
          renderBadgeArtwork,
          verifyBadgeLogo,
        }: typeof import("./badge-artwork.mjs") = await import(artworkPath);
        const font = await loadBadgeFont(
          await (await fetch(fontUrl)).arrayBuffer(),
          fontWeight,
        );
        await verifyBadgeLogo(logo);
        const issues = [];
        for (const { person, quantity, source, row, appearance } of rows) {
          const result = renderBadgeArtwork(
            person,
            settings,
            font,
            preview,
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
      {
        rows,
        settings,
        logo: input.logo ?? null,
        fontUrl: printFontUrl(settings.font),
        fontWeight: printFonts[settings.font].weight,
        preview: !exportPdf,
      },
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

const signSchema = strictJsonObject({
  eventName: text(120),
  accent: v.optional(color),
  font: v.optional(v.picklist(printFontIds)),
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
  font: v.optional(v.picklist(printFontIds)),
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
async function printSigns(input: SignInput | TentInput) {
  const tents = "tables" in input;
  let entries: VenuePrintEntry[];
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
    await page.addStyleTag({ content: venueSheetCss });
    await page.evaluate(renderVenueSheets, {
      eventName: input.eventName,
      entries,
      accent: input.accent,
    });
    await page.evaluate(async (tents) => {
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
    }, tents);
    return {
      pageCount: entries.length,
      widthMm: 210,
      heightMm: 297,
      artifact: await printPdf(
        page,
        tents ? "table-tents.pdf" : "venue-signs.pdf",
      ),
    };
  }, input.font);
}

export const blocks = [
  {
    id: "badges",
    title: "Print name badges",
    description:
      "Proof circular, square or rounded-square badges with a chosen typeface and export a measured PDF.",
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
