export {};

interface AdminSpeakerContent {
  profile: {
    bio: string;
    devto: string;
    github: string;
    linkedin: string;
    name: string;
    role: string;
    scholar: string;
    website: string;
    x: string;
  };
  talks: Array<{ abstract: string; id: string; title: string }>;
}

interface AdminSpeakerRevision {
  changed_fields: Array<{ before: string; field: string; value: string }>;
  content: AdminSpeakerContent | null;
  review_note: string | null;
  revision_id: string;
  state: "approved" | "draft" | "rejected" | "submitted";
  submitted_at: string | null;
  updated_at: string;
}

interface AdminSpeakerItem {
  canonical: AdminSpeakerContent;
  canonical_hash: string;
  canonical_photo: string;
  canonical_version: number;
  contact: {
    delivery_status: "active" | "suppressed";
    email: string | null;
    email_confirmed_at: string | null;
    operational_email_enabled: boolean;
    promotion_email_enabled: boolean;
    retention_until: string;
    updated_at: string;
  } | null;
  dinner: {
    expires_at: string;
    responded_at: string | null;
    response: {
      attendance: "attending" | "not_attending";
      cross_contamination: "" | "yes" | "no" | "unsure";
      food_requirements: string;
      meal_preference: "" | "omnivore" | "vegetarian" | "vegan" | "other";
    } | null;
    updated_at: string;
  } | null;
  invitation: {
    active: boolean;
    expires_at: string;
    last_sent_at: string | null;
  } | null;
  name: string;
  photo: {
    byte_size: number;
    image_url: string;
    photo_revision_id: string;
    review_note: string | null;
    state: "approved" | "rejected" | "submitted";
    updated_at: string;
  } | null;
  revision: AdminSpeakerRevision | null;
  speaker_id: string;
  workspace_only: boolean;
  videos: AdminSpeakerVideo[];
}

interface AdminSpeakerVideo {
  duration_seconds: number | null;
  error_code: string | null;
  permissions: {
    may_caption: boolean;
    may_crop: boolean;
    may_edit: boolean;
    may_excerpt: boolean;
    may_publish: boolean;
    permission_recorded_at: string;
    permission_text: string;
  };
  preview_endpoint: string | null;
  review_note: string | null;
  state:
    | "approved"
    | "changes_requested"
    | "error"
    | "processing"
    | "ready"
    | "upload_pending";
  submission_id: string;
  talk_id: string;
  updated_at: string;
}

interface AdminSpeakersResponse {
  count: number;
  error?: string;
  speakers: AdminSpeakerItem[];
}

interface AdminSpeakerContentResponse {
  error?: string;
  field_errors?: Record<string, string>;
  message?: string;
  state?: "approved" | "draft";
}

type EditorControl = HTMLInputElement | HTMLTextAreaElement;

interface EditorField {
  control: EditorControl;
  error: HTMLElement;
}

interface AnnouncementPreviewResponse {
  error?: string;
  excluded: Array<{ reason: string; speaker_id: string }>;
  html_body: string;
  recipient_count: number;
  recipients: Array<{ name: string; speaker_id: string }>;
  subject: string;
  text_body: string;
}

interface AnnouncementCampaign {
  campaign_id: string;
  category: "operational" | "promotion";
  completed_at: string | null;
  created_at: string;
  failed_count: number;
  recipient_count: number;
  sent_count: number;
  status: "failed" | "partial" | "sending" | "sent";
  subject: string;
}

const container = document.querySelector<HTMLElement>("[data-admin-speakers]");
const refreshButton = document.querySelector<HTMLButtonElement>(
  "[data-admin-speakers-refresh]",
);
const status = document.querySelector<HTMLElement>(
  "[data-admin-speakers-status]",
);
const announcementForm = document.querySelector<HTMLFormElement>(
  "[data-admin-announcement-form]",
);
const announcementSpeakers = document.querySelector<HTMLElement>(
  "[data-admin-announcement-speakers]",
);
const announcementStatus = document.querySelector<HTMLElement>(
  "[data-admin-announcement-status]",
);
const announcementPreviewPanel = document.querySelector<HTMLElement>(
  "[data-admin-announcement-preview-panel]",
);
const announcementConfirm = document.querySelector<HTMLInputElement>(
  "[data-admin-announcement-confirm]",
);
const announcementSend = document.querySelector<HTMLButtonElement>(
  "[data-admin-announcement-send]",
);
let previewedRecipientCount: number | null = null;

if (container) void loadSpeakers();

refreshButton?.addEventListener("click", () => void loadSpeakers());

async function loadSpeakers(): Promise<void> {
  setStatus("Loading");
  if (refreshButton) refreshButton.disabled = true;

  const response = await requestJson<AdminSpeakersResponse>(
    "/api/admin/speakers",
  );

  if (refreshButton) refreshButton.disabled = false;

  if (!response.ok || !Array.isArray(response.data.speakers)) {
    setStatus(
      response.data.error ?? "Speaker workspaces could not be loaded.",
      true,
    );
    return;
  }

  renderSummary(response.data.speakers);
  renderAnnouncementSpeakers(response.data.speakers);
  container?.replaceChildren(
    ...response.data.speakers.map((speaker) => renderSpeaker(speaker)),
  );
  setStatus(`Loaded ${response.data.speakers.length} speakers.`);
  void loadAnnouncementHistory();
}

document
  .querySelector<HTMLButtonElement>("[data-admin-announcement-select-all]")
  ?.addEventListener("click", () => setAnnouncementSelection(true));
document
  .querySelector<HTMLButtonElement>("[data-admin-announcement-select-none]")
  ?.addEventListener("click", () => setAnnouncementSelection(false));
document
  .querySelector<HTMLButtonElement>("[data-admin-announcement-preview]")
  ?.addEventListener("click", () => void previewAnnouncement());
document
  .querySelector<HTMLButtonElement>("[data-admin-announcement-test]")
  ?.addEventListener("click", () => void testAnnouncement());
