import type { BlockGuide } from "./types.ts";

export const venueGuides: Record<string, BlockGuide> = {
  "registration-import": {
    input:
      "A Tito, Webropol or custom CSV with names and individual ticket codes or email addresses.",
    output:
      "A roster with a stable ID, source key and ticket status for each registration.",
    actions: [
      "Detect the delimiter and common ticket fields, or map your own column names.",
      "Keep cancelled tickets identifiable and leave unassigned Tito tickets available for the desk.",
      "Supply the previous roster on a repeat import to update matching records and preserve their IDs.",
    ],
    related: ["check-in", "badges", "catering"],
    demoTitle: "Turn a ticket export into a roster",
    demoIntro:
      "Edit a name or change a ticket status in this fictional Tito export. Import the rows to see how the toolkit reads them.",
  },
  "check-in": {
    input: "A registration roster and a desk link issued by an organizer.",
    output:
      "Arrival status for each guest and a history of check-ins and corrections.",
    actions: [
      "Add registrations or link a poster presenter or volunteer record to an existing ticket.",
      "Give each desk a time-limited link and revoke it when the shift ends.",
      "Look up a guest by name, ticket code or email and assign a name to an unclaimed ticket on arrival.",
      "Review a guest’s arrival history and undo a mistaken check-in as an organizer.",
    ],
    related: ["registration-import", "poster-proposals", "badges"],
    demoTitle: "Work the registration desk",
    demoIntro:
      "Alex Li brings ticket F-101. Find Alex and record the arrival in this practice roster, then switch to the organizer view to undo it.",
  },
  badges: {
    input:
      "Names, roles and optional affiliations, plus your role colors, logo and print dimensions.",
    output:
      "A badge proof, fit and font findings for each row, and a print PDF when all rows pass.",
    actions: [
      "Preview a person’s badge or a spare badge in its role color.",
      "Adjust the trim diameter, bleed and text sizing, then check names for overflow and missing characters.",
      "Export the checked artwork as a PDF with the requested spares and optional reverse sides.",
    ],
    related: ["registration-import", "lanyards"],
    demoTitle: "Proof a speaker badge",
    demoIntro:
      "Change the name and role on the sample badge. The preview uses the toolkit’s print artwork and checks the text against the safe area.",
  },
  lanyards: {
    input:
      "The roles on your badge list, a color for each role and a spare count.",
    output:
      "Counts by role and color, plus the total number of lanyards to order.",
    actions: [
      "Count one lanyard for each included badge.",
      "Add spare lanyards for individual roles.",
      "Assign the same color to several roles and combine their quantities into a single order line.",
    ],
    related: ["badges", "registration-import"],
    demoTitle: "Calculate a lanyard order",
    demoIntro:
      "Eight attendees need blue lanyards and two speakers need red ones. Change the spares or give both roles the same color.",
  },
  "venue-signs": {
    input:
      "An event name and a list of destinations, directions, instructions or links.",
    output: "An A4 print pack with one page per sign.",
    actions: [
      "Point guests left, right or straight ahead and add directions below the destination.",
      "Turn a programme or room URL into a QR code on the printed sign.",
      "Set the event accent color and export a single replacement sign or the whole pack.",
    ],
    related: ["table-tents", "schedule"],
    demoTitle: "Point guests to registration",
    demoIntro:
      "Hang this sign at a different junction. Change the arrow and destination to see the A4 artwork update.",
  },
  "table-tents": {
    input:
      "An event name and each table’s label, topic and optional opening question.",
    output:
      "One foldable A4 sheet per table, with a matching face on each side.",
    actions: [
      "Give every table its own topic, number or name.",
      "Add a starter question that guests can read from either side.",
      "Export the full group of cards with fold guides and your event’s accent color.",
    ],
    related: ["venue-signs"],
    demoTitle: "Lay out a discussion card",
    demoIntro:
      "Give Table 3 a topic and an opening question. One face is rotated on the sheet so both sides read upright after folding.",
  },
};
