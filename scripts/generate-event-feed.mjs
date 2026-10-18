import { readFile, writeFile } from "node:fs/promises";
import { parse } from "parse5";
import seminar from "../site/data/seminar.json" with { type: "json" };
import schedule from "../site/data/schedule.json" with { type: "json" };
import speakers from "../site/data/speakers.json" with { type: "json" };
import schema from "../site/data/event.schema.json" with { type: "json" };
import { formatSpeakerName } from "../site/scripts/speaker-name.ts";
import {
  plainText,
  reviseFeed,
  sessionContent,
} from "../worker/event-feed-data.ts";
import { attr, elements, validateFeed } from "./event-feed-validation.mjs";
import { sourceUpdatedAt } from "./source-updated-at.mjs";

const origin = "https://www.sdlcai.org";
const home = elements(parse(await readFile("build/2026/index.html", "utf8")));
const scheduleNodes = elements(
  parse(await readFile("build/2026/schedule/index.html", "utf8")),
);
const description = home.find((node) => attr(node, "name") === "description");
const sourceFiles = [
  "site/data/seminar.json",
  "site/data/schedule.json",
  "site/data/speakers.json",
  "site/layouts/archive-2026.html",
  "site/dataSources.ts",
  "site/components/ScheduleRow.html",
  "scripts/generate-event-feed.mjs",
  "scripts/source-updated-at.mjs",
  "worker/event-feed-data.ts",
  "site/scripts/speaker-name.ts",
];
const updatedAt = await sourceUpdatedAt(sourceFiles);
const topics = schedule.items
  .filter((item) => item.talks)
  .map((item) => ({
    id: item.id,
    label: plainText(item.title),
    summary: plainText(item.body),
  }));
const sessions = schedule.items.flatMap((item) =>
  (item.talks ?? []).map((talk) => {
    const destination = scheduleNodes.find(
      (node) =>
        attr(node, "data-schedule-talk") === talk.id &&
        attr(node, "id") === talk.id,
    );
    if (!destination)
      throw new Error(`No published destination for ${talk.id}`);
    return {
      id: talk.id,
      ...sessionContent(talk.title, talk.abstract),
      url: `${origin}/2026/schedule/#${attr(destination, "id")}`,
      speakerIds: talk.speakers,
      topicIds: [item.id],
    };
  }),
);
const publicSpeakers = speakers.items
  .filter((speaker) => !speaker.workspaceOnly)
  .map((speaker) => {
    const link = scheduleNodes.find(
      (node) =>
        node.tagName === "a" &&
        attr(node, "data-canonical-speaker-id") === speaker.id,
    );
    if (!link)
      throw new Error(`No published speaker destination for ${speaker.id}`);
    return {
      id: speaker.id,
      name: plainText(formatSpeakerName(speaker)),
      summary: plainText(speaker.bio),
      url: new URL(attr(link, "href"), origin).href,
    };
  });
const feed = await reviseFeed({
  schemaVersion: 1,
  revision: "",
  updatedAt,
  event: {
    id: "sdlcai-2026",
    name: seminar.name,
    summary: attr(description, "content"),
    url: `${origin}/2026/`,
    startDate: seminar.date.iso,
    timeZone: "Europe/Helsinki",
    venue: {
      name: seminar.venue.name,
      city: seminar.location.city,
      country: seminar.location.country,
    },
  },
  topics,
  speakers: publicSpeakers,
  sessions,
  actions: [],
});
await validateFeed(feed, schema, "build");
await writeFile("build/event.json", JSON.stringify(feed, null, 2) + "\n");
await writeFile("build/2026/event.json", JSON.stringify(feed, null, 2) + "\n");
await writeFile(
  "build/event.schema.json",
  JSON.stringify(schema, null, 2) + "\n",
);
await writeFile(
  "build/2026/event.schema.json",
  JSON.stringify(schema, null, 2) + "\n",
);
console.log(
  `Validated event feed: ${sessions.length} sessions, ${publicSpeakers.length} speakers`,
);
