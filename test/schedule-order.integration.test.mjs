import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "parse5";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("schedule saves are atomic, admin-only, and shared by public pages, slides, feed, and graphic versions", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const endpoint = `${origin}/api/admin/schedule`;
  const headers = {
    authorization: receiptAdmin,
    origin,
    "x-admin-action": "save-schedule-order",
  };
  const read = async () =>
    await (await worker.fetch(endpoint, { headers })).json();
  const save = (groups, revision, overrides = headers) =>
    worker.fetch(endpoint, {
      method: "PUT",
      headers: overrides,
      body: new URLSearchParams({
        groups: JSON.stringify(groups),
        revision: String(revision),
      }),
    });
  assert.equal((await worker.fetch(endpoint)).status, 401);
  const before = await read();
  const groups = structuredClone(before.groups);
  const academia = groups.find((group) => group.id === "views-from-academia");
  const morning = groups[0];
  const moved = academia.talkIds.pop();
  morning.talkIds.unshift(moved);
  morning.talkIds.reverse();
  assert.deepEqual((await read()).groups, before.groups);
  assert.equal(
    (
      await save(groups, before.revision, {
        authorization: receiptAdmin,
        origin,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await save(groups, before.revision, {
        ...headers,
        origin: "https://other.example",
      })
    ).status,
    403,
  );
  const missing = structuredClone(groups);
  missing[0].talkIds.pop();
  assert.equal((await save(missing, before.revision)).status, 400);
  const duplicate = structuredClone(groups);
  duplicate[0].talkIds.push(moved);
  assert.equal((await save(duplicate, before.revision)).status, 400);
  const unknown = structuredClone(groups);
  unknown[0].talkIds[0] = "unknown";
  assert.equal((await save(unknown, before.revision)).status, 400);
  assert.equal(
    (await save([...groups].reverse(), before.revision)).status,
    400,
  );
  const oldManifest = await (
    await worker.fetch(`${origin}/assets/social/speakers.json`)
  ).json();
  const saved = await save(groups, before.revision);
  assert.equal(saved.status, 200);
  const snapshot = await saved.json();
  assert.equal(snapshot.revision, before.revision + 1);
  assert.equal((await save(before.groups, before.revision)).status, 409);
  assert.deepEqual((await read()).groups, groups);

  for (const route of [
    "/",
    "/schedule/",
    "/slides/schedule/",
    "/slides/deck/",
    "/admin/slides/deck/",
    "/admin/slides/schedule/",
  ]) {
    const response = await worker.fetch(`${origin}${route}`, { headers });
    assert.equal(response.status, 200, route);
    assert.equal(
      response.headers.get("x-sdlcai-schedule-version"),
      String(snapshot.revision),
      route,
    );
    assert.match(response.headers.get("cache-control"), /no-store/, route);
    const nodes = walk(parse(await response.text()));
    for (const group of groups) {
      const container = nodes.find(
        (node) => attr(node, "data-schedule-group") === group.id,
      );
      assert.ok(container, `${route}: ${group.id}`);
      assert.deepEqual(
        walk(container)
          .map((node) => attr(node, "data-schedule-talk"))
          .filter(Boolean),
        group.talkIds,
        route,
      );
    }
    if (route.includes("deck")) {
      const slides = nodes.filter((node) => attr(node, "data-runtime-slide"));
      const ids = slides.map((node) => attr(node, "data-runtime-slide"));
      for (const group of groups) {
        const start = ids.indexOf(`session-${group.id}`);
        assert.deepEqual(
          ids.slice(start + 1, start + 1 + group.talkIds.length),
          group.talkIds.map((id) => `talk-${id}`),
        );
      }
      const talk = slides.find(
        (node) => attr(node, "data-runtime-slide") === `talk-${moved}`,
      );
      const content = JSON.stringify(talk, (key, value) =>
        key === "parentNode" ? undefined : value,
      );
      assert.match(content, /Industry perspectives/);
      assert.match(content, /09:00-10:30/);
    }
  }
  const feed = await (await worker.fetch(`${origin}/event.json`)).json();
  assert.deepEqual(
    feed.sessions.map(({ id }) => id),
    groups.flatMap((group) => group.talkIds),
  );
  assert.deepEqual(feed.sessions.find(({ id }) => id === moved).topicIds, [
    morning.id,
  ]);
  const newManifest = await (
    await worker.fetch(`${origin}/assets/social/speakers.json`)
  ).json();
  assert.notEqual(oldManifest.version, newManifest.version);
  const speakerPage = await worker.fetch(`${origin}/speakers/`);
  const speakerNodes = walk(parse(await speakerPage.text()));
  assert.equal(
    text(
      speakerNodes.find(
        (node) => attr(node, "data-talk-session-label") === moved,
      ),
    ),
    "Industry perspectives",
  );
  const library = await worker.fetch(`${origin}/slides/`);
  const libraryIds = walk(parse(await library.text()))
    .map((node) => attr(node, "data-runtime-slide"))
    .filter(Boolean);
  const start = libraryIds.indexOf(`session-${morning.id}`);
  assert.deepEqual(
    libraryIds.slice(start + 1, start + 1 + morning.talkIds.length),
    morning.talkIds.map((id) => `talk-${id}`),
  );

  // Empty sessions remain valid destinations on subsequent saves.
  const empty = structuredClone(groups);
  empty[0].talkIds.push(...empty[1].talkIds.splice(0));
  assert.equal((await save(empty, snapshot.revision)).status, 200);
  const emptyPage = await worker.fetch(`${origin}/schedule/`);
  assert.equal(emptyPage.headers.get("x-sdlcai-content-source"), "d1");
  await runSql("DELETE FROM schedule_order");
  assert.equal((await worker.fetch(endpoint, { headers })).status, 503);
  assert.equal((await worker.fetch(`${origin}/event.json`)).status, 503);
  const fallback = await worker.fetch(`${origin}/schedule/`);
  assert.equal(fallback.status, 200);
  assert.equal(
    fallback.headers.get("x-sdlcai-content-source"),
    "bundled-fallback",
  );
  assert.match(await fallback.text(), /Joongi Shin/);
});

function walk(node) {
  return [node, ...(node.childNodes ?? []).flatMap(walk)];
}
function attr(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}
function text(node) {
  return node.nodeName === "#text"
    ? node.value
    : (node.childNodes ?? []).map(text).join("");
}
