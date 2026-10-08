export const badgeRoles = [
  "attendee",
  "speaker",
  "organizer",
  "sponsor",
] as const;
export const badgeRoleAppearance: Record<
  (typeof badgeRoles)[number],
  { label: string; colorName: string; background: string; foreground: string }
> = {
  attendee: {
    label: "Attendees",
    colorName: "White",
    background: "#ffffff",
    foreground: "#000000",
  },
  speaker: {
    label: "Speakers",
    colorName: "Black",
    background: "#000000",
    foreground: "#ffffff",
  },
  organizer: {
    label: "Organizers / volunteers",
    colorName: "Orange",
    background: "#f58220",
    foreground: "#000000",
  },
  sponsor: {
    label: "Sponsors",
    colorName: "Teal",
    background: "#64c4bc",
    foreground: "#000000",
  },
};