announcementSend?.addEventListener("click", () => void sendAnnouncement());
announcementConfirm?.addEventListener("change", () => {
  if (announcementSend)
    announcementSend.disabled = !announcementConfirm.checked;
});
announcementForm?.addEventListener("input", (event) => {
  if (event.target === announcementConfirm) return;
  invalidateAnnouncementPreview();
});

function renderAnnouncementSpeakers(speakers: AdminSpeakerItem[]): void {
  if (!announcementSpeakers) return;

  announcementSpeakers.replaceChildren(
    ...speakers.map((speaker) => {
      const label = node(
        "label",
        "grid cursor-pointer grid-cols-[auto_1fr] gap-3 bg-ink p-3",
      );
      const checkbox = document.createElement("input");
      checkbox.className = "mt-1 h-5 w-5";
      checkbox.type = "checkbox";
      checkbox.name = "speaker_id";
      checkbox.value = speaker.speaker_id;
      checkbox.checked = true;
      const copy = node("span", "grid gap-1");
      copy.appendChild(node("strong", "uppercase", speaker.name));
      copy.appendChild(
        node(
          "span",
          "text-xs text-paper/60",
          speaker.contact?.email_confirmed_at
            ? "Signed-in operational contact"
            : speaker.contact?.email
              ? "Mapped / not signed in"
              : "No mapped email",
        ),
      );
      label.appendChild(checkbox);
      label.appendChild(copy);
      return label;
    }),
  );
}

function setAnnouncementSelection(selected: boolean): void {
  for (const checkbox of announcementSpeakers?.querySelectorAll<HTMLInputElement>(
    'input[name="speaker_id"]',
  ) ?? []) {
    checkbox.checked = selected;
  }
  invalidateAnnouncementPreview();
}

async function previewAnnouncement(): Promise<void> {
  const payload = readAnnouncementPayload();
  setAnnouncementStatus("Checking recipient eligibility…");

  const response = await requestJson<AnnouncementPreviewResponse>(
    "/api/admin/speakers/announcements/preview",
    {
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json",
        "x-admin-action": "preview-speaker-announcement",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    setAnnouncementStatus(
      response.data.error ?? "Announcement preview failed.",
      true,
    );
    return;
  }

  previewedRecipientCount = response.data.recipient_count;
  setAnnouncementPreview(response.data);
  setAnnouncementStatus(
    response.data.recipient_count > 0
      ? "Preview ready. Confirm the exact recipient count before sending."
      : "No selected speakers are currently eligible for this category.",
    response.data.recipient_count === 0,
  );
}

async function testAnnouncement(): Promise<void> {
  const payload = readAnnouncementPayload();
  const testEmail = announcementForm?.elements.namedItem("test_email");
  setAnnouncementStatus("Sending test message…");

  const response = await requestJson<{ error?: string; message?: string }>(
    "/api/admin/speakers/announcements/test",
    {
      body: JSON.stringify({
        ...payload,
        test_email:
          testEmail instanceof HTMLInputElement ? testEmail.value : "",
      }),
      headers: {
        "content-type": "application/json",
        "x-admin-action": "test-speaker-announcement",
      },
      method: "POST",
    },
  );
  setAnnouncementStatus(
    response.data.message ?? response.data.error ?? "Test delivery failed.",
    !response.ok,
  );
}

async function sendAnnouncement(): Promise<void> {
  if (previewedRecipientCount === null || !announcementConfirm?.checked) return;

  const payload = readAnnouncementPayload();
  if (announcementSend) announcementSend.disabled = true;
  setAnnouncementStatus(
    "Sending one separately addressed message per speaker…",
  );

  const response = await requestJson<{
    error?: string;
    failed_count?: number;
    message?: string;
  }>("/api/admin/speakers/announcements/send", {
    body: JSON.stringify({
      ...payload,
      confirm_recipient_count: previewedRecipientCount,
    }),
    headers: {
      "content-type": "application/json",
      "x-admin-action": "send-speaker-announcement",
    },
    method: "POST",
  });
  setAnnouncementStatus(
    response.data.message ?? response.data.error ?? "Announcement send failed.",
    !response.ok || Boolean(response.data.failed_count),
  );

  if (response.ok) {
    invalidateAnnouncementPreview();
    void loadAnnouncementHistory();
  } else if (announcementSend) {
    announcementSend.disabled = false;
  }
}

function readAnnouncementPayload(): {
  category: string;
  speaker_ids: string[];
  subject: string;
  text_body: string;
} {
  const formData = new FormData(announcementForm!);
  return {
    category: String(formData.get("category") ?? ""),
    speaker_ids: formData.getAll("speaker_id").map(String),
    subject: String(formData.get("subject") ?? ""),
    text_body: String(formData.get("text_body") ?? ""),
  };
}

function setAnnouncementPreview(preview: AnnouncementPreviewResponse): void {
  announcementPreviewPanel?.removeAttribute("hidden");
  setTextContent("[data-admin-announcement-text-preview]", preview.text_body);
  setTextContent(
    "[data-admin-announcement-recipient-count]",
    String(preview.recipient_count),
  );
  const recipientNames = preview.recipients.map(({ name }) => name).join(", ");
  const excluded = preview.excluded.length
    ? ` Excluded: ${preview.excluded.map(({ speaker_id, reason }) => `${speaker_id} (${reason})`).join(", ")}.`
    : "";
  setTextContent(
    "[data-admin-announcement-recipient-list]",
    `${recipientNames || "None"}.${excluded}`,
  );
  const frame = document.querySelector<HTMLIFrameElement>(
    "[data-admin-announcement-html-preview]",
  );
  if (frame) frame.srcdoc = preview.html_body;
  if (announcementConfirm) announcementConfirm.checked = false;
  if (announcementSend) announcementSend.disabled = true;
}

function invalidateAnnouncementPreview(): void {
  previewedRecipientCount = null;
  announcementPreviewPanel?.setAttribute("hidden", "");
  if (announcementConfirm) announcementConfirm.checked = false;
  if (announcementSend) announcementSend.disabled = true;
}

async function loadAnnouncementHistory(): Promise<void> {
  const history = document.querySelector<HTMLElement>(
    "[data-admin-announcement-history]",
  );
  if (!history) return;

  const response = await requestJson<{
    campaigns: AnnouncementCampaign[];
    error?: string;
  }>("/api/admin/speakers/announcements");

  if (!response.ok || !Array.isArray(response.data.campaigns)) {
    history.textContent =
      response.data.error ?? "Announcement history unavailable.";
    return;
  }

  if (response.data.campaigns.length === 0) {
    history.textContent = "No speaker announcements have been sent.";
    return;
  }

  history.replaceChildren(
    ...response.data.campaigns.map((campaign) => renderCampaign(campaign)),
  );
}

function renderCampaign(campaign: AnnouncementCampaign): HTMLElement {
  const row = node(
    "div",
    "grid gap-3 border border-paper/40 p-4 md:grid-cols-[1fr_auto] md:items-center",
  );
  const copy = node("div", "grid gap-1");
  copy.appendChild(node("strong", "uppercase", campaign.subject));
  copy.appendChild(
    node(
      "span",
      "text-xs text-paper/60",
      `${formatDate(campaign.created_at)} / ${campaign.category} / ${campaign.sent_count} sent / ${campaign.failed_count} failed`,
    ),
  );
  row.appendChild(copy);

  if (campaign.failed_count > 0) {
    const retry = node(
      "button",
      "border border-paper px-3 py-2 text-xs font-bold uppercase",
      "Retry failures",
    ) as HTMLButtonElement;
    retry.type = "button";
    retry.addEventListener("click", async () => {
      retry.disabled = true;
      const response = await requestJson<{ error?: string; message?: string }>(
        "/api/admin/speakers/announcements/retry",
        {
          body: JSON.stringify({ campaign_id: campaign.campaign_id }),
          headers: {
            "content-type": "application/json",
            "x-admin-action": "retry-speaker-announcement",
          },
          method: "POST",
        },
      );
      setAnnouncementStatus(
        response.data.message ?? response.data.error ?? "Retry failed.",
        !response.ok,
      );
      retry.disabled = false;
      if (response.ok) void loadAnnouncementHistory();
    });
    row.appendChild(retry);
  } else {
    row.appendChild(
      node(
        "span",
        "text-xs font-bold uppercase text-paper/60",
        campaign.status,
      ),
    );
  }

  return row;
}

function setAnnouncementStatus(message: string, isError = false): void {
  if (!announcementStatus) return;
  announcementStatus.textContent = message;
  announcementStatus.classList.toggle("text-red-300", isError);
  announcementStatus.classList.toggle("dark:text-red-700", isError);
}

function setTextContent(selector: string, value: string): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (target) target.textContent = value;
}

