// Build-time publication boundary: explicitly select the public companion content.
import { getTalkPreviews, getTalkPreview } from "./talk-previews.ts";
import manifest from "../production/talk-graphics/2026/manifest.json" with { type: "json" };

export const publishedTalkBase = "/2026/talks/";
export const publishedGraphicPackUrl = `${publishedTalkBase}takeaway-graphics.zip`;
const publishedTime = "2026-10-23T12:00:00+03:00";
const context: Record<string, string[]> = {
  "mo-talk": [
    "The internal pilot comparison is observational; it does not isolate the effects of AI from changes to the delivery process.",
  ],
  "ohans-talk": [
    "These practices describe the speaker’s team experience. Pairing models and using a separate QA agent add scrutiny, without establishing independent failure modes. Read-only infrastructure access still requires controls over data disclosure.",
  ],
  "jenni-talk": [],
  "tapio-talk": [
    "The healthcare examples are exploratory work in progress and imagined process alternatives, rather than demonstrated clinical outcomes.",
  ],
  "joongi-talk": [
    "The findings concern perceptions in the described study. Associations between generation effort and later usability perceptions do not establish causation or a universally best interaction method.",
  ],
  "jussi-talk": [
    "This account reflects Elisa’s operating context at the October 2026 event. Security depends on how components and data flows work together, as well as on the individual tools.",
  ],
  "viljami-talk": [
    "Contribution counts do not establish a delivery-speed improvement; the speaker explicitly says strong speed data is not yet available. The attempted production deployment was detected and stopped.",
  ],
  "sini-talk": [
    "The delivery-address scenario illustrates a proposed flow of controls; it is not an observed customer case.",
  ],
  "zak-talk": [
    "At the event, the proposed hearing model was presented as a preprint under review, with an intention to seek regulatory qualification. This research status does not imply completed peer review or regulatory approval.",
  ],
  "waseem-talk": [],
};

function publicCard(card: ReturnType<typeof getTalkPreviews>["items"][number]) {
  if (!Object.hasOwn(context, card.id))
    throw new Error(`Talk not selected for publication: ${card.id}`);
  const graphic = card.graphic;
  const href = `${publishedTalkBase}${card.slug}/`;
  const assets = graphic.assets.map(
    ({ id, label, width, height, filename, downloadLabel }) => {
      const exported = manifest.assets.find(
        (asset) => asset.filename === `${card.id}-${id}.png`,
      );
      if (!exported)
        throw new Error(`Missing published talk graphic: ${card.id}-${id}`);
      return {
        id,
        label,
        width,
        height,
        filename,
        downloadLabel,
        src: `${href}${filename}?v=${exported.sha256.slice(0, 12)}`,
      };
    },
  );
  const notes = context[card.id]!;
  const copy = `POST COPY\n${graphic.caption}\n\nALT TEXT\n${graphic.alt}\n\nTALK SUMMARY\nhttps://sdlcai.org${href}\n\nSOURCE PASSAGES\n${graphic.points.map((point) => `${point.time} — ${point.sourceUrl}`).join("\n")}\n${notes.length ? `\nCONTEXT\n${notes.map((note) => `- ${note}`).join("\n")}\n` : ""}`;
  return {
    id: card.id,
    slug: card.slug,
    href,
    number: card.number,
    title: card.title,
    speakers: card.speakers,
    duration: card.duration,
    summary: card.summary,
    topics: card.topics,
    previewLabel: `Read summary: ${card.title}`,
    graphic: {
      headline: graphic.headline,
      alt: graphic.alt,
      caption: graphic.caption,
      assets,
      landscape: assets[0]!,
      portrait: assets[1]!,
      copyUrl: `${href}summary-copy.txt`,
      copy,
    },
  };
}

export function getPublishedTalks() {
  const previews = getTalkPreviews();
  return {
    summary: previews.summary,
    items: previews.items.map(publicCard),
    graphicPackUrl: publishedGraphicPackUrl,
  };
}

export function getPublishedTalk(slug: string) {
  const preview = getTalkPreview(slug);
  const card = publicCard(preview);
  const notes = context[card.id]!.map((text) => ({ text }));
  return {
    ...card,
    pageTitle: `${card.title} — SDLCAI 2026`,
    url: `https://sdlcai.org${card.href}`,
    ogImage: `https://sdlcai.org${card.graphic.landscape.src}`,
    publishedTime,
    youtubeUrl: preview.youtubeUrl,
    programmeUrl: preview.programmeUrl,
    synopsis:
      preview.id === "zak-talk"
        ? preview.synopsis.replace(
            "that regulatory qualification has been sought",
            "discusses an intention to seek regulatory qualification",
          )
        : preview.synopsis,
    keyPoints: preview.keyPoints,
    chapters: preview.chapters,
    context: notes,
    hasContext: notes.length > 0,
    qa: preview.qa,
    related: preview.related.map((related) => ({
      ...publicCard(related),
      connection: related.connection,
    })),
  };
}
