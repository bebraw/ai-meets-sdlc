export function originalContentType(filename: string): string {
  return /\.heic$/i.test(filename) ? "image/heic" : "image/jpeg";
}

export function photoDownloadName(filename: string, variant: string): string {
  if (variant === "original") return filename;
  return `${filename.replace(/\.[^.]+$/, "")}-${variant}.jpg`;
}

export function photoObjectFilename(filename: string, variant: string): string {
  return variant === "original" && /\.heic$/i.test(filename)
    ? "original.heic"
    : `${variant}.jpg`;
}
