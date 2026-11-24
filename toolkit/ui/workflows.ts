import type { WorkflowResults } from "../blocks/workflows.mjs";
import {
  element,
  type Call,
  type Inputs,
  type Navigate,
  type UiOperation,
} from "./types.js";

type WorkflowResult = {
  [Name in keyof WorkflowResults]: { name: Name; data: WorkflowResults[Name] };
}[keyof WorkflowResults];
const owns = (name: string) =>
  /^(organizers_|checkin_|posters_|dinner_|speaker_)/.test(name);
const fieldLabels: Record<string, string> = {
  id: "Record ID",
  talkId: "Talk ID",
  speakerId: "Speaker ID",
  materialId: "Material ID",
  name: "Name",
  company: "Organization",
  badge: "Include in badge printing",
  visible: "Show in the public directory",
  validDays: "Days of access",
  deadline: "Submission deadline (date, time and offset)",
  expiresAt: "Access expires (date, time and offset)",
  retainUntil: "Delete private responses after (date, time and offset)",
  replyBy: "Reply by (date, time and offset)",
  assignName: "Name for an unassigned ticket",
  requestId: "Submission reference",
  contentBase64: "Presentation PDF",
  mayPublish: "Allow publication of my profile and talk",
  mayShare: "Allow publication of this PDF",
  sendEmail: "Send this invitation by email",
  crossContamination: "Cross-contamination concerns",
  revision: "Record version",
  rosterRevision: "Roster version",
  callRevision: "Call version",
};
const actionLabels: Record<string, string> = {
  checkin_arrive: "Confirm check-in",
  checkin_undo: "Undo check-in",
  posters_submit: "Submit proposal",
  posters_decide: "Save review decision",
  dinner_read_invitation: "Open dinner invitation",
  dinner_respond: "Save dinner response",
  speaker_read_workspace: "Open speaker workspace",
  speaker_submit: "Send for review",
  speaker_edit_draft: "Save private draft",
  speaker_upload_material: "Upload PDF",
  speaker_material_permission: "Save sharing choice",
  speaker_review: "Save review",
  speaker_programme: "Show published programme",
  organizers_list: "Show team",
  organizers_public: "Show public directory",
};

export async function prepareWorkflowForm(
  operation: UiOperation,
  call: Call,
  initial: Inputs = {},
) {
  if (!owns(operation.name)) return null;
  const op = structuredClone(operation),
    fields = op.inputSchema.properties;
  const input = { ...initial };
  op.title = actionLabels[op.name] ?? op.title;
  for (const [key, field] of Object.entries(fields)) {
    if (fieldLabels[key]) field.title = fieldLabels[key];
    if (
      ["revision", "rosterRevision", "callRevision", "requestId"].includes(
        key,
      ) &&
      input[key] !== undefined
    )
      field.readOnly = true;
    if (key === "token") {
      field.title = "Private access token";
      field.description = "Supplied by the invitation link.";
    }
  }
  if (op.name === "posters_submit" || op.name === "posters_configure_call") {
    const callInfo = await call<WorkflowResults["posters_call"]>(
      "posters_call",
      {},
    );
    if (op.name === "posters_submit") {
      if (!("deadline" in callInfo) || !callInfo.open)
        return {
          ...op,
          unavailable:
            "deadline" in callInfo
              ? "The poster call is closed."
              : "The poster call has not opened.",
          initial: {},
        };
      fields.consentAccepted.title = callInfo.consent;
      fields.callRevision.readOnly = true;
      fields.requestId.readOnly = true;
      input.callRevision = callInfo.revision;
      input.requestId ??= crypto.randomUUID();
      input.consentAccepted = false;
      if (!callInfo.requireChallenge) delete fields.challengeToken;
    } else {
      input.revision ??= callInfo.revision;
      fields.revision.readOnly = true;
      if ("deadline" in callInfo) {
        input.deadline ??= callInfo.deadline;
        input.consent ??= callInfo.consent;
        input.requireChallenge ??= callInfo.requireChallenge;
      }
    }
  }
  if (op.name === "checkin_register" && input.rosterRevision === undefined) {
    input.rosterRevision = (
      await call<WorkflowResults["checkin_roster"]>("checkin_roster", {})
    ).rosterRevision;
    input.people ??= [
      {
        id: crypto.randomUUID(),
        name: "",
        type: "attendee",
        status: "active",
        source: "manual",
      },
    ];
    fields.rosterRevision.readOnly = true;
  }
  if (op.name === "dinner_respond" && input.token) {
    const invitation = await call<WorkflowResults["dinner_read_invitation"]>(
      "dinner_read_invitation",
      {
        token: input.token,
      },
    );
    if (Date.parse(invitation.replyBy) < Date.now())
      return {
        ...op,
        unavailable: "The response deadline has passed.",
        initial: {},
      };
    // Keep the revision attached to an in-progress edit for optimistic concurrency.
    if (input.revision === undefined) {
      input.revision = invitation.revision;
      Object.assign(input, invitation.response ?? {});
    }
    fields.revision.readOnly = true;
    op.description =
      "Dinner response for " +
      invitation.name +
      ". Reply by " +
      new Date(invitation.replyBy).toLocaleString() +
      ".";
  }
  op.initial = input;
  return op;
}

