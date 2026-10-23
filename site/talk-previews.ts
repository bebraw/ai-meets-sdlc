// Build-time only. These editorial drafts belong exclusively to protected admin routes.
import library from "../output/video-analysis/2026-10-22/content-library.json" with { type: "json" };
import { getTalkGraphics, talkGraphicPackUrl } from "./talk-graphics.ts";

const basePath = "/admin/talk-previews/";
const sourceTalks = library.items.filter((item) => item.kind === "talk");

function stamp(value: number): string {
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function sourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error(`Invalid talk source: ${value}`);
  return url.href;
}

function getTalkCards() {
  const graphics = new Map(
    getTalkGraphics().map((graphic) => [graphic.id, graphic]),
  );
  return sourceTalks.map((talk, index) => {
    if (!talk.talkUrl) throw new Error(`Missing programme link: ${talk.id}`);
    const programme = new URL(talk.talkUrl);
    const slug = programme.hash.slice(1);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new Error(`Invalid talk slug: ${talk.id}`);
    return {
      id: talk.id,
      slug,
      href: `${basePath}${slug}/`,
      publicHref: `/2026/talks/${slug}/`,
      number: String(index + 1).padStart(2, "0"),
      title: talk.officialTitle,
      speakers: talk.speakerNames.join(", "),
      duration: stamp(talk.durationSeconds),
      summary: talk.shortSummary,
      topics: talk.topics.map((label) => ({ label })),
      previewLabel: `Read preview: ${talk.officialTitle}`,
      graphic: graphics.get(talk.id)!,
    };
  });
}

export function getTalkPreviews() {
  const items = getTalkCards();
  if (new Set(items.map((item) => item.slug)).size !== items.length)
    throw new Error("Duplicate talk preview slugs");
  return {
    summary: `${items.length} talks · ${sourceTalks.reduce((total, talk) => total + talk.takeaways.length, 0)} timestamped key points`,
    items,
    graphicPackUrl: talkGraphicPackUrl,
  };
}

export function getTalkPreview(slug: string) {
  const cards = getTalkPreviews().items;
  const card = cards.find((item) => item.slug === slug);
  const talk = sourceTalks.find((item) => item.id === card?.id);
  if (!card || !talk) throw new Error(`Unknown talk preview: ${slug}`);

  const passage = (start: number, end: number, url: string) => {
    const link = new URL(sourceUrl(url));
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > talk.durationSeconds ||
      link.origin !== "https://www.youtube.com" ||
      link.pathname !== "/watch" ||
      link.searchParams.get("v") !== talk.youtubeId ||
      Number.parseInt(link.searchParams.get("t") ?? "0", 10) !==
        Math.floor(start)
    )
      throw new Error(`Invalid talk preview passage: ${talk.id}`);
    return link.href;
  };
  const themes = library.synthesis.themes.filter((theme) =>
    theme.evidence.some((evidence) => evidence.videoId === talk.id),
  );
  const related = cards
    .filter((candidate) => candidate.id !== talk.id)
    .map((candidate) => ({
      ...candidate,
      sharedThemes: themes
        .filter((theme) =>
          theme.evidence.some((evidence) => evidence.videoId === candidate.id),
        )
        .map((theme) => theme.title),
    }))
    .filter((candidate) => candidate.sharedThemes.length)
    .sort((a, b) => b.sharedThemes.length - a.sharedThemes.length)
    .slice(0, 3)
    .map((candidate) => ({
      ...candidate,
      connection: candidate.sharedThemes[0],
    }));
  const qa = library.items.find(
    (item) =>
      item.kind === "qa" &&
      talk.speakerNames.every((speaker) =>
        item.speakerNames.some((participant) => participant === speaker),
      ),
  );

  return {
    ...card,
    pageTitle: `${talk.officialTitle} — Editorial preview`,
    url: `https://sdlcai.org${card.href}`,
    youtubeUrl: sourceUrl(talk.youtubeUrl),
    programmeUrl: sourceUrl(talk.talkUrl!),
    synopsis: talk.longSummary,
    inventoryUrl: `/admin/content-inventory/#${talk.id}`,
    keyPoints: talk.takeaways.map((point, index) => ({
      number: String(index + 1).padStart(2, "0"),
      point: point.point,
      timeRange: `${stamp(point.start)}–${stamp(point.end)}`,
      url: passage(point.start, point.end, point.youtubeUrl),
      sourceLabel: `Watch source passage ${stamp(point.start)}–${stamp(point.end)}`,
    })),
    chapters: talk.chapters.map((chapter, index) => ({
      title: chapter.title,
      time: stamp(chapter.outputSeconds),
      url: passage(
        chapter.outputSeconds,
        talk.chapters[index + 1]?.outputSeconds ?? talk.durationSeconds,
        chapter.youtubeUrl,
      ),
    })),
    qualifications: talk.editorialCaveats.map((text) => ({ text })),
    qa: qa
      ? { title: qa.officialTitle, url: sourceUrl(qa.youtubeUrl) }
      : undefined,
    related,
  };
}
