import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { raw } from "gustwind/htmlisp";
import { Renderer, marked } from "marked";
import schedule from "./data/schedule.json" with { type: "json" };
import seminarData from "./data/seminar.json" with { type: "json" };
import speakersData from "./data/speakers.json" with { type: "json" };

function init() {
  const announcementItems = getAnnouncementItems();
  const announcementItemsBySlug = getAnnouncementItemsBySlug(announcementItems);
  const speakersById = getSpeakersById();
  const scheduleItems = getScheduleItems(speakersById);
  const seminar = getSeminar();

  return {
    announcementFeed: () => ({
      title: "SDLCAI Announcements",
      description: "Official SDLCAI announcements and event updates.",
      url: "https://sdlcai.org/announcements/",
      feedUrl: "https://sdlcai.org/atom.xml",
      updated: announcementItems[0]?.modifiedTime ?? new Date().toISOString(),
      items: announcementItems,
    }),
    announcementItems: () => announcementItems,
    announcementItem: (match) =>
      getAnnouncementItem(announcementItemsBySlug, match.slug),
    seminar: () => seminar,
    scheduleItems: () => scheduleItems,
    speakerItems: () =>
      scheduleItems.flatMap((item) =>
        (item.talks ?? []).flatMap((talk) =>
          talk.speakers.map((speaker) => {
            const speakerAnchor = getSpeakerAnchor(speaker.name);

            return {
              ...speaker,
              anchor: speakerAnchor,
              anchorHref: `#${speakerAnchor}`,
              speakerHref: `/speakers/#${speakerAnchor}`,
              sessionAnchor: item.anchor,
              scheduleHref: item.scheduleHref,
              sessionTitle: item.title,
              talk: {
                title: talk.title,
                abstract: talk.abstract,
              },
            };
          }),
        ),
      ),
  };
}

function getAnnouncementItems() {
  return readdirSync("site/announcements")
    .filter((fileName) => fileName.endsWith(".md"))
    .map((fileName) => {
      const slug = path.basename(fileName, ".md");
      const source = readFileSync(
        path.join("site/announcements", fileName),
        "utf8",
      );
      const { frontMatter, markdown } = parseMarkdownPost(source, fileName);

      return {
        slug,
        title: frontMatter.title,
        subtitle: frontMatter.subtitle,
        summary: frontMatter.summary,
        date: {
          iso: frontMatter.date,
          display: formatDisplayDate(frontMatter.date),
          time: `${frontMatter.date}T00:00:00+03:00`,
        },
        updated: frontMatter.updated
          ? {
              iso: frontMatter.updated,
              display: formatDisplayDate(frontMatter.updated),
              time: `${frontMatter.updated}T00:00:00+03:00`,
            }
          : undefined,
        modifiedTime: frontMatter.updated
          ? `${frontMatter.updated}T00:00:00+03:00`
          : `${frontMatter.date}T00:00:00+03:00`,
        author: frontMatter.author,
        eyebrow: frontMatter.eyebrow,
        bodyHtml: raw(renderMarkdown(markdown)),
        href: `/announcements/${slug}/`,
        url: `https://sdlcai.org/announcements/${slug}/`,
      };
    })
    .sort((a, b) => b.date.iso.localeCompare(a.date.iso));
}

function getAnnouncementItemsBySlug(announcementItems) {
  return new Map(announcementItems.map((item) => [item.slug, item]));
}

function getAnnouncementItem(announcementItemsBySlug, slug) {
  const item = announcementItemsBySlug.get(slug);

  if (!item) {
    throw new Error(`Unknown announcement slug: ${slug}`);
  }

  return {
    ...item,
    structuredData: raw(
      JSON.stringify(
        {
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: item.title,
          description: item.summary,
          datePublished: item.date.time,
          dateModified: item.modifiedTime,
          author: item.author
            ? {
                "@type": "Person",
                name: item.author,
              }
            : undefined,
          publisher: {
            "@type": "Organization",
            name: "Toska Osuuskunta",
            url: "https://sdlcai.org/",
          },
          image: "https://sdlcai.org/og.png?v=20260618",
          mainEntityOfPage: {
            "@type": "WebPage",
            "@id": item.url,
          },
        },
        null,
        2,
      ),
    ),
  };
}

