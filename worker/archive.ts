const archivedPublicSections = new Set([
  "schedule",
  "speakers",
  "photos",
  "timeline",
  "announcements",
  "faq",
  "posters",
  "for-sponsors",
]);

/** Keep shared resource links working when an edition moves into its archive. */
export function getArchiveRedirect(url: URL): string | null {
  if (url.pathname === "/2026") {
    const destination = new URL(url);
    destination.pathname = "/2026/";
    return destination.href;
  }
  const section = url.pathname.split("/")[1] ?? "";
  if (!archivedPublicSections.has(section)) return null;
  const destination = new URL(url);
  const trailingSlash = url.pathname === `/${section}` ? "/" : "";
  destination.pathname = `/2026${url.pathname}${trailingSlash}`;
  return destination.href;
}
