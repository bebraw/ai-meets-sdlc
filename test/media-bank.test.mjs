import assert from "node:assert/strict";
import test from "node:test";
import sources from "../production/media-bank/sources.json" with { type: "json" };
import {
  correctedTimestamp,
  localTimestamp,
  findSimilarGroups,
  applyCuration,
  attribution,
} from "../scripts/media-bank/catalog.mjs";

test("Insta360 retains its recording-verified Finnish time and normalizes to UTC", () => {
  const source = sources.sources.find((item) => item.id === "insta360");
  assert.equal(source.clockShiftSeconds, 0);
  const result = correctedTimestamp("2026:10:13 13:58:21", source);
  assert.equal(result, "2026-10-13T10:58:21.000Z");
  assert.equal(localTimestamp(result), "2026-10-13 13:58:21");
  assert.equal(
    correctedTimestamp("2026:10:13 00:30:00", source),
    "2026-10-12T21:30:00.000Z",
  );
  assert.throws(() => correctedTimestamp("missing", source));
});

test("Fujifilm keeps its original Finnish clock time", () => {
  const result = correctedTimestamp("2026:10:13 08:14:17", {
    timezoneOffset: "+03:00",
    clockShiftSeconds: 0,
  });
  assert.equal(localTimestamp(result), "2026-10-13 08:14:17");
});

test("similar-frame suggestions stay within a camera and a short capture interval", () => {
  const photo = (
    id,
    seconds,
    sourceId = "fujifilm",
    differenceHash = "0000000000000000",
  ) => ({
    id,
    capturedAt: new Date(Date.UTC(2026, 9, 13, 10, 0, seconds)).toISOString(),
    sourceId,
    differenceHash,
  });
  const groups = findSimilarGroups([
    photo("a", 0),
    photo("b", 3),
    photo("c", 4, "insta360"),
    photo("d", 5, "fujifilm", "ffffffffffffffff"),
    photo("e", 180),
  ]);
  assert.deepEqual(
    groups.map((group) => group.photoIds),
    [["a", "b"]],
  );
  assert.equal(groups[0].reviewRequired, true);
});

test("talk association alone does not assign depicted people; downloads retain credit and license", () => {
  const inventory = {
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    photos: [
      { id: "a", filename: "example.jpg", photographer: "Bulent Sahin" },
    ],
  };
  const catalog = applyCuration(inventory, {
    photos: { a: { relatedTalkIds: ["a-talk"] } },
  });
  assert.deepEqual(catalog.photos[0].depictedSpeakerIds, []);
  const text = attribution(catalog.photos[0], catalog, "share");
  assert.match(text, /Photo: Bulent Sahin/);
  assert.match(text, /https:\/\/creativecommons.org\/licenses\/by\/4.0\//);
  assert.match(text, /Resized and re-encoded/);
  assert.equal(inventory.photos[0].relatedTalkIds, undefined);
});
