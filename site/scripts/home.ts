import "./newsletter.ts";

// Preserve links to sections of the former event homepage.
const archiveSections = new Set([
  "program",
  "speakers",
  "schedule",
  "venue",
  "organizers",
  "sponsors",
]);
if (archiveSections.has(location.hash.slice(1))) {
  location.replace(`/2026/${location.hash}`);
}
