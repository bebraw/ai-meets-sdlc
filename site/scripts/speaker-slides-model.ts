export const maxSlideFileBytes = 25 * 1024 * 1024;

export type SlideFormat = "pdf" | "powerpoint";

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
      : null;
}

export function slideFormatLabel(format: SlideFormat): string {
  return format === "pdf" ? "PDF" : "PowerPoint";
}