function renderSummary(speakers: AdminSpeakerItem[]): void {
  setCount("contacts", speakers.filter(({ contact }) => contact?.email).length);
  setCount(
    "confirmed",
    speakers.filter(({ contact }) => contact?.email_confirmed_at).length,
  );
  setCount(
    "submitted",
    speakers.filter(({ revision }) => revision?.state === "submitted").length,
  );
  setCount(
    "dinner",
    speakers.filter(({ dinner }) => dinner?.responded_at).length,
  );
}

function renderSpeaker(speaker: AdminSpeakerItem): HTMLElement {
  const article = node(
    "article",
    "grid gap-5 border border-paper/50 p-5 md:p-7",
  );
  const headingRow = node(
    "div",
    "grid gap-3 md:grid-cols-[1fr_auto] md:items-start",
  );
  const heading = node("div", "grid gap-1");
  const eyebrow = node(
    "p",
    "text-xs font-bold uppercase text-paper/60",
    speaker.workspace_only
      ? `Private test account / ${speaker.speaker_id}`
      : speaker.speaker_id,
  );
  const title = node(
    "h3",
    "font-headline text-3xl font-black uppercase",
    speaker.name,
  );
  const badge = node(
    "span",
    "w-fit border border-paper/60 px-3 py-2 text-xs font-bold uppercase",
    revisionLabel(speaker.revision),
  );
  heading.appendChild(eyebrow);
  heading.appendChild(title);
  headingRow.appendChild(heading);
  headingRow.appendChild(badge);
  article.appendChild(headingRow);
  article.appendChild(renderInvitation(speaker));
  article.appendChild(renderContentEditor(speaker));
  article.appendChild(renderDinner(speaker));

  if (speaker.photo) {
    article.appendChild(renderPhoto(speaker));
  }

  if (speaker.videos.length > 0) {
    article.appendChild(renderVideos(speaker));
  }

  if (speaker.revision) {
    article.appendChild(renderRevision(speaker));
  }

  return article;
}

