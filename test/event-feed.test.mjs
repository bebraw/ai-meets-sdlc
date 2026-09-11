import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import schema from "../site/data/event.schema.json" with { type: "json" };
import { validateFeed } from "../scripts/event-feed-validation.mjs";
import { plainText, sessionContent } from "../worker/event-feed-data.ts";
import {
  applyFeedContent,
  feedResponse,
  handleEventFeed,
} from "../worker/event-feed.ts";

const seed = JSON.parse(await readFile("build/event.json", "utf8"));

test("built feed resolves real fragments and excludes private content", async () => {
  await validateFeed(seed, schema, "build");
  assert.equal(seed.speakers.length, 9);
  assert.ok(
    !seed.speakers.some((speaker) => speaker.id === "juho-vepsalainen"),
  );
  assert.deepEqual(
    seed.actions.map((action) => action.url),
    ["https://www.sdlcai.org/checkout/"],
  );
  assert.equal(
    seed.sessions.find((session) => session.id === "agentic-discovery").summary,
    null,
  );
  assert.equal(
    seed.sessions.find((session) => session.id === "agentic-discovery")
      .contentStatus,
    "details-pending",
  );
  assert.ok(seed.sessions.every((session) => !("startDate" in session)));
});

test("validation rejects broken fragments, duplicate IDs, bad references and invalid schema", async () => {
  for (const mutate of [
    (feed) => {
      feed.sessions[0].url = "https://www.sdlcai.org/schedule/#missing";
    },
    (feed) => {
      feed.sessions.push(feed.sessions[0]);
    },
    (feed) => {
      feed.sessions[0].speakerIds = ["missing"];
    },
    (feed) => {
      feed.sessions[0].topicIds = ["missing"];
    },
    (feed) => {
      feed.sessions[0].summary = 42;
    },
    (feed) => {
      feed.updatedAt = "yesterday";
    },
    (feed) => {
      feed.actions[0].url = "http://example.com";
    },
  ]) {
    const feed = structuredClone(seed);
    mutate(feed);
    await assert.rejects(validateFeed(feed, schema, "build"));
  }
});

test("a changed destination is checked against the element, not HTTP success", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "event-feed-"));
  try {
    await mkdir(path.join(directory, "schedule"));
    await mkdir(path.join(directory, "speakers"));
    await mkdir(path.join(directory, "checkout"));
    for (const file of [
      "index.html",
      "schedule/index.html",
      "speakers/index.html",
      "checkout/index.html",
    ]) {
      await writeFile(
        path.join(directory, file),
        await readFile(path.join("build", file)),
      );
    }
    const feed = structuredClone(seed);
    const originalId = feed.sessions[0].id;
    const previousAnchor = new URL(feed.sessions[0].url).hash.slice(1);
    feed.sessions[0].title = "A new published title";
    feed.sessions[0].url = "https://www.sdlcai.org/schedule/#new-anchor";
    await assert.rejects(
      validateFeed(feed, schema, directory),
      /Missing fragment/,
    );
    const filename = path.join(directory, "schedule/index.html");
    await writeFile(
      filename,
      (await readFile(filename, "utf8")).replace(
        `id="${previousAnchor}"`,
        'id="new-anchor"',
      ),
    );
    await validateFeed(feed, schema, directory);
    assert.equal(feed.sessions[0].id, originalId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public canonical edits update the feed and revision without changing identity or anchors", async () => {
  const fixture = structuredClone(seed);
  fixture.updatedAt = "2026-09-08T10:00:00.000Z";
  const records = fixture.speakers.map((speaker) => ({
    speakerId: speaker.id,
    updatedAt: "2026-09-09T10:00:00Z",
    content: {
      profile: { name: speaker.name, bio: speaker.summary },
      talks: fixture.sessions
        .filter((session) => session.speakerIds.includes(speaker.id))
        .map((session) => ({
          id: session.id,
          title: session.title,
          abstract: session.summary ?? "Abstract forthcoming.",
        })),
    },
  }));
  const first = await applyFeedContent(fixture, records);
  records[0].content.profile.name = "Updated name";
  records[0].content.talks[0].title = "Updated title";
  records[0].content.talks[0].abstract =
    "A **confirmed** abstract with a [link](https://example.com).";
  const second = await applyFeedContent(fixture, records);
  assert.notEqual(first.revision, second.revision);
  assert.equal(second.speakers[0].name, "Updated name");
  assert.equal(second.sessions[0].title, "Updated title");
  assert.equal(second.sessions[0].summary, "A confirmed abstract with a link.");
  assert.equal(second.sessions[0].contentStatus, "announced");
  assert.equal(second.sessions[0].id, seed.sessions[0].id);
  assert.equal(second.sessions[0].url, seed.sessions[0].url);
  assert.equal(second.updatedAt, new Date(records[0].updatedAt).toISOString());
  assert.equal(
    (await applyFeedContent(fixture, records)).revision,
    second.revision,
  );
  fixture.updatedAt = "2026-09-10T10:00:00.000Z";
  assert.equal(
    (await applyFeedContent(fixture, records)).updatedAt,
    fixture.updatedAt,
  );
  await assert.rejects(applyFeedContent(fixture, []), /Missing published speaker/);
});

test("plain text and missing abstracts", () => {
  assert.equal(
    plainText("**Hello** &amp; [welcome](https://example.com)"),
    "Hello & welcome",
  );
  assert.equal(sessionContent("Title", "").summary, null);
});

test("cross-origin responses support validators and HEAD without cookies", async () => {
  for (const headers of [
    { Origin: "https://lecture.example" },
    { "If-None-Match": 'W/"abc", "other"' },
    { "If-None-Match": "*" },
  ]) {
    const response = feedResponse(
      new Request("https://www.sdlcai.org/event.json", { headers }),
      "{}",
      '"abc"',
    );
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(
      response.headers.get("content-type"),
      "application/json; charset=utf-8",
    );
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.equal(response.headers.get("etag"), '"abc"');
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.status, headers["If-None-Match"] ? 304 : 200);
  }
  assert.equal(
    await feedResponse(
      new Request("https://www.sdlcai.org/event.json", { method: "HEAD" }),
      "{}",
      '"abc"',
    ).text(),
    "",
  );
});

test("unavailable or malformed upstream data returns a noncacheable failure", async () => {
  for (const asset of [
    new Response("missing", { status: 404 }),
    new Response("not JSON"),
    Response.json(seed),
  ]) {
    const response = await handleEventFeed(
      new Request("https://www.sdlcai.org/event.json"),
      { ASSETS: { fetch: async () => asset } },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  }
});
