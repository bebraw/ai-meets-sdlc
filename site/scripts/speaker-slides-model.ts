export const maxSlideFileBytes = 50 * 1024 * 1024;

export type SlideFormat = "pdf" | "powerpoint" | "html";

export const slideContentTypes = {
  pdf: "application/pdf",
  powerpoint:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  html: "text/html",
} as const;

export interface SpeakerSlideLink {
  talk_id: string;
  url: string;
}

export interface PublishedSlideLink {
  url: string;
  label: "Slides" | "Slides (PDF)";
}

export interface SpeakerSlideFile {
  slide_id: string;
  talk_id: string;
  format: SlideFormat;
  filename: string;
  byte_size: number;
  may_publish: boolean;
  published_at: string | null;
  uploaded_at: string;
  download_url: string;
  public_url: string | null;
}

export function slideFormatFromFilename(filename: string): SlideFormat | null {
  const extension = filename.toLowerCase().split(".").at(-1);
  return extension === "pdf"
    ? "pdf"
    : extension === "pptx"
      ? "powerpoint"
      : extension === "html" || extension === "htm"
        ? "html"
        : null;
}

export function slideFormatLabel(format: SlideFormat): string {
  return format === "pdf" ? "PDF" : format === "html" ? "HTML" : "PowerPoint";
}
