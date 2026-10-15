import timeline from "../../production/media-bank/recording-timeline.json" with { type: "json" };

export interface PhotoEventContext {
  segmentId: string;
  timedSegmentId: string;
  sessionId: string;
  kind: string;
  title: string;
  startsAt: string;
  endsAt: string;
  recordingOffsetSeconds: number | null;
  relatedTalkIds: string[];
  programmeSpeakerIds: string[];
  association:
    | "corroborated"
    | "near-boundary"
    | "timing-only"
    | "review-only"
    | "conflict"
    | "none";
}

// Programme context never confirms a person or grants download access.
export function photoEventContext(
  photo: {
    capturedAt: string;
    category: string;
    relatedTalkIds: readonly string[];
  },
  talks: readonly { id: string; speakerIds: readonly string[] }[] = [],
): PhotoEventContext | null {
  const start = Date.parse(timeline.broadcastStartAt);
  const seconds = (Date.parse(photo.capturedAt) - start) / 1000;
  if (!Number.isFinite(seconds)) return null;
  let segment = timeline.segments.find(
    (item) => seconds >= item.startSeconds && seconds < item.endSeconds,
  );
  if (!segment) return null;
  const timedSegmentId = segment.id;
  const eligible = ["talks", "panels", "audience"].includes(photo.category);
  const reviewed = [...photo.relatedTalkIds];
  const contains = (ids: readonly string[]) =>
    reviewed.length > 0 && reviewed.every((id) => ids.includes(id));
  let association: PhotoEventContext["association"] = "none";
  let relatedTalkIds: string[] = [];
  if (reviewed.length) {
    relatedTalkIds = reviewed;
    if (contains(segment.talkIds)) association = "corroborated";
    else {
      const nearby = timeline.segments.find(
        (item) =>
          contains(item.talkIds) &&
          Math.min(
            Math.abs(seconds - item.startSeconds),
            Math.abs(seconds - item.endSeconds),
          ) <= timeline.boundaryToleranceSeconds,
      );
      if (nearby) {
        segment = nearby;
        association = "near-boundary";
      } else association = eligible ? "conflict" : "review-only";
    }
  } else if (eligible && segment.talkIds.length) {
    relatedTalkIds = [...segment.talkIds];
    association = "timing-only";
  }
  return {
    segmentId: segment.id,
    timedSegmentId,
    sessionId: segment.sessionId,
    kind: segment.kind,
    title: segment.title,
    startsAt: new Date(start + segment.startSeconds * 1000).toISOString(),
    endsAt: new Date(start + segment.endSeconds * 1000).toISOString(),
    recordingOffsetSeconds:
      seconds >= 0 && seconds <= timeline.durationSeconds
        ? Math.round(seconds)
        : null,
    relatedTalkIds,
    programmeSpeakerIds: [
      ...new Set(
        talks
          .filter((talk) => relatedTalkIds.includes(talk.id))
          .flatMap((talk) => [...talk.speakerIds]),
      ),
    ],
    association,
  };
}
