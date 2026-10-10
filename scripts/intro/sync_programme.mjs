import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "parse5";
import schema from "../../site/data/event.schema.json" with { type: "json" };
import { attr, elements, textContent } from "../event-feed-validation.mjs";

const sourceURL = "https://sdlcai.org/event.json";
const scheduleURL = "https://sdlcai.org/schedule/";
const destination = new URL(
  "../../production/intro/live-programme.json",
  import.meta.url,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueMap(items, label) {
  const map = new Map(items.map((item) => [item.id, item]));
  assert(map.size === items.length, `Duplicate ${label} ID`);
  return map;
}

export function validateLiveFeed(feed) {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  assert(ajv.validate(schema, feed), `Invalid event feed: ${ajv.errorsText()}`);
  assert(feed.event.id === "sdlcai-2026", "Unexpected event");
  assert(feed.sessions.length > 0, "Empty programme");
  const { revision, ...content } = feed;
  const digest = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  assert(revision === digest, "Event feed revision does not match content");
  uniqueMap(feed.sessions, "talk");
  uniqueMap(feed.speakers, "speaker");
  uniqueMap(feed.topics, "session");
  new Intl.DateTimeFormat("en", { timeZone: feed.event.timeZone });
}

export function buildProgramme(feed, html) {
  validateLiveFeed(feed);
  const speakers = uniqueMap(feed.speakers, "speaker");
  const topics = uniqueMap(feed.topics, "session");
  const groups = elements(parse(html)).filter(
    (node) =>
      attr(node, "data-schedule-group") !== undefined &&
      attr(node, "data-schedule-kind") === "web",
  );
  assert(
    groups.length === topics.size,
    "Schedule session count differs from feed",
  );
  const published = [];
  const seenGroups = new Set();
  for (const group of groups) {
    const sessionId = attr(group, "data-schedule-group");
    assert(
      !seenGroups.has(sessionId),
      `Duplicate schedule session ${sessionId}`,
    );
    seenGroups.add(sessionId);
    const topic = topics.get(sessionId);
    assert(topic, `Unknown schedule session ${sessionId}`);
    let container = group.parentNode;
    while (container && !attr(container, "id")?.startsWith("session-"))
      container = container.parentNode;
    assert(container, `Missing schedule container for ${sessionId}`);
    const nodes = elements(container);
    const heading = nodes.find((node) => node.tagName === "h3");
    const time = nodes.find((node) => node.tagName === "time");
    assert(
      heading && textContent(heading) === topic.label,
      `Session title mismatch for ${sessionId}`,
    );
    const match =
      time && /^(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/.exec(textContent(time));
    assert(match, `Missing session clock time for ${sessionId}`);
    for (const article of elements(group).filter(
      (node) => attr(node, "data-schedule-talk") !== undefined,
    )) {
      published.push({
        id: attr(article, "data-schedule-talk"),
        sessionId,
        sessionStart: match[1],
        nodes: elements(article),
      });
    }
  }
  assert(
    published.length === feed.sessions.length,
    "Schedule talk count differs from feed",
  );
  return feed.sessions.flatMap((talk, index) => {
    const row = published[index];
    assert(row.id === talk.id, `Schedule order differs at talk ${index + 1}`);
    assert(
      talk.topicIds.length === 1 && row.sessionId === talk.topicIds[0],
      `Session mismatch for ${talk.id}`,
    );
    assert(
      talk.contentStatus === "announced",
      `Talk is not announced: ${talk.id}`,
    );
    assert(talk.speakerIds.length > 0, `Missing speaker for ${talk.id}`);
    const title = row.nodes.find(
      (node) =>
        attr(node, "data-canonical-talk-id") === talk.id &&
        attr(node, "data-canonical-talk-title") !== undefined,
    );
    assert(
      title && textContent(title) === talk.title,
      `Talk title differs between feed and schedule: ${talk.id}`,
    );
    return talk.speakerIds.map((speakerId) => {
      const speaker = speakers.get(speakerId);
      assert(speaker, `Unknown speaker ${speakerId}`);
      const name = row.nodes.find(
        (node) =>
          attr(node, "data-canonical-speaker-id") === speakerId &&
          attr(node, "data-canonical-speaker-name") !== undefined,
      );
      const photo = row.nodes.find(
        (node) =>
          node.tagName === "img" &&
          attr(node, "data-canonical-speaker-id") === speakerId &&
          attr(node, "data-canonical-speaker-photo") !== undefined,
      );
      assert(
        name && textContent(name) === speaker.name,
        `Speaker name differs between feed and schedule: ${speakerId}`,
      );
      assert(
        photo && attr(photo, "src"),
        `Missing published portrait for ${speakerId}`,
      );
      const portrait = new URL(attr(photo, "src"), scheduleURL);
      assert(
        portrait.protocol === "https:" &&
          ["sdlcai.org", "www.sdlcai.org"].includes(portrait.hostname) &&
          !portrait.username &&
          !portrait.password,
        `Unexpected portrait URL for ${speakerId}`,
      );
      return {
        sessionId: row.sessionId,
        sessionTitle: topics.get(row.sessionId).label,
        sessionStart: row.sessionStart,
        speakerId,
        speakerName: speaker.name,
        talkTitle: talk.title,
        portraitUrl: portrait.href,
      };
    });
  });
}

async function fetchFresh(url, contentType) {
  const requestURL = new URL(url);
  requestURL.searchParams.set("intro-sync", randomUUID());
  const response = await fetch(requestURL, {
    headers: { "cache-control": "no-cache", accept: contentType },
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `Live source failed: ${url} (${response.status})`);
  assert(
    response.headers.get("content-type")?.includes(contentType),
    `Unexpected content type: ${url}`,
  );
  return contentType === "application/json" ? response.json() : response.text();
}

async function main() {
  const feed = await fetchFresh(sourceURL, "application/json");
  validateLiveFeed(feed);
  const html = await fetchFresh(scheduleURL, "text/html");
  const programme = buildProgramme(feed, html);
  // A mid-refresh edit must not create a mixed snapshot.
  const confirmed = await fetchFresh(sourceURL, "application/json");
  validateLiveFeed(confirmed);
  assert(
    confirmed.revision === feed.revision,
    "Live programme changed during refresh; retry",
  );
  const snapshot = {
    schemaVersion: 1,
    sourceURL,
    scheduleURL,
    retrievedAt: new Date().toISOString(),
    revision: feed.revision,
    updatedAt: feed.updatedAt,
    eventId: feed.event.id,
    eventDate: feed.event.startDate,
    timeZone: feed.event.timeZone,
    sessionStartFormat:
      "HH:mm in timeZone on eventDate; session start, not individual talk time",
    programme,
  };
  await mkdir(new URL(".", destination), { recursive: true });
  const temporary = new URL(
    `./live-programme.${randomUUID()}.tmp`,
    destination,
  );
  try {
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + "\n", {
      flag: "wx",
    });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(
    `Saved ${programme.length} speaker appearances in published schedule order to ${fileURLToPath(destination)}`,
  );
  console.log(
    `Live revision ${feed.revision}; content updated ${feed.updatedAt}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `Programme sync failed; existing snapshot was retained. ${error.message}`,
    );
    process.exitCode = 1;
  });
}
