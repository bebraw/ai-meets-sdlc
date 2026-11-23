import { resultSchema } from "../result-schema.mjs";
import { feedback } from "./engagement-feedback.mjs";
import { publication } from "./engagement-publication.mjs";

const record = (fields, required = Object.keys(fields)) =>
  resultSchema(fields, required);
const rows = (items) => ({ type: "array", items });
const strings = rows({ type: "string" });
const when = { type: "string", format: "date-time" };
const maybeText = ["string", "null"];
const room = record({
  id: "string",
  title: "string",
  status: "string",
  selected: maybeText,
  revision: "integer",
});
const submitted = record({
  id: "string",
  status: "string",
  revision: "integer",
});
const moderated = record({ ...submitted.properties, question: "string" });
const question = record({
  ...moderated.properties,
  votes: "integer",
  voted: "integer",
  own: "integer",
});
const surveyQuestions = feedback.operations.find(
  (op) => op.name === "feedback_publish_form",
).inputSchema.properties.questions;
const form = record({
  version: "integer",
  title: "string",
  consent: "string",
  retentionDays: "integer",
  questions: surveyQuestions,
  received: "integer",
});
const withdrawn = record({ withdrawn: { type: "boolean", const: true } });
const consent = record({
  title: "string",
  consent: "string",
  revision: "integer",
});
const deliveries = record({
  pending: "integer",
  accepted: "integer",
  unknown: "integer",
  rejected: "integer",
  skipped: "integer",
});
const editorialInput = publication.operations.find(
  (op) => op.name === "publication_save",
).inputSchema;
const item = record({ ...editorialInput.properties, updatedAt: when }, [
  ...editorialInput.required,
  "updatedAt",
]);

export const engagementResults = {
  qa_rooms: record({ rooms: rows(room) }),
  qa_configure_room: room,
  qa_view: record({
    room,
    questions: rows(question),
    screen: { anyOf: [question, { type: "null" }] },
    permissions: record({ canModerate: "boolean", canPresent: "boolean" }),
  }),
  qa_screen: record({
    title: "string",
    room: "string",
    status: "string",
    questionId: maybeText,
    question: maybeText,
  }),
  qa_ask: record({ ...submitted.properties, room: "string" }),
  qa_moderate: moderated,
  qa_vote: record({ questionId: "string", votes: "integer" }),
  qa_present: room,
  feedback_publish_form: form,
  feedback_form: form,
  feedback_respond: record({ withdrawalCode: "string", expiresAt: when }),
  feedback_withdraw: withdrawn,
  feedback_report: record(
    {
      version: "integer",
      responsesReceived: "integer",
      totals: rows(
        record({ question: "string", answer: "string", count: "integer" }),
      ),
      recommendationScores: rows(
        record({
          id: "string",
          answered: "integer",
          score: ["integer", "null"],
        }),
      ),
      responses: rows(
        record({
          submitted: when,
          answers: {
            type: "object",
            additionalProperties: { type: ["string", "integer"] },
          },
        }),
      ),
    },
    ["version", "responsesReceived", "totals", "recommendationScores"],
  ),
  messages_audience: record({ revision: "integer", emails: strings }),
  messages_set_audience: record({ revision: "integer", eligible: "integer" }),
  messages_preview: record({
    previewId: "string",
    subject: "string",
    body: "string",
    recipients: strings,
    expiresAt: when,
  }),
  messages_send: record({ campaignId: "string", deliveries }),
  messages_withdraw: withdrawn,
  messages_history: record({
    campaigns: rows(
      record({
        id: "string",
        subject: "string",
        status: "string",
        createdAt: when,
        deliveries,
      }),
    ),
  }),
  newsletter_configure: consent,
  newsletter_form: consent,
  newsletter_subscribe: record({ message: "string" }),
  newsletter_confirm: record({
    subscribed: { type: "boolean", const: true },
    withdrawalCode: "string",
    withdrawal: "string",
  }),
  newsletter_withdraw: withdrawn,
  newsletter_subscribers: record({
    subscribers: rows(
      record({ id: "string", email: "string", consentVersion: "integer" }),
    ),
    total: "integer",
  }),
  newsletter_changes: record({
    changes: rows(
      record({
        seq: "integer",
        member: "string",
        status: "string",
        notice: "string",
        revision: "integer",
        occurredAt: when,
        email: maybeText,
      }),
    ),
    next: "integer",
  }),
  publication_save: item,
  publication_list: record({ items: rows(item) }),
};