function renderContentEditor(speaker: AdminSpeakerItem): HTMLElement {
  const details = node(
    "details",
    "border-t border-paper/40 pt-5",
  ) as HTMLDetailsElement;
  const summary = node(
    "summary",
    "cursor-pointer font-headline text-2xl font-black uppercase",
    "Edit speaker details",
  );
  const body = node("div", "mt-5 grid gap-6 border border-paper/40 p-4 md:p-6");
  const introduction = node("div", "grid gap-2");
  introduction.appendChild(
    node("p", "font-bold uppercase", "Organizer editor / public content"),
  );
  introduction.appendChild(
    node(
      "p",
      "max-w-4xl text-sm leading-6 text-paper/70",
      "Start from the latest valid revision or the published profile. Save a draft to prefill the speaker workspace, or approve and publish the edit immediately.",
    ),
  );
  body.appendChild(introduction);

  const form = node("form", "grid gap-7") as HTMLFormElement;
  const fields = new Map<string, EditorField>();
  const content = speaker.revision?.content ?? speaker.canonical;
  const profileSection = node("fieldset", "grid gap-5");
  const profileLegend = node(
    "legend",
    "font-headline text-xl font-black uppercase",
    "Profile",
  );
  const profileGrid = node("div", "mt-4 grid gap-5 md:grid-cols-2");
  profileSection.appendChild(profileLegend);
  profileGrid.appendChild(
    createEditorField({
      fields,
      label: "Name",
      maxLength: 120,
      minLength: 2,
      name: "profile.name",
      speakerId: speaker.speaker_id,
      value: content.profile.name,
    }),
  );
  profileGrid.appendChild(
    createEditorField({
      fields,
      label: "Role / organization",
      maxLength: 160,
      minLength: 2,
      name: "profile.role",
      speakerId: speaker.speaker_id,
      value: content.profile.role,
    }),
  );
  const bioField = createEditorField({
    fields,
    label: "Bio",
    maxLength: 2000,
    minLength: 40,
    multiline: true,
    name: "profile.bio",
    speakerId: speaker.speaker_id,
    value: content.profile.bio,
  });
  bioField.classList.add("md:col-span-2");
  profileGrid.appendChild(bioField);
  profileSection.appendChild(profileGrid);
  form.appendChild(profileSection);

  const socialSection = node(
    "fieldset",
    "grid gap-5 border-t border-paper/30 pt-6",
  );
  socialSection.appendChild(
    node(
      "legend",
      "pr-3 font-headline text-xl font-black uppercase",
      "Social links",
    ),
  );
  const socialGrid = node("div", "grid gap-5 md:grid-cols-2");
  const socialLabels = [
    ["website", "Website"],
    ["linkedin", "LinkedIn"],
    ["x", "X / Twitter"],
    ["github", "GitHub"],
    ["devto", "DEV Community"],
    ["scholar", "Google Scholar"],
  ] as const;
  for (const [field, label] of socialLabels) {
    socialGrid.appendChild(
      createEditorField({
        fields,
        label,
        maxLength: 2048,
        name: `profile.${field}`,
        speakerId: speaker.speaker_id,
        type: "url",
        value: content.profile[field] ?? "",
      }),
    );
  }
  socialSection.appendChild(socialGrid);
  form.appendChild(socialSection);

  const talksSection = node(
    "fieldset",
    "grid gap-5 border-t border-paper/30 pt-6",
  );
  talksSection.appendChild(
    node(
      "legend",
      "pr-3 font-headline text-xl font-black uppercase",
      "Assigned talks",
    ),
  );
  for (const [index, canonicalTalk] of speaker.canonical.talks.entries()) {
    const talk =
      content.talks.find(({ id }) => id === canonicalTalk.id) ?? canonicalTalk;
    const talkGroup = node("div", "grid gap-5 border border-paper/30 p-4");
    talkGroup.appendChild(
      node("p", "text-xs font-bold uppercase text-paper/60", canonicalTalk.id),
    );
    talkGroup.appendChild(
      createEditorField({
        fields,
        label: "Talk title",
        maxLength: 200,
        minLength: 4,
        name: `talks.${index}.title`,
        speakerId: speaker.speaker_id,
        value: talk.title,
      }),
    );
    talkGroup.appendChild(
      createEditorField({
        fields,
        label: "Talk description",
        maxLength: 2500,
        minLength: 20,
        multiline: true,
        name: `talks.${index}.abstract`,
        speakerId: speaker.speaker_id,
        value: talk.abstract,
      }),
    );
    talksSection.appendChild(talkGroup);
  }
  form.appendChild(talksSection);

  const actions = node(
    "div",
    "grid gap-4 border-t border-paper/30 pt-6 md:grid-cols-[1fr_auto_auto] md:items-end",
  );
  const editorStatus = node(
    "p",
    "min-h-6 text-sm font-bold uppercase text-paper/70",
  );
  editorStatus.setAttribute("aria-live", "polite");
  const saveDraft = reviewButton("Save as speaker draft", false);
  const approve = reviewButton("Approve & publish", true);
  actions.appendChild(editorStatus);
  actions.appendChild(saveDraft);
  actions.appendChild(approve);
  form.appendChild(actions);
  form.addEventListener("submit", (event) => event.preventDefault());
  saveDraft.addEventListener("click", () => {
    void submitAdminContent(
      speaker,
      form,
      fields,
      "draft",
      editorStatus,
      saveDraft,
      approve,
    );
  });
  approve.addEventListener("click", () => {
    void submitAdminContent(
      speaker,
      form,
      fields,
      "approve",
      editorStatus,
      saveDraft,
      approve,
    );
  });
  body.appendChild(form);
  body.appendChild(renderAdminPhotoUpload(speaker));
  details.appendChild(summary);
  details.appendChild(body);
  return details;
}

function createEditorField({
  fields,
  label,
  maxLength,
  minLength,
  multiline = false,
  name,
  speakerId,
  type = "text",
  value,
}: {
  fields: Map<string, EditorField>;
  label: string;
  maxLength: number;
  minLength?: number;
  multiline?: boolean;
  name: string;
  speakerId: string;
  type?: string;
  value: string;
}): HTMLLabelElement {
  const wrapper = node("label", "grid gap-2");
  const labelText = node("span", "text-sm font-bold uppercase", label);
  const control = multiline
    ? document.createElement("textarea")
    : document.createElement("input");
  control.className = multiline
    ? "min-h-32 w-full resize-y border border-paper bg-ink px-4 py-3 leading-6 text-paper outline-none focus:ring-2 focus:ring-paper"
    : "w-full border border-paper bg-ink px-4 py-3 text-paper outline-none focus:ring-2 focus:ring-paper";
  control.name = name;
  control.maxLength = maxLength;
  control.required = Boolean(minLength);
  if (minLength) control.minLength = minLength;
  if (control instanceof HTMLInputElement) control.type = type;
  control.value = value;
  const errorId = `admin-${speakerId}-${name.replace(/[^a-z0-9]+/giu, "-")}-error`;
  const error = node(
    "span",
    "min-h-5 text-xs font-bold text-red-300 dark:text-red-700",
  );
  error.id = errorId;
  control.setAttribute("aria-describedby", errorId);
  wrapper.appendChild(labelText);
  wrapper.appendChild(control);
  wrapper.appendChild(error);
  fields.set(name, { control, error });
  return wrapper as HTMLLabelElement;
}