function parseMarkdownPost(source, fileName) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    throw new Error(`${fileName} is missing front matter.`);
  }

  return {
    frontMatter: parseFrontMatter(match[1], fileName),
    markdown: match[2].trim(),
  };
}

function parseFrontMatter(source, fileName) {
  const frontMatter = {};

  for (const line of source.split("\n")) {
    if (!line.trim()) continue;

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      throw new Error(`${fileName} has invalid front matter line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    frontMatter[key] = value;
  }

  return frontMatter;
}

function renderMarkdown(markdown) {
  const renderer = new Renderer();

  renderer.heading = function heading(token) {
    const text = this.parser.parseInline(token.tokens);

    if (token.depth !== 2) {
      return `<h${token.depth}>${text}</h${token.depth}>\n`;
    }

    const id = slugify(token.text);
    const label = escapeHtmlAttribute(`Link to ${token.text}`);

    return `<h2 id="${id}"><span>${text}</span><a href="#${id}" data-a11y-target aria-label="${label}">#</a></h2>\n`;
  };

  renderer.paragraph = function paragraph(token) {
    if (token.tokens?.length === 1 && token.tokens[0]?.type === "image") {
      return this.image(token.tokens[0]);
    }

    return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
  };

  renderer.image = function image(token) {
    const src = escapeHtmlAttribute(token.href);
    const alt = escapeHtmlAttribute(token.text);
    const caption = token.title ? escapeHtml(token.title) : "";

    return `<figure class="my-10 border border-ink bg-paper p-3"><img src="${src}" alt="${alt}" class="aspect-[16/9] w-full object-cover grayscale transition duration-300 hover:grayscale-0 focus:grayscale-0" width="1280" height="720" loading="lazy" decoding="async">${caption ? `<figcaption class="mt-3 text-sm leading-6 text-muted">${caption}</figcaption>` : ""}</figure>\n`;
  };

  return marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value);
}

function formatDisplayDate(isoDate) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function getSeminar() {
  return {
    ...seminarData,
    display: {
      dateVenueLocation: `${seminarData.date.display} / ${seminarData.venue.name} / ${seminarData.location.display}`,
      dateShortVenueLocation: `${seminarData.date.display} / ${seminarData.venue.shortName} / ${seminarData.location.display}`,
      dateUniversityLocation: `${seminarData.date.display} / Aalto University / ${seminarData.location.display}`,
      footer: `${seminarData.name} / ${seminarData.date.display} / ${seminarData.venue.name} / sdlcai.org`,
    },
  };
}

function getScheduleItems(speakersById) {
  return schedule.items.map((item) => {
    const anchor = getSessionAnchor(item);
    const talks = item.talks?.map((talk) => {
      const talkSpeakers = talk.speakers.map((speakerId) => {
        const speaker = speakersById.get(speakerId);

        if (!speaker) {
          throw new Error(`Unknown speaker id: ${speakerId}`);
        }

        const speakerAnchor = getSpeakerAnchor(speaker.name);

        return {
          ...speaker,
          anchor: speakerAnchor,
          speakerHref: `/speakers/#${speakerAnchor}`,
        };
      });

      return {
        ...talk,
        speakers: talkSpeakers,
      };
    });

    return {
      ...item,
      talks,
      anchor,
      anchorHref: `#${anchor}`,
      scheduleHref: `/schedule/#${anchor}`,
    };
  });
}

function getSpeakersById() {
  return new Map(speakersData.items.map((speaker) => [speaker.id, speaker]));
}

function getSessionAnchor(item) {
  return `session-${item.time.slice(0, 5).replace(":", "")}-${slugify(
    item.title,
  )}`;
}

function getSpeakerAnchor(name) {
  return slugify(name);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { init };
