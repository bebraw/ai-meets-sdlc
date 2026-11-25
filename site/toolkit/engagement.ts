import type { BlockGuide } from "./types.ts";

export const engagementGuides: Record<string, BlockGuide> = {
  "dinner-rsvps": {
    input:
      "A guest list, a reply deadline and the date to delete private replies.",
    actions: [
      "Give each guest a private invitation link.",
      "Guests can reply or change their meal choice before the deadline.",
      "Check who still needs to reply and hand meal counts and dietary notes to the caterer.",
    ],
    output:
      "An invitation for each guest and a catering handoff with meal totals and unnamed dietary notes.",
    related: ["catering", "speaker-workspace"],
    demoTitle: "Answer a dinner invitation",
    demoIntro:
      "Three of four guests have replied. Answer Casey’s invitation and see what changes for the caterer.",
  },
  "audience-qa": {
    input: "An open Q&A room for a session and a question from an attendee.",
    actions: [
      "Attendees submit questions and vote on approved questions from other people.",
      "Moderators can edit, approve or hide a submission.",
      "The MC chooses a question for the stage screen and marks it answered.",
    ],
    output:
      "An approved question queue for attendees and a stage screen showing the MC’s selection.",
    related: ["schedule", "event-feedback"],
    demoTitle: "Put a question on stage",
    demoIntro:
      "Ask a question as an attendee, approve it as the moderator, then choose when the audience sees it on stage.",
  },
  "event-feedback": {
    input:
      "Survey questions, consent wording and a retention period for individual answers.",
    actions: [
      "Publish a versioned form with ratings, choices, recommendations or free-text questions.",
      "Attendees can submit a response and use their private code to withdraw it.",
      "Organizers can review totals and read individual comments while they are retained.",
    ],
    output:
      "A survey report by version, with counts for each answer and scores for recommendation questions.",
    related: ["attendee-messages", "audience-qa"],
    demoTitle: "Add a rating to the report",
    demoIntro:
      "Two attendees rated the programme. Add a third response, then see what happens to the totals if you withdraw it.",
  },
  "attendee-messages": {
    input:
      "Recipient addresses from the event roster, an email subject and the message text.",
    actions: [
      "Select recipients. Duplicate addresses count once and previous event withdrawals are excluded.",
      "Review the message and its recipients before sending individual emails.",
      "Check the delivery history for accepted, skipped, rejected or uncertain outcomes.",
    ],
    output:
      "A reviewed email preview and a delivery report for each event announcement.",
    related: ["registration-import", "newsletter"],
    demoTitle: "Preview an arrival announcement",
    demoIntro:
      "Edit the announcement for three fictional contacts. One has withdrawn from event emails. Review the preview, then simulate delivery.",
  },
  newsletter: {
    input:
      "Signup wording for the organizer’s events and an email address from the subscriber.",
    actions: [
      "Publish a consent notice that can be shared across events.",
      "Subscribers request a confirmation message and use its one-time link to join.",
      "Track confirmations and withdrawals so a mailing provider can update its list.",
    ],
    output:
      "A confirmed subscriber list and a history of consent changes across events in the same installation.",
    related: ["attendee-messages", "publication-queue"],
    demoTitle: "Follow a newsletter signup",
    demoIntro:
      "Use Robin’s sample address to see when a signup appears on the organizer’s list and what happens when Robin withdraws.",
  },
  "publication-queue": {
    input:
      "Draft copy for a website, LinkedIn or newsletter, plus its supporting sources and assets.",
    actions: [
      "Keep the draft, source links and artwork together for review.",
      "Set a publication date and filter the queue by channel or status.",
      "Record the final URL once a public post is published.",
    ],
    output:
      "An editorial record with the current copy, channel, status, date and published link.",
    related: ["talk-graphics", "newsletter"],
    demoTitle: "Schedule a programme announcement",
    demoIntro:
      "An editor has approved a website announcement. Choose its date, then record where the post appeared.",
  },
};
