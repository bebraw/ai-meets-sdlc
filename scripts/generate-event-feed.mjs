import { readFile, writeFile, stat } from "node:fs/promises";
import { parse } from "parse5";
import seminar from "../site/data/seminar.json" with { type: "json" };
import schedule from "../site/data/schedule.json" with { type: "json" };
import speakers from "../site/data/speakers.json" with { type: "json" };
import schema from "../site/data/event.schema.json" with { type: "json" };
import {
  plainText,
  reviseFeed,
  sessionContent,
} from "../worker/event-feed-data.ts";
import {
  attr,
  elements,
  textContent,
  validateFeed,
} from "./event-feed-validation.mjs";

const origin = "https://www.sdlcai.org";
const home = elements(parse(await readFile("build/index.html", "utf8")));
const scheduleNodes = elements(
  parse(await readFile("build/schedule/index.html", "utf8")),
);
const description = home.find((node) => attr(node, "name") === "description");
const sourceFiles = [
  "site/data/seminar.json",
  "site/data/schedule.json",
  "site/data/speakers.json",
  "site/layouts/index.html",
  "site/layouts/checkout.html",
  "site/dataSources.ts",
  "site/components/ScheduleRow.html",
  "scripts/generate-event-feed.mjs",
  "worker/event-feed-data.ts",
];
const updatedAt = new Date(
  Math.max(
    ...(await Promise.all(
      sourceFiles.map(async (file) => (await stat(file)).mtimeMs),
    )),
  ),
).toISOString();
const topics = schedule.items
  .filter((item) => item.talks)
  .map((item) => ({
    id: item.id,
    label: plainText(item.title),
    summary: plainText(item.body),
  }));
const sessions = schedule.items.flatMap((item) =>
  (item.talks ?? []).map((talk) => {
    const title = scheduleNodes.find(
      (node) =>
        attr(node, "data-canonical-talk-id") === talk.id &&
        attr(node, "data-canonical-talk-title") !== undefined,
    );
    let destination = title;
    while (destination && !attr(destination, "id"))
      destination = destination.parentNode;
    if (!destination)
      throw new Error(`No published destination for ${talk.id}`);
    return {
      id: talk.id,
      ...sessionContent(talk.title, talk.abstract),
      url: `${origin}/schedule/#${attr(destination, "id")}`,
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
      name: plainText(speaker.name),
      summary: plainText(speaker.bio),
      url: new URL(attr(link, "href"), origin).href,
    };
  });
// Explicit public section only: never inspect protected slide or lecture material.
const tickets = home.find((node) => attr(node, "id") === "tickets");
const ticketLink = elements(tickets).find(
  (node) => node.tagName === "a" && attr(node, "href") === "/checkout/",
);
if (!ticketLink) throw new Error("Public registration link is missing");
const feed = await reviseFeed({
  schemaVersion: 1,
  revision: "",
  updatedAt,
  event: {
    id: "sdlcai-2026",
    name: seminar.name,
    summary: attr(description, "content"),
    url: `${origin}/`,
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
  actions: [
    {
      id: "registration",
      label: textContent(ticketLink),
      url: new URL(attr(ticketLink, "href"), origin).href,
      kind: "registration",
    },
  ],
});
await validateFeed(feed, schema, "build");
await writeFile("build/event.json", JSON.stringify(feed, null, 2) + "\n");
await writeFile(
  "build/event.schema.json",
  JSON.stringify(schema, null, 2) + "\n",
);
console.log(
  `Validated event feed: ${sessions.length} sessions, ${publicSpeakers.length} speakers`,
);
