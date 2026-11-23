import { createHash } from "node:crypto";
import feedSchema from "./event-feed.schema.json" with { type: "json" };
import { validateProgramme } from "./programme-validation.mjs";
import { resultSchema } from "../result-schema.mjs";
import {
  dietCategories,
  summarizeAttendeeDiets,
  dietRequirementsText,
} from "./diets.mjs";
import { withPrintPage } from "./print-browser.mjs";

const text = (maxLength = 240) => ({ type: "string", minLength: 1, maxLength });
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const list = (items, maxItems = 2000) => ({ type: "array", items, maxItems });
const select = (...values) => ({ type: "string", enum: values });
const artifact = (name, mimeType, body) => ({
  name,
  mimeType,
  bytes: Buffer.from(body),
});
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const headline = "Field Notes Forum";
const counts = { type: "integer", minimum: 0, maximum: 10000 };
const review = obj(
  {
    status: select("reviewed", "clarify", "none", "missing"),
    categories: list(
      select(...dietCategories.map((c) => c.id)),
      dietCategories.length,
    ),
    note: { type: "string", maxLength: 2000 },
  },
  ["status", "categories"],
);
const cater = {
  outputSchema: resultSchema(
    {
      active: "integer",
      cancelled: "integer",
      missing: "integer",
      noRestrictions: "integer",
      requirements: "integer",
      needsReview: "integer",
      counts: "array",
      groups: "array",
      reservedMeals: "integer",
      artifact: "object",
    },
    ["active", "reservedMeals", "counts", "groups", "artifact"],
  ),
  name: "catering_prepare_brief",
  description:
    "Group original dietary requirements and reviewed exceptions, count reserved meals and export a plain-text caterer brief.",
  inputSchema: obj(
    {
      eventName: text(),
      people: list(
        obj(
          {
            status: select("active", "cancelled"),
            diet: { type: "string", maxLength: 2000 },
            review,
          },
          [],
        ),
      ),
      reservedMeals: counts,
    },
    ["eventName", "people"],
  ),
  example: {
    eventName: headline,
    people: [
      { diet: "Vegan and gluten free" },
      { diet: "Tree nut allergy" },
      { diet: "No restrictions" },
    ],
    reservedMeals: 2,
  },
  run({ eventName, people, reservedMeals = 0 }) {
    const rows = people.map(({ status = "active", diet, review }) => ({
      status,
      diet,
      review: review && { ...review, note: review.note ?? "" },
    }));
    for (const row of rows) {
      const r = row.review;
      if (
        r &&
        (new Set(r.categories).size !== r.categories.length ||
          (["none", "missing"].includes(r.status) &&
            (r.categories.length || r.note)) ||
          (r.status === "reviewed" && !r.categories.length && !r.note.trim()))
      )
        throw new Error(
          "Check the reviewed dietary category and instructions.",
        );
    }
    const summary = summarizeAttendeeDiets(rows);
    summary.active += reservedMeals;
    summary.missing += reservedMeals;
    const lines = [
      eventName,
      "Catering brief",
      "",
      "Meals: " + summary.active,
      "Reserved: " + reservedMeals,
      "No restrictions: " + summary.noRestrictions,
      "Missing information: " + summary.missing,
      "Needs review: " + summary.needsReview,
      "",
      ...dietRequirementsText(summary),
    ];
    return {
      ...summary,
      reservedMeals,
      artifact: artifact("catering-brief.txt", "text/plain", lines.join("\n")),
    };
  },
};
// The published schema permits additive extensions. Intake accepts only its
// named public fields so a private roster column cannot enter the export.
function publicFields(schema) {
  if (schema.type === "array")
    return { ...schema, items: publicFields(schema.items) };
  if (schema.type !== "object") return schema;
  return {
    ...schema,
    additionalProperties: false,
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [
        key,
        publicFields(child),
      ]),
    ),
  };
}
const feedInput = publicFields(
  obj(
    Object.fromEntries(
      Object.entries(feedSchema.properties).filter(
        ([key]) => !["schemaVersion", "revision"].includes(key),
      ),
    ),
    ["updatedAt", "event", "topics", "speakers", "sessions", "actions"],
  ),
);
const feedExample = {
  updatedAt: "2026-06-10T09:00:00Z",
  event: {
    id: "field-notes",
    name: headline,
    summary: "An exchange of field research.",
    url: "https://example.org/forum",
    startDate: "2026-06-20",
    timeZone: "Europe/Helsinki",
    venue: { name: "Assembly Hall", city: "Espoo", country: "FI" },
  },
  speakers: [{ id: "zoe", name: "Zoë Marin" }],
  topics: [
    { id: "fieldwork", label: "Fieldwork", summary: "Methods and practice" },
  ],
  sessions: [
    {
      id: "research",
      title: "Field research in practice",
      summary: null,
      contentStatus: "announced",
      url: "https://example.org/forum/research",
      speakerIds: ["zoe"],
      topicIds: ["fieldwork"],
    },
  ],
  actions: [],
};
const feed = {
  name: "programme_build_feed",
  description:
    "Validate event metadata, unique session and speaker references, then generate a versioned public JSON feed.",
  inputSchema: feedInput,
  example: feedExample,
  outputSchema: resultSchema(
    {
      feed: {
        type: "object",
        properties: feedSchema.properties,
        required: feedSchema.required,
      },
      artifact: "object",
    },
    ["feed", "artifact"],
  ),
  run(input) {
    validateProgramme(input);
    const dataset = { schemaVersion: 1, ...input };
    const revision = createHash("sha256")
      .update(JSON.stringify(dataset))
      .digest("hex");
    const result = { ...dataset, revision };
    return {
      feed: result,
      artifact: artifact(
        "event.json",
        "application/json",
        JSON.stringify(result, null, 2) + "\n",
      ),
    };
  },
};
const session = obj(
  {
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    title: text(),
    speakers: list(text(), 30),
    room: text(),
  },
  ["start", "title"],
);
const schedule = {
  name: "schedule_render",
  description:
    "Render a portable agenda or venue screen in the event's time zone and return a self-contained HTML file.",
  outputSchema: resultSchema({ entries: "array", artifact: "object" }, [
    "entries",
    "artifact",
  ]),
  inputSchema: obj(
    {
      eventName: text(),
      timeZone: text(),
      mode: select("agenda", "screen"),
      sessions: { ...list(session, 500), minItems: 1 },
    },
    ["eventName", "timeZone", "sessions"],
  ),
  example: {
    eventName: headline,
    timeZone: "Europe/Helsinki",
    mode: "agenda",
    sessions: [
      {
        start: "2026-06-20T09:00:00+03:00",
        title: "Registration",
        room: "Lobby",
      },
      {
        start: "2026-06-20T10:00:00+03:00",
        title: "Field research in practice",
        speakers: ["Zoë Marin"],
        room: "Assembly Hall",
      },
    ],
  },
  run({ eventName, timeZone, mode = "agenda", sessions }) {
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const entries = [...sessions]
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
      .map((row) => {
        if (row.end && Date.parse(row.end) < Date.parse(row.start))
          throw new Error("A session ends before it starts: " + row.title);
        return {
          ...row,
          displayTime:
            format.format(new Date(row.start)) +
            (row.end ? " – " + format.format(new Date(row.end)) : ""),
        };
      });
    const body = entries
      .map(
        (row) =>
          "<li><time>" +
          escape(row.displayTime) +
          "</time><div><strong>" +
          escape(row.title) +
          "</strong><p>" +
          [...(row.speakers ?? []), row.room]
            .filter(Boolean)
            .map(escape)
            .join(" · ") +
          "</p></div></li>",
      )
      .join("");
    const html =
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
      escape(eventName) +
      '</title><style>*{box-sizing:border-box}body{max-width:72rem;margin:auto;padding:4vw;color:#172d27;background:#f8f5eb;font:18px/1.45 sans-serif}h1{font:clamp(2.6rem,6vw,6rem)/1 Georgia,serif;margin:.5em 0}ol{padding:0;list-style:none}li{padding:1em 0;border-top:1px solid;display:grid;grid-template-columns:minmax(9em,28%) 1fr;gap:1em}p{margin:.25em 0}body.screen{color:white;background:#152e27;font-size:clamp(1.2rem,2.7vw,3rem)}@media(max-width:550px){li{display:block}}@media print{body{color:black!important;background:white!important}li{break-inside:avoid}}</style><body class="' +
      mode +
      '"><main><h1>' +
      escape(eventName) +
      "</h1><p>" +
      escape(timeZone) +
      "</p><ol>" +
      body +
      "</ol></main></body></html>";
    return { entries, artifact: artifact("schedule.html", "text/html", html) };
  },
};
const graphic = {
  name: "talk_graphics_export",
  description:
    "Generate a branded PNG with approved speaker and talk copy, optional portrait, and text fit checks.",
  outputSchema: resultSchema(
    { width: "integer", height: "integer", artifact: "object" },
    ["width", "height", "artifact"],
  ),
  inputSchema: obj(
    {
      eventName: text(100),
      title: text(300),
      speaker: text(160),
      caption: text(400),
      width: { type: "integer", minimum: 480, maximum: 2160 },
      height: { type: "integer", minimum: 480, maximum: 2160 },
      accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      portrait: {
        type: "string",
        maxLength: 5000000,
        pattern: "^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$",
      },
    },
    ["eventName", "title", "speaker"],
  ),
  example: {
    eventName: headline,
    title: "Field research in practice",
    speaker: "Zoë Marin",
    caption: "Lessons from a year of listening.",
    width: 1200,
    height: 630,
    accent: "#b5e9b0",
  },
  async run({
    eventName,
    title,
    speaker,
    caption = "",
    portrait,
    width = 1200,
    height = 630,
    accent = "#b5e9b0",
  }) {
    return withPrintPage(async (page) => {
      await page.setViewportSize({ width, height });
      const css =
        "body{background:#152b24;color:#fffbef;font-family:Print,sans-serif}main{padding:6vmin;display:grid;height:100vh;grid-template-rows:auto 1fr auto;gap:3vmin;border-top:2vmin solid " +
        accent +
        "}header,footer{font-size:4vmin}header{color:" +
        accent +
        "}section{display:flex;gap:5vmin;min-height:0;align-items:center}h1{font-size:9vmin;line-height:1.04;overflow-wrap:anywhere;margin:0 0 2vmin}p{font-size:4.3vmin;line-height:1.18;margin:0}img{width:28%;max-height:100%;object-fit:cover;border-radius:2px}";
      await page.addStyleTag({ content: css });
      await page
        .locator("body")
        .evaluate(
          (body, html) => (body.innerHTML = html),
          "<main><header>" +
            escape(eventName) +
            "</header><section><div><h1>" +
            escape(title) +
            "</h1><p>" +
            escape(caption) +
            "</p></div>" +
            (portrait ? '<img alt="" src="' + portrait + '">' : "") +
            "</section><footer>" +
            escape(speaker) +
            "</footer></main>",
        );
      const fits = await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
        const section = document
          .querySelector("section")
          .getBoundingClientRect();
        const title = document.querySelector("h1");
        for (let size = 9; size >= 4; size -= 0.25) {
          title.style.fontSize = size + "vmin";
          const text = title.parentNode.getBoundingClientRect();
          if (
            text.top >= section.top - 1 &&
            text.bottom <= section.bottom + 1 &&
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight
          )
            return true;
        }
        return false;
      });
      if (!fits)
        throw new Error(
          "Copy does not fit the graphic. Shorten it or increase the dimensions.",
        );
      return {
        width,
        height,
        artifact: {
          name: "talk-graphic.png",
          mimeType: "image/png",
          bytes: await page.screenshot({ type: "png" }),
        },
      };
    });
  },
};
export const blocks = [
  {
    id: "catering",
    title: "Catering brief",
    description: "Count meals and review combined dietary requirements.",
    operations: [cater],
  },
  {
    id: "programme-feed",
    title: "Programme feed",
    description: "Publish structured speaker and session data.",
    operations: [feed],
  },
  {
    id: "schedule",
    title: "Schedule display",
    description: "Create an agenda or a venue screen from timed sessions.",
    operations: [schedule],
  },
  {
    id: "talk-graphics",
    title: "Talk graphics",
    description: "Export branded speaker and session artwork.",
    operations: [graphic],
  },
];
