import { strictJsonObject } from "../json-object.mjs";
import * as v from "valibot";
import { defineOperation, type InternalBlock } from "../contracts.mjs";
import { text, integer, list, color } from "./supplied-fields.mjs";
import {
  buildProgrammeFeed,
  feedExample,
  feedInput,
  timestamp,
} from "./programme-feed.mjs";
export type { ProgrammeInput } from "./programme-feed.mjs";
import feedSchema from "./event-feed.schema.json" with { type: "json" };
import {
  fitTalkArtwork,
  renderSchedule,
  renderTalkArtwork,
} from "./programme-render.mjs";
import { resultSchema } from "../result-schema.mjs";
import { dietCategories, prepareCateringBrief } from "./diets.mjs";
import { withPrintPage } from "./print-browser.mjs";

const artifact = (name: string, mimeType: string, body: string) => ({
  name,
  mimeType,
  bytes: Buffer.from(body),
});
const headline = "Field Notes Forum";
const review = strictJsonObject({
  status: v.picklist(["reviewed", "clarify", "none", "missing"]),
  categories: list(
    v.picklist(dietCategories.map((c) => c.id)),
    dietCategories.length,
  ),
  note: v.optional(text(2000, 0)),
});
const cater = defineOperation({
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
  schema: strictJsonObject({
    eventName: text(240),
    people: list(
      strictJsonObject({
        status: v.optional(v.picklist(["active", "cancelled"])),
        diet: v.optional(text(2000, 0)),
        review: v.optional(review),
      }),
      2000,
    ),
    reservedMeals: v.optional(integer(0, 10000)),
  }),
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
    const { summary, text } = prepareCateringBrief(
      eventName,
      rows,
      reservedMeals,
    );
    return {
      ...summary,
      reservedMeals,
      artifact: artifact("catering-brief.txt", "text/plain", text),
    };
  },
});
const feed = defineOperation({
  name: "programme_build_feed",
  description:
    "Validate event metadata, unique session and speaker references, then generate a versioned public JSON feed.",
  schema: feedInput,
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
  async run(input) {
    const result = await buildProgrammeFeed(input);
    return {
      feed: result,
      artifact: artifact(
        "event.json",
        "application/json",
        JSON.stringify(result, null, 2) + "\n",
      ),
    };
  },
});
const session = strictJsonObject({
  start: timestamp,
  end: v.optional(timestamp),
  title: text(240),
  speakers: v.optional(list(text(240), 30)),
  room: v.optional(text(240)),
});
const schedule = defineOperation({
  name: "schedule_render",
  description:
    "Render a portable agenda or venue screen in the event's time zone and return a self-contained HTML file.",
  outputSchema: resultSchema({ entries: "array", artifact: "object" }, [
    "entries",
    "artifact",
  ]),
  schema: strictJsonObject({
    eventName: text(240),
    timeZone: text(240),
    mode: v.optional(v.picklist(["agenda", "screen"])),
    sessions: list(session, 500, 1),
  }),
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
  run(input) {
    const { entries, html } = renderSchedule(input);
    return { entries, artifact: artifact("schedule.html", "text/html", html) };
  },
});
const graphic = defineOperation({
  name: "talk_graphics_export",
  description:
    "Generate a branded PNG with approved speaker and talk copy, optional portrait, and text fit checks.",
  outputSchema: resultSchema(
    { width: "integer", height: "integer", artifact: "object" },
    ["width", "height", "artifact"],
  ),
  schema: strictJsonObject({
    eventName: text(100),
    title: text(300),
    speaker: text(160),
    caption: v.optional(text(400)),
    width: v.optional(integer(480, 2160)),
    height: v.optional(integer(480, 2160)),
    accent: v.optional(color),
    portrait: v.optional(
      v.pipe(
        v.string(),
        v.maxCodePoints(5000000),
        v.regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
      ),
    ),
  }),
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
      const { css, html } = renderTalkArtwork({
        eventName,
        title,
        speaker,
        caption,
        portrait,
        accent,
      });
      await page.addStyleTag({ content: css });
      await page.locator("body").evaluate((body, markup) => {
        body.innerHTML = markup;
      }, html);
      const fits = await page.evaluate(fitTalkArtwork, undefined);
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
});
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
] satisfies InternalBlock[];
