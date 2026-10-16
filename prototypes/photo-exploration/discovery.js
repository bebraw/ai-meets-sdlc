export const topics = [
  {
    id: "agents",
    label: "Agents & discovery",
    tags: ["agents", "agentic-delivery", "agentic-discovery"],
  },
  {
    id: "adoption",
    label: "AI adoption & leadership",
    tags: ["ai-adoption", "leadership"],
  },
  {
    id: "delivery",
    label: "Software delivery",
    tags: ["software-delivery", "software-engineering", "vibe-coding"],
  },
  {
    id: "ui",
    label: "Generative UI",
    tags: ["generative-ui", "user-interfaces"],
  },
  { id: "medical", label: "Medical AI", tags: ["medical-ai", "science"] },
  {
    id: "research",
    label: "Posters & research",
    tags: ["posters", "research-posters", "research"],
  },
  {
    id: "community",
    label: "People & conversations",
    tags: ["community", "conversation", "networking"],
  },
  {
    id: "production",
    label: "Behind the scenes",
    tags: [
      "production",
      "production-desk",
      "sound",
      "lighting",
      "audio-mixer",
      "equipment",
      "event-team",
    ],
  },
];

export function photoTalks(photo, catalog) {
  // Reviewed associations take precedence over timing. Programme context can
  // suggest a talk, but does not establish who is pictured.
  const ids = photo.relatedTalkIds?.length
    ? photo.relatedTalkIds
    : photo.eventContext?.relatedTalkIds || [];
  return catalog.talks.filter((talk) => ids.includes(talk.id));
}

export function programmeSpeakers(photo, catalog) {
  const ids = new Set(
    photoTalks(photo, catalog).flatMap((talk) => talk.speakerIds),
  );
  return catalog.speakers.filter((speaker) => ids.has(speaker.id));
}

export function photoTopics(photo) {
  const tags = new Set(photo.tags.map((tag) => tag.toLowerCase()));
  return topics.filter((topic) => topic.tags.some((tag) => tags.has(tag)));
}

function normalize(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

export function matchesDiscovery(photo, state, catalog) {
  const talks = photoTalks(photo, catalog);
  const speakers = programmeSpeakers(photo, catalog);
  if (
    state.speaker &&
    !speakers.some((speaker) => speaker.id === state.speaker)
  )
    return false;
  if (state.talk && !talks.some((talk) => talk.id === state.talk)) return false;
  if (
    state.topic &&
    !photoTopics(photo).some((topic) => topic.id === state.topic)
  )
    return false;
  const haystack = normalize(
    [
      photo.caption,
      photo.altText,
      photo.photographer,
      photo.eventContext?.title,
      ...photo.tags,
      ...talks.map((talk) => talk.title),
      ...speakers.map((speaker) => speaker.name),
      ...photoTopics(photo).map((topic) => topic.label),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return normalize(state.query || "")
    .trim()
    .split(/\s+/u)
    .every((word) => haystack.includes(word));
}
