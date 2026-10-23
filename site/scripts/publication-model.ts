export const publicationStatuses = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "In review" },
  { value: "ready", label: "Ready" },
  { value: "scheduled", label: "Scheduled" },
  { value: "published", label: "Published" },
] as const;

export type PublicationStatus = (typeof publicationStatuses)[number]["value"];
export interface PublicationItem {
  id: string;
  eventId: string;
  channel: "linkedin" | "website" | "newsletter";
  position: number;
  title: string;
  subtitle: string;
  summary: string;
  body: string;
  altText: string;
  notes: string;
  status: PublicationStatus;
  publicationDate: string;
  publicationUrl: string;
  graphicFormat: "portrait" | "landscape";
  revision: number;
  updatedAt: string | null;
  assets: {
    format: "portrait" | "landscape";
    url: string;
    width: number;
    height: number;
  }[];
  sources: { label: string; url: string }[];
}

export const publicationChannels = {
  linkedin: "LinkedIn",
  website: "Website",
  newsletter: "Newsletter",
} as const;
