import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "parse5";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import {
  parseVideoExportManifest,
  videoExportManifestPath,
} from "../site/scripts/video-export-contract.ts";

test("4K export snapshots follow the live deck and invalidate a later corrected talk", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;
  const read = async () => {
    const response = await worker.fetch(`${origin}${videoExportManifestPath}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return parseVideoExportManifest(await response.json());
  };
  const initial = await read();
  assert.equal(initial.assets.length, 22);
  assert.equal(initial.assets[0].filename, "01-event.png");
  const changedId = "talk-ohans-emmanuel-industry-perspective";
  const changed = initial.assets.find((asset) => asset.slideId === changedId);
  const unchanged = initial.assets.find(
    (asset) => asset.slideId === "talk-mo-khazali-industry-perspective",
  );
  const stable = await worker.fetch(`${origin}${changed.path}`, {
    redirect: "manual",
  });
  assert.equal(stable.status, 307);
  assert.equal(
    new URL(stable.headers.get("location")).searchParams.get("v"),
    changed.version,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${videoExportManifestPath}`, {
        method: "HEAD",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${videoExportManifestPath}`, {
        method: "POST",
      })
    ).status,
    405,
  );

  const correctedTitle =
    "The confirmed talk title: practical lessons for adopting artificial intelligence across the software development lifecycle";
  await runSql(
    `UPDATE canonical_speaker_content SET content_json = json_set(content_json, '$.talks[0].title', '${correctedTitle}'), content_version = content_version + 1 WHERE speaker_id = 'ohans-emmanuel';`,
  );
  const deck = parse(
    await (await worker.fetch(`${origin}/slides/deck/`)).text(),
  );
  const walk = (node) => [node, ...(node.childNodes ?? []).flatMap(walk)];
  const title = walk(deck).find(
    (node) =>
      node.tagName === "h1" &&
      node.attrs?.some(
        (attr) =>
          attr.name === "data-canonical-talk-id" &&
          attr.value === "ohans-emmanuel-industry-perspective",
      ),
  );
  assert.equal(
    title.attrs.find((attr) => attr.name === "class").value,
    "presentation-talk-title is-dense",
  );
  assert.equal(title.childNodes[0].value, correctedTitle);
  const updated = await read();
  assert.notEqual(updated.filename, initial.filename);
  assert.notEqual(
    updated.assets.find((asset) => asset.slideId === changedId).version,
    changed.version,
  );
  assert.equal(
    updated.assets.find((asset) => asset.slideId === unchanged.slideId).version,
    unchanged.version,
  );
  const stale = await worker.fetch(
    `${origin}${changed.path}?v=${changed.version}&snapshot=1`,
    { redirect: "manual" },
  );
  assert.equal(stale.status, 409);

  const scheduleResponse = await worker.fetch(`${origin}/api/admin/schedule`, {
    headers: { authorization: receiptAdmin },
  });
  const schedule = await scheduleResponse.json();
  schedule.groups[0].talkIds.reverse();
  const save = await worker.fetch(`${origin}/api/admin/schedule`, {
    method: "PUT",
    headers: {
      authorization: receiptAdmin,
      origin,
      "x-admin-action": "save-schedule-order",
    },
    body: new URLSearchParams({
      groups: JSON.stringify(schedule.groups),
      revision: String(schedule.revision),
    }),
  });
  assert.equal(save.status, 200);
  const reordered = await read();
  const sessionIndex = reordered.assets.findIndex(
    (asset) => asset.slideId === `session-${schedule.groups[0].id}`,
  );
  assert.deepEqual(
    reordered.assets
      .slice(
        sessionIndex + 1,
        sessionIndex + 1 + schedule.groups[0].talkIds.length,
      )
      .map((asset) => asset.slideId),
    schedule.groups[0].talkIds.map((id) => `talk-${id}`),
  );
  assert.notEqual(reordered.filename, updated.filename);
});
