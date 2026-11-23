import { resultSchema } from "../result-schema.mjs";

const record = (fields, required = Object.keys(fields)) =>
  resultSchema(fields, required);
const list = (items) => ({ type: "array", items });
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const text = "string",
  integer = "integer",
  flag = "boolean";
const stamp = { type: "string", format: "date-time" };
const saved = record({ id: text, revision: integer });
const revoked = record({ revoked: flag });
const token = {
  type: "string",
  description: "Private capability for this record or desk.",
};
const url = {
  type: "string",
  description: "Invitation link when the host supplies an action URL.",
};
const directoryPerson = { id: text, name: text, company: text, photo: text };
const ticket = {
  id: text,
  name: text,
  company: text,
  type: text,
  status: text,
  revision: integer,
  arrivedAt: nullable(stamp),
};
const arrival = record({
  id: text,
  arrivedAt: nullable(stamp),
  revision: integer,
});
const call = {
  deadline: stamp,
  consent: text,
  revision: integer,
  requireChallenge: flag,
};
const proposal = record({
  id: text,
  name: text,
  email: text,
  organization: text,
  title: text,
  abstract: text,
  coauthors: text,
  size: text,
  setupNotes: text,
  status: text,
  revision: integer,
  callRevision: integer,
  consentText: text,
  receivedAt: stamp,
});
const dinnerResponse = record({
  attendance: text,
  meal: text,
  diet: text,
  crossContamination: text,
});
const dinnerGuest = {
  id: text,
  name: text,
  response: nullable(dinnerResponse),
  replyBy: stamp,
  retainUntil: stamp,
  revision: integer,
  revoked: flag,
};
const profile = { name: text, bio: text, title: text, abstract: text };
const material = { id: text, filename: text };
const workspace = record({
  speakerId: text,
  talkId: text,
  revision: integer,
  status: text,
  draft: record(profile),
  published: nullable(record(profile)),
  reviewNote: text,
  mayPublish: flag,
  canSetSharing: flag,
  materials: list(
    record({ ...material, mayShare: flag, published: flag, revision: integer }),
  ),
});
const speakerInvite = record(
  {
    talkId: text,
    revision: integer,
    token,
    url,
    delivery: { type: "string", enum: ["manual", "accepted", "unknown"] },
  },
  ["talkId", "revision", "token", "delivery"],
);

export const workflowResults = {
  organizers_public: record({ people: list(record(directoryPerson)) }),
  organizers_list: record({
    people: list(
      record({
        ...directoryPerson,
        visible: integer,
        badge: integer,
        position: integer,
        revision: integer,
      }),
    ),
  }),
  organizers_create: saved,
  organizers_update: saved,
  organizers_delete: record({ removed: flag }),
  checkin_roster: record({
    rosterRevision: integer,
    people: list(
      record({
        ...ticket,
        ticketCode: text,
        email: text,
        source: text,
        sourceKey: text,
        assignedAtDesk: flag,
      }),
    ),
  }),
  checkin_register: record({ rosterRevision: integer, submitted: integer }),
  checkin_link: record({ id: text, rosterRevision: integer }),
  checkin_issue_grant: record({ id: text, expiresAt: stamp, token, url }, [
    "id",
    "expiresAt",
    "token",
  ]),
  checkin_grants: record({
    grants: list(
      record({ id: text, label: text, expiresAt: stamp, revoked: integer }),
    ),
  }),
  checkin_revoke_grant: revoked,
  checkin_lookup: record({ people: list(record(ticket)) }),
  checkin_arrive: arrival,
  checkin_undo: arrival,
  checkin_history: record({
    history: list(record({ action: text, actor: text, at: stamp })),
  }),
  posters_configure_call: record(call),
  posters_call: record({ ...call, open: flag }, ["revision", "open"]),
  posters_submit: record({ id: text, received: flag }),
  posters_review_queue: record({ proposals: list(proposal) }),
  posters_decide: record({ id: text, status: text, revision: integer }),
  posters_presenters: record({
    people: list(
      record({
        id: text,
        source: text,
        name: text,
        company: text,
        email: text,
        status: text,
        type: text,
      }),
    ),
  }),
  posters_export: record({ count: integer, artifact: "object" }),
  dinner_invite: record(
    { id: text, token, url, replyBy: stamp, retainUntil: stamp },
    ["id", "token", "replyBy", "retainUntil"],
  ),
  dinner_read_invitation: record(dinnerGuest),
  dinner_respond: record({
    id: text,
    revision: integer,
    response: dinnerResponse,
  }),
  dinner_list: record({
    guests: list(record({ ...dinnerGuest, email: text })),
  }),
  dinner_revoke: revoked,
  dinner_catering: record({
    attending: integer,
    pending: integer,
    declined: integer,
    meals: { type: "object", additionalProperties: { type: "integer" } },
    people: list(record({ status: text, diet: text })),
  }),
  speaker_assign: speakerInvite,
  speaker_reissue: speakerInvite,
  speaker_revoke: record({ revoked: flag, revision: integer }),
  speaker_read_workspace: workspace,
  speaker_submit: record({ talkId: text, status: text, revision: integer }),
  speaker_edit_draft: record({ talkId: text, status: text, revision: integer }),
  speaker_review_queue: record({ workspaces: list(workspace) }),
  speaker_review: record({ status: text, revision: integer }),
  speaker_revision_history: record({
    revisions: list(
      record({
        revision: integer,
        at: stamp,
        state: text,
        profile: record(profile),
      }),
    ),
  }),
  speaker_upload_material: record({
    id: text,
    talkId: text,
    revision: integer,
    byteSize: integer,
    published: flag,
  }),
  speaker_material_permission: record({ revision: integer }),
  speaker_publish_material: record({ published: flag, revision: integer }),
  speaker_download_material: record({ artifact: "object" }),
  speaker_programme: record({
    sessions: list(
      record({
        talkId: text,
        speakerId: text,
        ...profile,
        materials: list(record(material)),
      }),
    ),
  }),
};