async function submitAdminContent(
  speaker: AdminSpeakerItem,
  form: HTMLFormElement,
  fields: Map<string, EditorField>,
  mode: "approve" | "draft",
  editorStatus: HTMLElement,
  ...buttons: HTMLButtonElement[]
): Promise<void> {
  clearEditorErrors(fields);
  if (!form.reportValidity()) return;
  for (const button of buttons) button.disabled = true;
  setEditorStatus(
    editorStatus,
    mode === "approve"
      ? "Approving organizer edit…"
      : "Saving organizer draft…",
  );
  const response = await requestJson<AdminSpeakerContentResponse>(
    "/api/admin/speakers/content",
    {
      body: JSON.stringify({
        base_content_hash: speaker.canonical_hash,
        base_content_version: speaker.canonical_version,
        content: readEditorContent(speaker, fields),
        mode,
        speaker_id: speaker.speaker_id,
      }),
      headers: {
        "content-type": "application/json",
        "x-admin-action": "save-speaker-content",
      },
      method: "POST",
    },
  );
  for (const button of buttons) button.disabled = false;

  if (!response.ok) {
    showEditorErrors(fields, response.data.field_errors);
    setEditorStatus(
      editorStatus,
      response.data.error ?? "Speaker details could not be saved.",
      true,
    );
    return;
  }

  const message = response.data.message ?? "Speaker details saved.";
  await loadSpeakers();
  setStatus(message);
}

function readEditorContent(
  speaker: AdminSpeakerItem,
  fields: Map<string, EditorField>,
): AdminSpeakerContent {
  const value = (name: string) => fields.get(name)?.control.value ?? "";

  return {
    profile: {
      bio: value("profile.bio"),
      devto: value("profile.devto"),
      github: value("profile.github"),
      linkedin: value("profile.linkedin"),
      name: value("profile.name"),
      role: value("profile.role"),
      scholar: value("profile.scholar"),
      website: value("profile.website"),
      x: value("profile.x"),
    },
    talks: speaker.canonical.talks.map((talk, index) => ({
      abstract: value(`talks.${index}.abstract`),
      id: talk.id,
      title: value(`talks.${index}.title`),
    })),
  };
}

function clearEditorErrors(fields: Map<string, EditorField>): void {
  for (const { control, error } of fields.values()) {
    control.removeAttribute("aria-invalid");
    error.textContent = "";
  }
}

function showEditorErrors(
  fields: Map<string, EditorField>,
  errors: Record<string, string> | undefined,
): void {
  for (const [name, message] of Object.entries(errors ?? {})) {
    const field = fields.get(name);
    if (!field) continue;
    field.control.setAttribute("aria-invalid", "true");
    field.error.textContent = message;
  }
}

function setEditorStatus(
  target: HTMLElement,
  message: string,
  isError = false,
): void {
  target.textContent = message;
  target.classList.toggle("text-red-300", isError);
  target.classList.toggle("dark:text-red-700", isError);
}

function renderAdminPhotoUpload(speaker: AdminSpeakerItem): HTMLElement {
  const section = node(
    "section",
    "grid gap-4 border-t border-paper/30 pt-6 md:grid-cols-[6rem_1fr_auto] md:items-end",
  );
  const preview = document.createElement("img");
  preview.className = "aspect-square w-24 border border-paper/50 object-cover";
  preview.src = speaker.photo?.image_url ?? speaker.canonical_photo;
  preview.alt = `${speaker.name}'s current working portrait`;
  preview.width = 400;
  preview.height = 400;
  preview.loading = "lazy";
  preview.decoding = "async";
  const label = node("label", "grid gap-2");
  label.appendChild(
    node("span", "text-sm font-bold uppercase", "Replace portrait"),
  );
  label.appendChild(
    node(
      "span",
      "text-xs leading-5 text-paper/60",
      "JPEG, PNG, or WebP / at least 400 × 400 / maximum 5 MB. Organizer uploads are processed and approved immediately.",
    ),
  );
  const input = document.createElement("input");
  input.className =
    "w-full border border-paper px-3 py-3 text-sm file:mr-4 file:border-0 file:bg-paper file:px-3 file:py-2 file:font-bold file:uppercase file:text-ink";
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  const status = node(
    "p",
    "min-h-5 text-xs font-bold uppercase text-paper/70 md:col-span-3",
  );
  status.setAttribute("aria-live", "polite");
  const button = reviewButton("Process & approve portrait", true);
  label.appendChild(input);
  section.appendChild(preview);
  section.appendChild(label);
  section.appendChild(button);
  section.appendChild(status);
  button.addEventListener("click", async () => {
    const file = input.files?.[0];
    if (!file) {
      setEditorStatus(status, "Choose a portrait first.", true);
      return;
    }
    button.disabled = true;
    setEditorStatus(status, "Processing portrait…");
    const response = await requestJson<{ error?: string; message?: string }>(
      `/api/admin/speakers/photos/upload?speaker_id=${encodeURIComponent(speaker.speaker_id)}`,
      {
        body: file,
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-admin-action": "upload-speaker-photo",
        },
        method: "POST",
      },
    );
    button.disabled = false;
    if (!response.ok) {
      setEditorStatus(
        status,
        response.data.error ?? "Portrait could not be processed.",
        true,
      );
      return;
    }
    const message = response.data.message ?? "Portrait processed.";
    await loadSpeakers();
    setStatus(message);
  });
  return section;
}

