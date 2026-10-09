export const adminWorkspaceGroups = [
  {
    id: "people",
    label: "People",
    description: "Prepare registration, badges, and the event team.",
    items: [
      {
        id: "attendees",
        label: "Attendees",
        href: "/admin/attendees/",
        description:
          "Manage registrations and daytime catering, verify tickets, and track arrivals.",
      },
      {
        id: "badges",
        label: "Badges",
        href: "/admin/badges/",
        description:
          "Plan lanyard quantities, prepare spare badges, and generate print output.",
      },
      {
        id: "organizers",
        label: "Organizers",
        href: "/admin/organizers/",
        description: "Maintain the homepage team and choose who needs a badge.",
      },
      {
        id: "volunteers",
        label: "Volunteers",
        href: "/admin/volunteers/",
        description: "Keep volunteer names, contacts, and tasks together.",
      },
    ],
  },
  {
    id: "program",
    label: "Program",
    description: "Coordinate the running order and the people presenting.",
    items: [
      {
        id: "schedule",
        label: "Schedule",
        href: "/admin/schedule/",
        description:
          "Arrange talks within sessions and publish the running order.",
      },
      {
        id: "speakers",
        label: "Speakers",
        href: "/admin/speakers/",
        description:
          "Manage speaker access, talks, uploaded slides, promotion, and announcements.",
      },
      {
        id: "posters",
        label: "Posters",
        href: "/admin/posters/",
        description:
          "Review proposals, record decisions, and export submissions.",
      },
    ],
  },
  {
    id: "event-day",
    label: "Event day",
    description: "Run audience interactions and prepare the venue materials.",
    items: [
      {
        id: "qa",
        label: "Q&A",
        href: "/admin/qa/",
        description:
          "Open session rooms, moderate questions, and share staff access.",
      },
      {
        id: "slides",
        label: "Screen assets",
        href: "/admin/slides/",
        description:
          "Open schedule displays, session slides, and artwork downloads.",
      },
      {
        id: "discussion-tables",
        label: "Discussion tables",
        href: "/admin/discussion-tables/",
        description:
          "Preview conversation topics and print foldable A4 table signs.",
      },
      {
        id: "music",
        label: "Break music",
        href: "/admin/music/",
        description: "Choose background tracks and export a venue playlist.",
      },
    ],
  },
  {
    id: "hospitality",
    label: "Hospitality",
    description: "Coordinate dinner plans and speaker travel expenses.",
    items: [
      {
        id: "dinner",
        label: "Dinner",
        href: "/admin/dinner/",
        description:
          "Record attendance, review catering, and download the A4 entrance sign.",
      },
      {
        id: "receipts",
        label: "Travel receipts",
        href: "/admin/receipts/",
        description:
          "Enable speaker uploads, download receipts, and track processing.",
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    description: "Review changes and manage earlier registration contacts.",
    items: [
      {
        id: "activity",
        label: "Activity log",
        href: "/admin/activity/",
        description:
          "Review speaker sign-ins and changes made by speakers and organizers.",
      },
      {
        id: "interests",
        label: "Interest list",
        href: "/admin/interests/",
        description:
          "Inspect and export contacts who asked to hear when registration opened.",
      },
    ],
  },
];

export function getAdminGroup(current: string) {
  return adminWorkspaceGroups.find((group) =>
    group.items.some((item) => item.id === current),
  );
}

export function getAdminNavigationGroups(current: string) {
  return adminWorkspaceGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      ariaCurrent: item.id === current ? "page" : undefined,
    })),
  }));
}
