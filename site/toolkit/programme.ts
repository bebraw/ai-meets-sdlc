import type { BlockGuide } from "./types.ts";

export const programmeGuides: Record<string, BlockGuide> = {
  "poster-proposals": {
    input:
      "Set a submission deadline and write the consent statement. Presenters supply their contact details, poster title and abstract.",
    output:
      "A private review queue, a CSV of decisions and a list of accepted presenters ready for check-in.",
    actions: [
      "Open a call and collect submissions against the current consent wording.",
      "Review abstracts, coauthors, poster sizes and setup requests in one queue.",
      "Shortlist, accept, waitlist or decline a proposal. Export the decisions or pass accepted presenters to the desk.",
    ],
    related: ["check-in", "badges"],
    demoTitle: "Decide who goes on the presenter list",
    demoIntro:
      "Alex has submitted a poster on accessible diagrams. Change the review decision and see the handoff to the registration desk.",
  },
  "speaker-workspace": {
    input:
      "Assign a talk to a speaker and give them a private invitation link. They supply their profile, talk copy and any PDF materials.",
    output:
      "The public programme contains approved talk copy and the materials each speaker has agreed to share.",
    actions: [
      "Invite a speaker to a private workspace. Replace or revoke their invitation when needed.",
      "Prepare a draft, let the speaker confirm publication permission and review the submitted revision. Approve it or return it with a note.",
      "Publish individual PDFs after permission is granted. A speaker can withdraw sharing permission for a file at any time.",
    ],
    related: ["programme-feed", "talk-graphics"],
    demoTitle: "Release a speaker’s slides",
    demoIntro:
      "The sample talk is already approved for the programme. Try the speaker’s sharing choice and the organizer’s publication action for one PDF.",
  },
  "programme-feed": {
    input:
      "Supply public event details, speakers, topics and sessions. Link each session to its speaker and topic IDs.",
    output:
      "An event.json file with a schema version and a revision that changes when the programme content changes.",
    actions: [
      "Check for duplicate IDs, missing references and sessions that end before they start.",
      "Validate the event time zone and the public URLs included in the feed.",
      "Export the checked event, sessions, speakers, topics and public links as one JSON file.",
    ],
    related: ["speaker-workspace", "schedule"],
    demoTitle: "Repair a session’s speaker reference",
    demoIntro:
      "The speaker in the sample programme has the ID zoe. Give the session the matching speaker ID to validate and download the feed.",
  },
  schedule: {
    input:
      "Give each session a start time and title. Include end times, speakers and rooms when available, then choose the event time zone.",
    output:
      "A self-contained HTML agenda or venue display, sorted by start time and ready to open in a browser.",
    actions: [
      "Put sessions in chronological order and display their times in the event’s time zone.",
      "Switch between a light agenda and a large-type venue screen.",
      "Download the HTML file for display at the venue or printing.",
    ],
    related: ["programme-feed", "venue-signs"],
    demoTitle: "Put the agenda on a venue screen",
    demoIntro:
      "Switch the display and time zone for two sessions at Field Notes Forum, then download the same schedule you see here.",
  },
  "talk-graphics": {
    input:
      "Bring an event name, approved talk title and speaker name. Choose a typeface, accent color and image dimensions. Add a caption or portrait as needed.",
    output:
      "A PNG sized for the intended channel. The renderer checks that the copy fits before exporting.",
    actions: [
      "Lay out the event, session and speaker together with an optional portrait.",
      "Choose Noto Sans, Lora or Fira Code and set the image size and accent color.",
      "Check the text fit and export a PNG. Shorten the copy or increase the dimensions when a graphic is too crowded.",
    ],
    related: ["speaker-workspace", "publication-queue"],
    demoTitle: "Set the type for a talk graphic",
    demoIntro:
      "Edit the title and choose an accent for the speaker announcement. The preview uses the artwork layout and text-fit check used for PNG export.",
  },
  "organizer-directory": {
    input:
      "Start with organizer names. Add an affiliation, photo, display position and a visibility choice for each person.",
    output:
      "An ordered public team directory and a private roster that also records badge choices.",
    actions: [
      "Create a private organizer profile and edit its name, affiliation or photo.",
      "Choose which profiles visitors see and set their display order.",
      "Track badge choices separately from public visibility, and remove people from the directory when needed.",
    ],
    related: ["badges"],
    demoTitle: "Choose who appears on the team page",
    demoIntro:
      "Try publishing a private team member and changing the order of the two profiles in this sample directory.",
  },
  catering: {
    input:
      "Supply each person’s attendance status and dietary response. Add reserved meals and any reviewed dietary instructions.",
    output:
      "A plain-text caterer brief with a meal total, missing information, and grouped dietary requirements alongside the original responses.",
    actions: [
      "Count active attendees and extra reserved meals. Cancelled attendees are excluded.",
      "Keep combined requirements together for each meal and identify responses that need clarification.",
      "Include reviewed instructions and export the plain-text brief for the caterer.",
    ],
    related: ["registration-import", "dinner-rsvps"],
    demoTitle: "Build a caterer’s brief",
    demoIntro:
      "Two guests have replied with “Vegan and gluten free” and “No restrictions.” Change the third guest’s reply and see what the caterer receives.",
  },
};