function renderVideos(speaker: AdminSpeakerItem): HTMLElement {
  const section = node("section", "grid gap-4 border-t border-paper/40 pt-5");
  section.appendChild(
    node("h4", "font-headline text-2xl font-black uppercase", "Topic videos"),
  );
  for (const video of speaker.videos) {
    const card = node("article", "grid gap-3 border border-paper/40 p-4");
    const title = speaker.canonical.talks.find(
      ({ id }) => id === video.talk_id,
    )?.title;
    card.appendChild(
      node("strong", "uppercase", `${title ?? video.talk_id} / ${video.state}`),
    );
    card.appendChild(
      node(
        "p",
        "text-xs text-paper/60",
        `${video.duration_seconds ? `${Math.round(video.duration_seconds)} seconds / ` : ""}${formatDate(video.updated_at)}`,
      ),
    );
    const allowed = Object.entries(video.permissions)
      .filter(([key, value]) => key.startsWith("may_") && value === true)
      .map(([key]) => key.replace("may_", "").replace("_", " "));
    card.appendChild(
      node(
        "p",
        "text-sm text-paper/70",
        `Recorded permission: ${allowed.join(", ") || "none"}.`,
      ),
    );

    if (video.review_note || video.error_code) {
      card.appendChild(
        node(
          "p",
          "border-l border-paper/60 pl-4 text-sm",
          video.review_note ?? video.error_code ?? "",
        ),
      );
    }

    const actions = node("div", "flex flex-wrap gap-3");
    if (video.preview_endpoint) {
      const preview = reviewButton("Private preview", false);
      preview.addEventListener(
        "click",
        () => void openAdminVideoPreview(video, preview),
      );
      actions.appendChild(preview);
    }

    if (video.state === "ready") {
      const approve = reviewButton("Approve video", true);
      const changes = reviewButton("Request changes", false);
      const note = document.createElement("textarea");
      note.className =
        "min-h-20 w-full resize-y border border-paper bg-ink px-3 py-2 text-paper";
      note.maxLength = 1000;
      note.placeholder = "Review note (required when requesting changes)";
      approve.addEventListener(
        "click",
        () =>
          void submitVideoReview(
            video,
            "approve",
            note.value,
            approve,
            changes,
          ),
      );
      changes.addEventListener(
        "click",
        () =>
          void submitVideoReview(
            video,
            "request_changes",
            note.value,
            approve,
            changes,
          ),
      );
      card.appendChild(note);
      actions.appendChild(approve);
      actions.appendChild(changes);
    }

    card.appendChild(actions);
    section.appendChild(card);
  }
  return section;
}

async function openAdminVideoPreview(
  video: AdminSpeakerVideo,
  button: HTMLButtonElement,
): Promise<void> {
  if (!video.preview_endpoint) return;
  const previewWindow = window.open("about:blank", "_blank");
  if (previewWindow) previewWindow.opener = null;
  button.disabled = true;
  const response = await requestJson<{ error?: string; preview_url?: string }>(
    video.preview_endpoint,
  );
  button.disabled = false;
  if (!response.ok || !response.data.preview_url) {
    previewWindow?.close();
    setStatus(response.data.error ?? "Private preview is unavailable.", true);
    return;
  }
  if (previewWindow) previewWindow.location.href = response.data.preview_url;
}

async function submitVideoReview(
  video: AdminSpeakerVideo,
  decision: "approve" | "request_changes",
  reviewNote: string,
  ...buttons: HTMLButtonElement[]
): Promise<void> {
  for (const button of buttons) button.disabled = true;
  setStatus(
    decision === "approve" ? "Approving video…" : "Requesting video changes…",
  );
  const response = await requestJson<{ error?: string; message?: string }>(
    "/api/admin/speakers/videos/review",
    {
      body: JSON.stringify({
        decision,
        review_note: reviewNote,
        submission_id: video.submission_id,
      }),
      headers: {
        "content-type": "application/json",
        "x-admin-action": "review-speaker-video",
      },
      method: "POST",
    },
  );
  for (const button of buttons) button.disabled = false;
  setStatus(
    response.data.message ?? response.data.error ?? "Video review failed.",
    !response.ok,
  );
  if (response.ok) void loadSpeakers();
}

function renderPhoto(speaker: AdminSpeakerItem): HTMLElement {
  const photo = speaker.photo!;
  const section = node(
    "section",
    "grid gap-4 border-t border-paper/40 pt-5 md:grid-cols-[10rem_1fr]",
  );
  const image = document.createElement("img");
  image.className = "aspect-square w-full border border-paper/50 object-cover";
  image.src = photo.image_url;
  image.alt = `Proposed portrait for ${speaker.name}`;
  image.width = 400;
  image.height = 400;
  image.loading = "lazy";
  image.decoding = "async";
  const copy = node("div", "grid content-start gap-3");
  copy.appendChild(
    node(
      "h4",
      "font-headline text-2xl font-black uppercase",
      `Portrait / ${photo.state}`,
    ),
  );
  copy.appendChild(
    node(
      "p",
      "text-sm text-paper/60",
      `400 × 400 WebP / ${Math.ceil(photo.byte_size / 1024)} KB / ${formatDate(photo.updated_at)}`,
    ),
  );
  const download = document.createElement("a");
  download.className =
    "w-fit border border-paper px-3 py-2 text-sm font-bold uppercase";
  download.href = `${photo.image_url}${photo.image_url.includes("?") ? "&" : "?"}download=1`;
  download.textContent = "Download derivative";
  copy.appendChild(download);

  if (photo.state === "submitted") {
    const note = document.createElement("textarea");
    note.className =
      "min-h-20 w-full resize-y border border-paper bg-ink px-3 py-2 text-paper";
    note.maxLength = 1000;
    note.placeholder = "Review note (required when requesting another photo)";
    const actions = node("div", "flex flex-wrap gap-3");
    const approve = reviewButton("Approve portrait", true);
    const reject = reviewButton("Request another", false);
    approve.addEventListener(
      "click",
      () =>
        void submitPhotoReview(speaker, "approve", note.value, approve, reject),
    );
    reject.addEventListener(
      "click",
      () =>
        void submitPhotoReview(speaker, "reject", note.value, approve, reject),
    );
    actions.appendChild(approve);
    actions.appendChild(reject);
    copy.appendChild(note);
    copy.appendChild(actions);
  } else if (photo.review_note) {
    copy.appendChild(
      node("p", "border-l border-paper/60 pl-4 text-sm", photo.review_note),
    );
  }

  section.appendChild(image);
  section.appendChild(copy);
  return section;
}

