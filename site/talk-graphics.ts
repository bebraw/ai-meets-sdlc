// Build-time editorial data. Images and handoffs are copied only into /admin/.
import cards from "../production/talk-graphics/2026/cards.json" with { type: "json" };
import library from "../output/video-analysis/2026-10-22/content-library.json" with { type: "json" };
import speakers from "./data/speakers.json" with { type: "json" };

export const talkGraphicPresets = [
  { id: "landscape", label: "Landscape PNG", width: 1200, height: 630 },
  { id: "portrait", label: "Portrait PNG", width: 1080, height: 1350 },
];
export const talkGraphicPackUrl = "/admin/talk-previews/takeaway-graphics.zip";

function stamp(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, "0")}`;
}

export function getTalkGraphics() {
  const talks = library.items.filter((talk) => talk.kind === "talk");
  if (
    new Set(cards.cards.map((card) => card.id)).size !== talks.length ||
    cards.cards.length !== talks.length
  )
    throw new Error("Every talk needs one takeaway graphic");
  return cards.cards.map((card) => {
    const talk = talks.find((item) => item.id === card.id);
    const speaker = speakers.items.find((item) => item.id === card.speakerId);
    if (
      !talk?.talkUrl ||
      !speaker ||
      !talk.speakerNames.some((name) => name === speaker.name)
    )
      throw new Error(`Invalid graphic attribution: ${card.id}`);
    const slug = new URL(talk.talkUrl).hash.slice(1);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || card.points.length !== 3)
      throw new Error(`Invalid talk graphic: ${card.id}`);
    const points = card.points.map((point, index) => {
      const source = talk.takeaways[point.takeaway - 1];
      if (!source || !point.text.trim() || point.text.length > 115)
        throw new Error(`Invalid graphic takeaway: ${card.id}`);
      return {
        text: point.text,
        number: String(index + 1).padStart(2, "0"),
        sourceIndex: point.takeaway,
        sourceUrl: source.youtubeUrl,
        time: `${stamp(source.start)}–${stamp(source.end)}`,
      };
    });
    const alt = `${card.headline}. ${speaker.name} at SDLCAI 2026. Three paraphrased talk takeaways: ${points.map((point, i) => `${i + 1}. ${point.text}`).join(" ")} sdlcai.org`;
    const caption = `${card.headline}\n\nThree takeaways from ${speaker.name} at SDLCAI 2026:\n\n${points.map((point, i) => `${i + 1}. ${point.text}`).join("\n\n")}\n\nParaphrased from “${talk.officialTitle}”. Watch the full talk: ${talk.youtubeUrl}\n\n#SDLCAI`;
    const assets = talkGraphicPresets.map((preset) => ({
      ...preset,
      filename: `summary-${preset.id}.png`,
      src: `/admin/talk-previews/${slug}/summary-${preset.id}.png`,
      downloadLabel: `${preset.label} · ${preset.width} x ${preset.height}`,
    }));
    return {
      id: card.id,
      slug,
      headline: card.headline,
      speaker: speaker.name,
      photo: speaker.photo,
      photoPosition: card.photoPosition ?? "50% 24%",
      title: talk.officialTitle,
      youtubeUrl: talk.youtubeUrl,
      siteLabel: "sdlcai.org",
      points,
      alt,
      caption,
      assets,
      landscape: assets[0]!,
      portrait: assets[1]!,
      copyUrl: `/admin/talk-previews/${slug}/summary-copy.txt`,
      handoff: `EDITORIAL DRAFT — review wording and context before posting.\n\nPOST COPY\n${caption}\n\nALT TEXT\n${alt}\n\nSOURCE PASSAGES\n${points.map((point) => `${point.time} — ${point.sourceUrl}`).join("\n")}\n\nCONTEXT & QUALIFICATIONS\n${talk.editorialCaveats.map((note) => `- ${note}`).join("\n")}\n`,
    };
  });
}
