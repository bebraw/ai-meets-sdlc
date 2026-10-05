export function getSlideTitleClassName(title: string): string {
  if (title.length > 115) return "presentation-talk-title is-dense";
  if (title.length > 74) return "presentation-talk-title is-long";
  if (title.length > 38) return "presentation-talk-title is-medium";
  return "presentation-talk-title is-short";
}