async function submitPhotoReview(
  speaker: AdminSpeakerItem,
  decision: "approve" | "reject",
  reviewNote: string,
  ...buttons: HTMLButtonElement[]
): Promise<void> {
  for (const button of buttons) button.disabled = true;
  setStatus(
    decision === "approve"
      ? "Approving portrait…"
      : "Requesting another portrait…",
  );
  const response = await requestJson<{ error?: string; message?: string }>(
    "/api/admin/speakers/photos/review",
    {
      body: JSON.stringify({
        decision,
        photo_revision_id: speaker.photo?.photo_revision_id,
        review_note: reviewNote,
      }),
      headers: {
        "content-type": "application/json",
        "x-admin-action": "review-speaker-photo",
      },
      method: "POST",
    },
  );
  for (const button of buttons) button.disabled = false;
  setStatus(
    response.data.message ?? response.data.error ?? "Photo review failed.",
    !response.ok,
  );
  if (response.ok) void loadSpeakers();
}

function renderInvitation(speaker: AdminSpeakerItem): HTMLElement {
  const region = node(
    "form",
    "grid gap-x-3 gap-y-2 border-t border-paper/40 pt-5 md:grid-cols-[minmax(0,1fr)_auto]",
  ) as HTMLFormElement;
  const label = node("label", "grid gap-2 md:col-start-1 md:row-start-1");
  const labelText = node("span", "font-bold uppercase", "Speaker email");
  const input = document.createElement("input");
  input.className =
    "w-full border border-paper bg-ink px-4 py-3 text-paper outline-none focus:ring-2 focus:ring-paper";
  input.type = "email";
  input.name = "email";
  input.autocomplete = "email";
  input.required = true;
  input.value = speaker.contact?.email ?? "";
  const help = node(
    "span",
    "text-xs text-paper/60 md:col-start-1 md:row-start-2",
    invitationHelp(speaker),
  );
  const button = node(
    "button",
    "border border-paper bg-paper px-5 py-3 font-bold uppercase text-ink transition hover:bg-ink hover:text-paper disabled:cursor-wait disabled:opacity-60 md:col-start-2 md:row-start-1 md:self-end",
    "Save email",
  ) as HTMLButtonElement;
  button.type = "submit";
  label.appendChild(labelText);
  label.appendChild(input);
  region.appendChild(label);
  region.appendChild(help);
  region.appendChild(button);

  region.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    help.textContent = "Saving encrypted contact…";

    const response = await requestJson<{ error?: string; message?: string }>(
      "/api/admin/speakers/contact",
      {
        body: JSON.stringify({
          email: input.value,
          speaker_id: speaker.speaker_id,
        }),
        headers: {
          "content-type": "application/json",
          "x-admin-action": "save-speaker-contact",
        },
        method: "POST",
      },
    );

    button.disabled = false;
    help.textContent = response.ok
      ? (response.data.message ?? "Email saved.")
      : (response.data.error ?? "Email could not be saved.");

    if (response.ok) void loadSpeakers();
  });

  return region;
}

function renderDinner(speaker: AdminSpeakerItem): HTMLElement {
  const section = node("section", "grid gap-3 border-t border-paper/40 pt-5");
  const heading = node(
    "div",
    "grid gap-1 sm:grid-cols-[1fr_auto] sm:items-start",
  );
  const copy = node("div", "grid gap-1");
  copy.appendChild(
    node("h4", "font-headline text-2xl font-black uppercase", "Dinner"),
  );
  copy.appendChild(
    node(
      "p",
      "text-xs font-bold uppercase text-paper/60",
      "Private logistics / not published",
    ),
  );
  heading.appendChild(copy);

  if (speaker.dinner?.responded_at) {
    heading.appendChild(
      node(
        "span",
        "w-fit border border-paper/50 px-3 py-2 text-xs font-bold uppercase",
        formatDate(speaker.dinner.responded_at),
      ),
    );
  }

  section.appendChild(heading);

  const response = speaker.dinner?.response;

  if (!response) {
    section.appendChild(
      node(
        "p",
        "text-sm text-paper/60",
        "No dinner response has been saved yet.",
      ),
    );
    return section;
  }

  if (response.attendance === "not_attending") {
    section.appendChild(
      node("p", "font-bold uppercase", "Not attending the speakers’ dinner"),
    );
    return section;
  }

  const details = node("dl", "grid gap-px bg-paper/30 sm:grid-cols-3");
  details.appendChild(
    dinnerDetail("Meal", dinnerValueLabel(response.meal_preference)),
  );
  details.appendChild(
    dinnerDetail(
      "Cross-contamination",
      dinnerValueLabel(response.cross_contamination),
    ),
  );
  details.appendChild(
    dinnerDetail("Requirements", response.food_requirements || "None stated"),
  );
  section.appendChild(details);
  return section;
}

function dinnerDetail(label: string, value: string): HTMLElement {
  const item = node("div", "grid gap-1 bg-ink p-3");
  item.appendChild(
    node("dt", "text-xs font-bold uppercase text-paper/50", label),
  );
  item.appendChild(node("dd", "whitespace-pre-wrap text-sm", value));
  return item;
}

function dinnerValueLabel(value: string): string {
  if (!value) return "Not stated";
  return `${value.charAt(0).toUpperCase()}${value.slice(1).replaceAll("_", " ")}`;
}

