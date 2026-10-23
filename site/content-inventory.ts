// Build-time only: editorial candidates are rendered into the protected admin HTML.
import library from "../output/video-analysis/2026-10-22/content-library.json" with { type: "json" };
import release from "../production/video-release/2026-10-22/release.json" with { type: "json" };
import plan from "../production/content-inventory/2026/plan.json" with { type: "json" };

interface InventoryItem {
  id: string;
  kind: string;
  kindLabel: string;
  status: "published" | "review" | "draft";
  statusLabel: string;
  title: string;
  context: string;
  summary: string;
  people: string[];
  topics: string[];
  notes: string[];
  links: { label: string; url: string }[];
}

function stamp(value: number): string {
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function getContentInventory() {
  const videos = new Map(library.items.map((item) => [item.id, item]));
  const sessionLabels: Record<string, string> = {
    "research-panel": "Research Q&A",
    "industry-panel": "Industry Q&A",
    "final-panel": "Final Q&A",
  };
  const evidenceLinks = (
    evidence: { videoId: string; start: number; end: number }[],
  ) =>
    evidence.map((e) => {
      const video = videos.get(e.videoId);
      if (
        !video ||
        e.start < 0 ||
        e.end > video.durationSeconds ||
        e.end <= e.start
      )
        throw new Error(`Invalid inventory evidence: ${e.videoId}`);
      return {
        label: `${sessionLabels[video.id] ?? (video.speakerNames.join(", ") || video.officialTitle)} · ${stamp(e.start)}–${stamp(e.end)}`,
        url: `${video.youtubeUrl}&t=${Math.floor(e.start)}s`,
      };
    });
  const items: InventoryItem[] = [];
  for (const video of library.items) {
    const people = video.speakerNames.length ? video.speakerNames : ["SDLCAI"];
    items.push({
      id: video.id,
      kind: "video",
      kindLabel:
        video.kind === "qa"
          ? "Q&A recording"
          : video.kind === "mood"
            ? "Event highlights"
            : "Talk recording",
      status: "published",
      statusLabel: "Published source",
      title: video.officialTitle,
      context: `${people.join(", ")} · ${stamp(video.durationSeconds)}`,
      summary: video.shortSummary,
      people,
      topics: video.topics,
      notes: [video.longSummary, ...video.editorialCaveats],
      links: [
        { label: "Watch full video", url: video.youtubeUrl },
        ...(video.talkUrl
          ? [{ label: "Programme & materials", url: video.talkUrl }]
          : []),
      ],
    });
    for (const clip of video.clipCandidates) {
      items.push({
        id: clip.id,
        kind: "clip",
        kindLabel: "Clip candidate",
        status: "review",
        statusLabel: "Needs viewing & edit",
        title: clip.title,
        context: `${people.join(", ")} · ${clip.startTimecode}–${clip.endTimecode} · ${Math.round(clip.durationSeconds)}s`,
        summary: clip.why,
        people,
        topics: video.topics,
        notes: [
          `Audience: ${clip.audience}`,
          "Watch and listen to the full range. Confirm context, attribution and cut boundaries before rendering or publishing.",
        ],
        links: [
          { label: `Watch from ${clip.startTimecode}`, url: clip.youtubeUrl },
          { label: "Full source video", url: video.youtubeUrl },
        ],
      });
    }
    for (const quote of video.quoteCandidates) {
      const notes = [
        quote.verificationNote,
        quote.quotationStyle,
        `Context: ${quote.captionContext}`,
      ];
      if (quote.id === "final-panel-q01")
        notes.unshift(
          "Use the final Q&A session label. The individual speaker is unconfirmed.",
        );
      items.push({
        id: quote.id,
        kind: "quote",
        kindLabel: "Quote candidate",
        status: "review",
        statusLabel: "Needs editorial review",
        title: `“${quote.text}”`,
        context: `${quote.speaker} · ${quote.startTimecode}–${quote.endTimecode}`,
        summary:
          "Listen in context before using this wording in an article, caption or LinkedIn post.",
        people,
        topics: video.topics,
        notes,
        links: [
          {
            label: `Listen from ${quote.startTimecode}`,
            url: quote.youtubeUrl,
          },
          ...("originalContext" in quote && quote.originalContext
            ? [
                {
                  label: "Original spoken passage",
                  url: quote.originalContext.youtubeUrl,
                },
              ]
            : []),
        ],
      });
    }
  }
  for (const poster of plan.posters) {
    items.push({
      id: poster.id,
      kind: "poster",
      kindLabel: "Research poster",
      status: "published",
      statusLabel: "Published source",
      title: poster.title,
      context: poster.people.join(", "),
      summary: poster.summary,
      people: poster.people,
      topics: ["research", "poster"],
      notes: [],
      links: [
        {
          label: "Poster archive entry",
          url: `https://sdlcai.org/2026/posters/#${poster.id}`,
        },
        {
          label: "Original PDF",
          url: `https://sdlcai.org/assets/posters/2026/${poster.id}.pdf`,
        },
        ...("repository" in poster
          ? [{ label: "Code & experiments", url: poster.repository }]
          : []),
      ],
    });
  }
  for (const theme of library.synthesis.themes) {
    items.push({
      id: `theme-${theme.id}`,
      kind: "theme",
      kindLabel: "Cross-session theme",
      status: "draft",
      statusLabel: "Editorial synthesis",
      title: theme.title,
      context: "Examples across the seminar",
      summary: theme.finding,
      people: [
        ...new Set(
          theme.evidence.flatMap(
            (e) => videos.get(e.videoId)?.speakerNames ?? [],
          ),
        ),
      ],
      topics: [theme.title],
      notes: [
        theme.reuseImplication,
        "Develop this as seminar synthesis with named examples and their qualifications.",
      ],
      links: evidenceLinks(theme.evidence),
    });
  }
  for (const angle of plan.series) {
    items.push({
      id: angle.id,
      kind: "series",
      kindLabel: "Article & LinkedIn angle",
      status: "draft",
      statusLabel: "Positioning draft",
      title: angle.title,
      context: plan.audience,
      summary: angle.summary,
      people: [
        ...new Set(
          angle.evidence.flatMap(
            (e) => videos.get(e.videoId)?.speakerNames ?? [],
          ),
        ),
      ],
      topics: [angle.question],
      notes: [
        `Editorial question: ${angle.question}`,
        `LinkedIn opening: ${angle.linkedinAngle}`,
        angle.qualification,
        "Draft positioning for Juho to edit before writing or publication.",
      ],
      links: evidenceLinks(angle.evidence),
    });
  }
  const ids = new Set(items.map((item) => item.id));
  if (
    ids.size !== items.length ||
    plan.starterShortlist.some((id) => !ids.has(id))
  )
    throw new Error("Invalid inventory IDs or starter shortlist");
  const count = (kind: string) =>
    items.filter((item) => item.kind === kind).length;
  const closedOn = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${release.closeout.closedOn}T00:00:00Z`));
  return {
    audience: plan.audience,
    positioning: plan.positioning,
    linkedinApproach: plan.linkedinApproach,
    releaseSummary: `${release.items.length} videos published · Release closed ${closedOn}`,
    summary: `${items.length} items · ${count("video")} videos · ${count("clip")} clips · ${count("quote")} quotes · ${count("poster")} posters · ${count("theme")} themes · ${count("series")} series angles`,
    people: [...new Set(items.flatMap((item) => item.people))]
      .sort()
      .map((name) => ({ name })),
    starter: plan.starterShortlist.join(" "),
    items: items.map((item) => ({
      ...item,
      peopleFilter: item.people.join("|"),
      headingId: `${item.id}-heading`,
      pickTextId: `${item.id}-pick-label`,
      pickLabelledBy: `${item.id}-pick-label ${item.id}-heading`,
    })),
  };
}
