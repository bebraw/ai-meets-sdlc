import assert from "node:assert/strict";
import test from "node:test";
import { photoEventContext } from "../site/scripts/photo-context.ts";

const photo = (time, category = "talks", relatedTalkIds = []) => ({
  capturedAt: `2026-10-13T${time}+03:00`,
  category,
  relatedTalkIds,
});
test("the recorded running order handles session overruns and restored Insta360 time", () => {
  assert.equal(
    photoEventContext(
      photo("10:44:51", "talks", ["jenni-kylmakoski-industry-perspective"]),
    ).segmentId,
    "jenni-talk",
  );
  const sini = photoEventContext(
    photo("14:17:12", "talks", ["ai-factory-fundamentals"]),
  );
  assert.equal(sini.segmentId, "sini-talk");
  assert.equal(sini.association, "corroborated");
  assert.equal(sini.recordingOffsetSeconds, 19567);
  assert.equal(
    photoEventContext(photo("12:36:09", "behind-the-scenes")).segmentId,
    "research-panel",
  );
});
test("time-only programme context never identifies depicted people or tags off-stage photos", () => {
  const audience = photoEventContext(photo("10:36:19", "audience"), [
    {
      id: "jenni-kylmakoski-industry-perspective",
      speakerIds: ["jenni-kylmakoski"],
    },
  ]);
  assert.equal(audience.association, "timing-only");
  assert.deepEqual(audience.relatedTalkIds, [
    "jenni-kylmakoski-industry-perspective",
  ]);
  assert.equal(audience.depictedSpeakerIds, undefined);
  assert.deepEqual(audience.programmeSpeakerIds, ["jenni-kylmakoski"]);
  assert.deepEqual(
    photoEventContext(photo("10:36:19", "networking")).relatedTalkIds,
    [],
  );
});
test("reviewed stage context survives a short handover but larger disagreements remain explicit", () => {
  const talks = [
    "driving-ai-adoption-regulated-environment",
    "non-engineers-vibe-code-production",
    "ai-factory-fundamentals",
  ];
  const edge = photoEventContext(photo("15:00:47", "panels", talks));
  assert.equal(edge.segmentId, "industry-panel");
  assert.equal(edge.timedSegmentId, "afternoon-break");
  assert.equal(edge.association, "near-boundary");
  assert.equal(
    photoEventContext(photo("15:22:58", "talks", talks)).association,
    "conflict",
  );
});
test("registration, closing, group photos and afterparty retain their own event context", () => {
  for (const [time, segmentId] of [
    ["08:13:23", "registration"],
    ["17:05:08", "closing"],
    ["17:07:29", "group-photo"],
    ["18:03:25", "afterparty"],
  ])
    assert.equal(photoEventContext(photo(time, "venue")).segmentId, segmentId);
  assert.equal(
    photoEventContext(photo("18:03:25", "networking")).recordingOffsetSeconds,
    null,
  );
  assert.equal(
    photoEventContext({
      ...photo("08:00:00"),
      capturedAt: "2026-10-14T08:00:00+03:00",
    }),
    null,
  );
});