function renderRevision(speaker: AdminSpeakerItem): HTMLElement {
  const revision = speaker.revision!;
  const section = node("section", "grid gap-4 border-t border-paper/40 pt-5");
  const heading = node(
    "h4",
    "font-headline text-2xl font-black uppercase",
    `Revision / ${revision.state}`,
  );
  section.appendChild(heading);

  if (revision.changed_fields.length > 0) {
    const changes = node("div", "grid gap-3");
    for (const change of revision.changed_fields) {
      changes.appendChild(renderChange(change));
    }
    section.appendChild(changes);
  } else {
    section.appendChild(
      node(
        "p",
        "text-sm text-paper/60",
        revision.content
          ? "This revision matches the current public content."
          : "The stored revision could not be parsed.",
      ),
    );
  }

  if (revision.state === "submitted") {
    section.appendChild(renderReviewActions(speaker));
  } else if (revision.state === "approved" && revision.content) {
    section.appendChild(
      node(
        "p",
        "border-l border-paper/60 pl-4 text-sm",
        "Published from D1. This revision remains available as an audit record.",
      ),
    );
  } else if (revision.review_note) {
    section.appendChild(
      node("p", "border-l border-paper/60 pl-4 text-sm", revision.review_note),
    );
  }

  return section;
}

function renderChange(change: {
  before: string;
  field: string;
  value: string;
}): HTMLElement {
  const details = node("details", "border border-paper/40 p-4");
  const summary = node(
    "summary",
    "cursor-pointer font-bold uppercase",
    change.field,
  );
  const columns = node("div", "mt-4 grid gap-4 md:grid-cols-2");
  const before = node("div", "grid gap-2");
  const after = node("div", "grid gap-2");
  before.appendChild(
    node("p", "text-xs font-bold uppercase text-paper/50", "Published"),
  );
  before.appendChild(
    node("p", "whitespace-pre-wrap text-sm leading-6", change.before || "—"),
  );
  after.appendChild(
    node("p", "text-xs font-bold uppercase text-paper/50", "Proposed"),
  );
  after.appendChild(
    node("p", "whitespace-pre-wrap text-sm leading-6", change.value || "—"),
  );
  columns.appendChild(before);
  columns.appendChild(after);
  details.appendChild(summary);
  details.appendChild(columns);
  return details;
}

function renderReviewActions(speaker: AdminSpeakerItem): HTMLElement {
  const region = node("div", "grid gap-3 border border-paper/40 p-4");
  const label = node("label", "grid gap-2");
  const labelText = node("span", "text-sm font-bold uppercase", "Review note");
  const textarea = document.createElement("textarea");
  textarea.className =
    "min-h-24 w-full resize-y border border-paper bg-ink px-4 py-3 text-paper outline-none focus:ring-2 focus:ring-paper";
  textarea.maxLength = 1000;
  const actions = node("div", "flex flex-wrap gap-3");
  const approve = reviewButton("Approve & publish", true);
  const reject = reviewButton("Request changes", false);
  label.appendChild(labelText);
  label.appendChild(textarea);
  actions.appendChild(approve);
  actions.appendChild(reject);
  region.appendChild(label);
  region.appendChild(actions);

  approve.addEventListener(
    "click",
    () =>
      void submitReview(speaker, "approve", textarea.value, approve, reject),
  );
  reject.addEventListener(
    "click",
    () => void submitReview(speaker, "reject", textarea.value, approve, reject),
  );

  return region;
}

function reviewButton(label: string, primary: boolean): HTMLButtonElement {
  const button = node(
    "button",
    primary
      ? "border border-paper bg-paper px-4 py-3 font-bold uppercase text-ink"
      : "border border-paper px-4 py-3 font-bold uppercase",
    label,
  ) as HTMLButtonElement;
  button.type = "button";
  return button;
}

async function submitReview(
  speaker: AdminSpeakerItem,
  decision: "approve" | "reject",
  reviewNote: string,
  ...buttons: HTMLButtonElement[]
): Promise<void> {
  for (const button of buttons) button.disabled = true;
  setStatus(
    decision === "approve" ? "Approving revision…" : "Returning draft…",
  );

  const response = await requestJson<{ error?: string; message?: string }>(
    "/api/admin/speakers/review",
    {
      body: JSON.stringify({
        decision,
        review_note: reviewNote,
        revision_id: speaker.revision?.revision_id,
      }),
      headers: {
        "content-type": "application/json",
        "x-admin-action": "review-speaker-revision",
      },
      method: "POST",
    },
  );

  for (const button of buttons) button.disabled = false;
  setStatus(
    response.data.message ??
      response.data.error ??
      "Review could not be saved.",
    !response.ok,
  );
  if (response.ok) void loadSpeakers();
}

function invitationHelp(speaker: AdminSpeakerItem): string {
  if (!speaker.contact?.email)
    return "Add an email so this speaker can request a sign-in link.";
  if (!speaker.contact.email_confirmed_at) {
    return "Mapped / speaker has not signed in yet.";
  }
  return `Signed in / ${formatDate(speaker.contact.email_confirmed_at)}`;
}

function revisionLabel(revision: AdminSpeakerRevision | null): string {
  if (!revision) return "No revision";
  return {
    approved: "Published from D1",
    draft: "Speaker draft",
    rejected: "Changes requested",
    submitted: "Awaiting review",
  }[revision.state];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function setCount(name: string, value: number): void {
  const target = document.querySelector<HTMLElement>(
    `[data-admin-speaker-count="${name}"]`,
  );
  if (target) target.textContent = String(value);
}

function setStatus(message: string, isError = false): void {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("text-red-300", isError);
  status.classList.toggle("dark:text-red-700", isError);
}

function node<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(name);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; ok: boolean }> {
  try {
    const response = await fetch(url, { credentials: "same-origin", ...init });
    return { data: (await response.json()) as T, ok: response.ok };
  } catch {
    return {
      data: { error: "The admin API could not be reached." } as T,
      ok: false,
    };
  }
}
