import { marked } from "marked";
import { decodeHTML } from "entities";

export interface EventFeed {
  schemaVersion: number;
  revision: string;
  updatedAt: string;
  event: {
    id: string;
    name: string;
    summary: string;
    url: string;
    startDate: string;
    timeZone: string;
    venue: { name: string; city: string; country: string };
  };
  topics: { id: string; label: string; summary: string }[];
  speakers: { id: string; name: string; url?: string; summary?: string }[];
  sessions: {
    id: string;
    title: string;
    summary: string | null;
    contentStatus: "announced" | "details-pending" | "cancelled";
    url: string;
    speakerIds: string[];
    topicIds: string[];
  }[];
  actions: {
    id: string;
    label: string;
    url: string;
    kind: "registration" | "information";
  }[];
}

export function plainText(markdown: string): string {
  return decodeHTML(
    marked
      .parse(markdown, { async: false })
      .replace(
        /<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote|br|pre|hr)\b[^>]*>/gi,
        " ",
      )
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function sessionContent(title: string, abstract: string) {
  const pending =
    !abstract.trim() ||
    /abstract forthcoming|still to be decided/i.test(abstract);
  return {
    title: plainText(title),
    summary: pending ? null : plainText(abstract),
    contentStatus: pending
      ? ("details-pending" as const)
      : ("announced" as const),
  };
}

export async function reviseFeed(feed: EventFeed): Promise<EventFeed> {
  const { revision: _revision, ...content } = feed;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(content)),
  );
  return {
    ...feed,
    revision: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