function record(section: HTMLElement, title: string, details?: string) {
  const row = element("article");
  row.append(element("h3", title));
  if (details) row.append(element("p", details));
  section.append(row);
  return row;
}
function buttons(parent: HTMLElement) {
  const group = element("div", undefined, "qa-actions");
  parent.append(group);
  return group;
}
function action(
  parent: HTMLElement,
  label: string,
  name: keyof WorkflowResults,
  initial: Inputs,
  navigate: Navigate,
) {
  // The select contains only the current visitor's allowed operations for the selected workflow.
  const list = document.querySelector<HTMLSelectElement>("#operation");
  if (list && ![...list.options].some((option) => option.value === name))
    return;
  const button = element("button", label);
  button.type = "button";
  button.addEventListener("click", () => navigate(name, initial));
  parent.append(button);
}
function empty(
  section: HTMLElement,
  items: readonly unknown[],
  message: string,
) {
  if (!items.length) section.append(element("p", message));
}
function stamp(value: string) {
  return new Date(value).toLocaleString();
}
function holder(row: { name: string }) {
  return row.name || "Unassigned ticket";
}
const version = ({ id, revision }: { id: string; revision: number }) => ({
  id,
  revision,
});
function directoryRows(
  op: UiOperation,
  data: WorkflowResults["organizers_public" | "organizers_list"],
  section: HTMLElement,
  go: Navigate,
) {
  section.append(
    element(
      "h2",
      op.name === "organizers_list" ? "Organizing team" : "Organizers",
    ),
  );
  if (op.name === "organizers_list")
    action(buttons(section), "Add team member", "organizers_create", {}, go);
  empty(section, data.people, "No team members to show.");
  for (const p of data.people) {
    const row = record(section, p.name, p.company);
    if (!("visible" in p)) continue;
    row.append(
      element("small", p.visible ? "Public directory" : "Internal team member"),
    );
    const group = buttons(row);
    action(
      group,
      "Edit " + p.name,
      "organizers_update",
      {
        ...version(p),
        name: p.name,
        company: p.company,
        photo: p.photo,
        visible: Boolean(p.visible),
        badge: Boolean(p.badge),
        position: p.position,
      },
      go,
    );
    action(group, "Remove member", "organizers_delete", version(p), go);
  }
}
function deskRows(
  op: UiOperation,
  data: WorkflowResults["checkin_roster" | "checkin_lookup"],
  section: HTMLElement,
  go: Navigate,
  source: Inputs,
) {
  section.append(
    element(
      "h2",
      op.name === "checkin_lookup"
        ? "Matching registrations"
        : "Registration roster",
    ),
  );
  if ("rosterRevision" in data) {
    const group = buttons(section);
    action(
      group,
      "Add attendee",
      "checkin_register",
      {
        rosterRevision: data.rosterRevision,
        people: [
          {
            id: crypto.randomUUID(),
            name: "",
            source: "manual",
            status: "active",
            type: "attendee",
          },
        ],
      },
      go,
    );
    action(group, "Issue staff access", "checkin_issue_grant", {}, go);
  }
  empty(section, data.people, "No matching registrations.");
  for (const p of data.people) {
    const row = record(
      section,
      holder(p),
      [
        p.company,
        p.status === "cancelled"
          ? "Cancelled"
          : p.arrivedAt
            ? "Arrived " + stamp(p.arrivedAt)
            : "Awaiting arrival",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const group = buttons(row),
      access = source.token ? { token: source.token } : {};
    if (!p.arrivedAt && p.status === "active")
      action(
        group,
        p.name ? "Check in " + p.name : "Assign and check in",
        "checkin_arrive",
        { ...version(p), ...access },
        go,
      );
    if (p.arrivedAt)
      action(group, "Correct arrival", "checkin_undo", version(p), go);
    action(group, "View arrival history", "checkin_history", { id: p.id }, go);
    if ("rosterRevision" in data && "sourceKey" in p) {
      const {
        id,
        name,
        company,
        email,
        ticketCode,
        type,
        status,
        source: recordSource,
        sourceKey,
      } = p;
      action(
        group,
        "Edit registration",
        "checkin_register",
        {
          rosterRevision: data.rosterRevision,
          people: [
            {
              id,
              name,
              company,
              email,
              ticketCode,
              type,
              status,
              source: recordSource,
              sourceKey,
            },
          ],
        },
        go,
      );
    }
  }
}
function proposalRows(
  data: WorkflowResults["posters_review_queue"],
  section: HTMLElement,
  go: Navigate,
) {
  section.append(element("h2", "Proposal review"));
  empty(section, data.proposals, "No proposals match this selection.");
  for (const p of data.proposals) {
    const row = record(
      section,
      p.title,
      [p.name, p.organization, p.status].filter(Boolean).join(" · "),
    );
    row.append(element("p", p.abstract));
    const group = buttons(row);
    action(
      group,
      "Review proposal",
      "posters_decide",
      { ...version(p), status: p.status },
      go,
    );
  }
}
function dinnerInvitation(
  data: WorkflowResults["dinner_read_invitation"],
  section: HTMLElement,
  go: Navigate,
  input: Inputs,
) {
  section.append(element("h2", "Dinner invitation for " + data.name));
  section.append(
    element(
      "p",
      data.response
        ? "Current reply: " + data.response.attendance.replaceAll("_", " ")
        : "No response yet.",
    ),
    element(
      "small",
      "Reply by " +
        stamp(data.replyBy) +
        ". Private responses expire " +
        stamp(data.retainUntil) +
        ".",
    ),
  );
  if (Date.parse(data.replyBy) >= Date.now())
    action(
      buttons(section),
      "Respond to dinner invitation",
      "dinner_respond",
      { token: input.token, revision: data.revision, ...(data.response ?? {}) },
      go,
    );
}
function speakerWorkspace(
  p: WorkflowResults["speaker_read_workspace"],
  section: HTMLElement,
  go: Navigate,
  input: Inputs,
  review: boolean,
) {
  const row = record(
    section,
    p.draft.title,
    p.draft.name + " · " + p.status.replaceAll("_", " "),
  );
  if (p.draft.bio) row.append(element("p", p.draft.bio));
  if (p.draft.abstract) row.append(element("p", p.draft.abstract));
  if (p.reviewNote) row.append(element("p", "Review note: " + p.reviewNote));
  const group = buttons(row),
    access = {
      talkId: p.talkId,
      ...(input.token ? { token: input.token } : {}),
    };
  action(
    group,
    p.canSetSharing ? "Edit profile and talk" : "Prepare draft for speaker",
    p.canSetSharing ? "speaker_submit" : "speaker_edit_draft",
    {
      ...access,
      revision: p.revision,
      ...p.draft,
      ...(p.canSetSharing ? { mayPublish: p.mayPublish } : {}),
    },
    go,
  );
  action(
    group,
    "Upload slides",
    "speaker_upload_material",
    { ...access, mayShare: false },
    go,
  );
  action(group, "Revision history", "speaker_revision_history", access, go);
  if (review && p.status === "submitted")
    action(
      group,
      "Review submission",
      "speaker_review",
      {
        talkId: p.talkId,
        revision: p.revision,
        decision: p.mayPublish ? "approve" : "request_changes",
      },
      go,
    );
  if (review) {
    action(
      group,
      "Replace invitation",
      "speaker_reissue",
      { talkId: p.talkId, revision: p.revision },
      go,
    );
    action(
      group,
      "Revoke invitation",
      "speaker_revoke",
      { talkId: p.talkId, revision: p.revision },
      go,
    );
  }
  for (const file of p.materials) {
    const fileRow = record(
      row,
      file.filename,
      file.published
        ? "Published"
        : file.mayShare
          ? "Available for organizer review"
          : "Private slides",
    );
    const controls = buttons(fileRow);
    action(
      controls,
      "Download PDF",
      "speaker_download_material",
      { ...access, materialId: file.id },
      go,
    );
    if (p.canSetSharing)
      action(
        controls,
        "Edit sharing permission",
        "speaker_material_permission",
        {
          ...access,
          materialId: file.id,
          revision: file.revision,
          mayShare: file.mayShare,
        },
        go,
      );
    if (review && (file.mayShare || file.published))
      action(
        controls,
        file.published ? "Unpublish PDF" : "Publish PDF",
        "speaker_publish_material",
        {
          materialId: file.id,
          revision: file.revision,
          publish: !file.published,
        },
        go,
      );
  }
}
function grantResult(
  data: { token: string; url?: string; delivery?: string },
  section: HTMLElement,
  operation: keyof WorkflowResults,
  title: string,
) {
  section.append(element("h2", title));
  const fallback = new URL(location.href);
  fallback.hash = new URLSearchParams({
    operation,
    input: JSON.stringify({ token: data.token }),
  }).toString();
  const link = element("a", "Open private link");
  link.href = data.url || fallback.href;
  link.rel = "noreferrer";
  section.append(link);
  const group = buttons(section),
    copy = element("button", "Copy private link");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link.href);
      copy.textContent = "Copied";
    } catch {
      const field = element("input");
      field.value = link.href;
      field.readOnly = true;
      field.setAttribute("aria-label", "Private link");
      group.append(field);
      field.select();
    }
  });
  group.append(copy);
  if (data.delivery)
    section.append(element("p", "Invitation delivery: " + data.delivery + "."));
}
export function renderWorkflowResult(
  op: UiOperation,
  payload: unknown,
  container: HTMLElement,
  _call: Call,
  navigate: Navigate,
  input: Inputs = {},
) {
  if (!owns(op.name) || !payload || typeof payload !== "object") return false;
  // The selected tool and its own HTTP result come from the same request.
  const { name, data } = { name: op.name, data: payload } as WorkflowResult;
  const section = element("section", undefined, "qa-queue");
  switch (name) {
    case "organizers_public":
    case "organizers_list":
      directoryRows(op, data, section, navigate);
      break;
    case "checkin_lookup":
    case "checkin_roster":
      deskRows(op, data, section, navigate, input);
      break;
    case "checkin_grants":
      section.append(element("h2", "Registration desks"));
      empty(section, data.grants, "No desk grants issued.");
      for (const g of data.grants) {
        const row = record(
          section,
          g.label,
          g.revoked ? "Revoked" : "Access until " + stamp(g.expiresAt),
        );
        if (!g.revoked)
          action(
            buttons(row),
            "Revoke access",
            "checkin_revoke_grant",
            { id: g.id },
            navigate,
          );
      }
      break;
    case "checkin_issue_grant":
      grantResult(data, section, "checkin_lookup", "Registration desk access");
      break;
    case "checkin_arrive":
    case "checkin_undo":
      section.append(
        element(
          "h2",
          data.arrivedAt ? "Arrival recorded" : "Arrival corrected",
        ),
      );
      action(
        buttons(section),
        "Look up another ticket",
        "checkin_lookup",
        input.token ? { token: input.token } : {},
        navigate,
      );
      break;
    case "posters_call":
      section.append(
        element(
          "h2",
          data.open
            ? "Poster submissions are open"
            : "Poster submissions are closed",
        ),
      );
      if ("deadline" in data)
        section.append(
          element("p", "Deadline: " + stamp(data.deadline)),
          element("p", data.consent),
        );
      if (data.open)
        action(
          buttons(section),
          "Submit a poster",
          "posters_submit",
          {},
          navigate,
        );
      action(
        buttons(section),
        "Edit call",
        "posters_configure_call",
        { revision: data.revision },
        navigate,
      );
      break;
    case "posters_review_queue":
      proposalRows(data, section, navigate);
      break;
    case "dinner_list":
      section.append(element("h2", "Dinner guests"));
      action(buttons(section), "Invite a guest", "dinner_invite", {}, navigate);
      empty(section, data.guests, "No invitations yet.");
      for (const g of data.guests) {
        const row = record(
          section,
          g.name,
          g.revoked
            ? "Invitation revoked"
            : g.response
              ? g.response.attendance.replaceAll("_", " ")
              : "Awaiting reply",
        );
        if (!g.revoked) {
          if (g.response?.diet) row.append(element("p", g.response.diet));
          action(
            buttons(row),
            "Revoke invitation",
            "dinner_revoke",
            version(g),
            navigate,
          );
        }
      }
      break;
    case "dinner_invite":
      grantResult(
        data,
        section,
        "dinner_read_invitation",
        "Private dinner invitation",
      );
      break;
    case "dinner_read_invitation":
      dinnerInvitation(data, section, navigate, input);
      break;
    case "dinner_respond":
      section.append(
        element("h2", "Dinner response saved"),
        element("p", data.response.attendance.replaceAll("_", " ")),
      );
      action(
        buttons(section),
        "Edit my response",
        "dinner_respond",
        { token: input.token, revision: data.revision, ...data.response },
        navigate,
      );
      break;
    case "speaker_assign":
    case "speaker_reissue":
      grantResult(
        data,
        section,
        "speaker_read_workspace",
        "Private speaker invitation",
      );
      break;
    case "speaker_read_workspace":
      speakerWorkspace(data, section, navigate, input, false);
      break;
    case "speaker_review_queue":
      section.append(element("h2", "Speaker workspaces"));
      action(buttons(section), "Assign a talk", "speaker_assign", {}, navigate);
      empty(section, data.workspaces, "No assigned speakers yet.");
      for (const workspace of data.workspaces)
        speakerWorkspace(workspace, section, navigate, {}, true);
      break;
    case "speaker_programme":
      section.append(element("h2", "Published talks"));
      empty(section, data.sessions, "No talks have been published yet.");
      for (const p of data.sessions) {
        const row = record(section, p.title, p.name);
        if (p.abstract) row.append(element("p", p.abstract));
        const group = buttons(row);
        for (const material of p.materials)
          action(
            group,
            "Download " + material.filename,
            "speaker_download_material",
            { materialId: material.id },
            navigate,
          );
      }
      break;
    default:
      return false;
  }
  container.append(section);
  return true;
}
