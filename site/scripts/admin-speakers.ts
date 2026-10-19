export {};
import {
  maxSlideFileBytes,
  slideContentTypes,
  slideFormatFromFilename,
  slideFormatLabel,
  type SpeakerSlideFile,
  type SpeakerSlideLink,
  type SpeakerRecordingLink,
} from "./speaker-slides-model.ts";

interface AdminSpeakerContent {
  profile: {
    company: string;
    bio: string;
    devto: string;
    github: string;
    linkedin: string;
    name: string;
    honorific: string;
    credentials: string;
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
    secondary_email: string | null;
    secondary_email_confirmed_at: string | null;
    operational_email_enabled: boolean;
    promotion_email_enabled: boolean;
    retention_until: string;
    updated_at: string;
  } | null;
  dinner: {
    attendance_source: "admin" | "speaker";
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
  presentation: {
    expires_at: string;
    responded_at: string;
    response: {
      delivery_method: "advance_materials" | "own_laptop";
      material_format: "" | "pdf" | "powerpoint" | "web";
      material_url: string;
    } | null;
    updated_at: string;
  } | null;
  revision: AdminSpeakerRevision | null;
  speaker_id: string;
  workspace_only: boolean;
  videos: AdminSpeakerVideo[];
  slides: SpeakerSlideFile[];
  slide_links: SpeakerSlideLink[];
  recording_links: SpeakerRecordingLink[];
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
  excluded: Array<{ reason: string; speaker_id: string; name?: string }>;
  preview_token: string;
  audience_counts: { speakers_only: number; dinner_only: number; both: number };
  variants: Array<{ label: string; text_body: string; html_body: string }>;
  html_body: string;
  recipient_count: number;
  recipients: Array<{ name: string; speaker_id: string; groups: string[] }>;
  subject: string;
  text_body: string;
}

interface AnnouncementCampaign {
  text_body: string;
  speaker_text_body: string;
  dinner_text_body: string;
  closing_text_body: string;
  deliveries: Array<{
    name: string;
    source_ids: string | null;
    speaker_id: string;
    status: string;
    sent_at: string | null;
  }>;
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
const announcementHtmlPreview = document.querySelector<HTMLIFrameElement>(
  "[data-admin-announcement-html-preview]",
);
const announcementConfirm = document.querySelector<HTMLInputElement>(
  "[data-admin-announcement-confirm]",
);
const announcementSend = document.querySelector<HTMLButtonElement>(
  "[data-admin-announcement-send]",
);
let previewedRecipientCount: number | null = null;
let previewToken: string | null = null;
let announcementBusy = false;
let announcementPreviewResizeObserver: ResizeObserver | null = null;
const announcementDraftKey = "sdlcai-announcement-draft-v1";
const announcementDraftFields = [
  "category",
  "subject",
  "text_body",
  "speaker_text_body",
  "dinner_text_body",
  "closing_text_body",
  "test_email",
] as const;
let restoredAnnouncementSpeakerIds: Set<string> | null = null;
let announcementDraftUnsaved = false;

restoreAnnouncementDraft();

if (container) void loadSpeakers();
if (location.hash === "#announcements") {
  const panel = document.querySelector("[data-admin-announcement-panel]");
  if (panel instanceof HTMLDetailsElement) panel.open = true;
}

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
document
  .querySelector<HTMLButtonElement>("[data-admin-announcement-copy]")
  ?.addEventListener("click", () => void copyAnnouncement());
document
  .querySelector<HTMLButtonElement>("[data-admin-announcement-download]")
  ?.addEventListener("click", downloadAnnouncement);
announcementConfirm?.addEventListener("change", () => {
  if (announcementSend)
    announcementSend.disabled = !announcementConfirm.checked;
});
announcementForm?.addEventListener("input", (event) => {
  if (
    event.target === announcementConfirm ||
    (event.target instanceof HTMLSelectElement &&
      event.target.hasAttribute("data-admin-announcement-variant"))
  )
    return;
  invalidateAnnouncementPreview();
  saveAnnouncementDraft();
});
window.addEventListener("beforeunload", (event) => {
  if (announcementDraftUnsaved) event.preventDefault();
});

function saveAnnouncementDraft(): void {
  if (!announcementForm) return;
  const data = new FormData(announcementForm);
  const fields = Object.fromEntries(
    announcementDraftFields.map((name) => [name, String(data.get(name) ?? "")]),
  );
  const speakerIds = announcementSpeakers?.childElementCount
    ? data.getAll("speaker_id").map(String)
    : restoredAnnouncementSpeakerIds
      ? [...restoredAnnouncementSpeakerIds]
      : null;
  try {
    localStorage.setItem(
      announcementDraftKey,
      JSON.stringify({
        fields,
        includeDinner: data.get("include_dinner") === "on",
        speakerIds,
      }),
    );
    announcementDraftUnsaved = false;
    setTextContent(
      "[data-admin-announcement-draft-status]",
      "Draft saved in this browser.",
    );
  } catch {
    announcementDraftUnsaved = true;
    setTextContent(
      "[data-admin-announcement-draft-status]",
      "Draft saving is unavailable. Download .txt before leaving this page.",
    );
  }
}

function restoreAnnouncementDraft(): void {
  if (!announcementForm) return;
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(announcementDraftKey) ?? "null",
    );
    if (
      !saved ||
      typeof saved !== "object" ||
      !("fields" in saved) ||
      !saved.fields ||
      typeof saved.fields !== "object" ||
      Array.isArray(saved.fields)
    )
      return;
    for (const name of announcementDraftFields) {
      const value: unknown = Reflect.get(saved.fields, name);
      const field = announcementForm.elements.namedItem(name);
      if (
        typeof value !== "string" ||
        value.length > 10000 ||
        (name === "category" &&
          value !== "operational" &&
          value !== "promotion")
      )
        continue;
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      )
        field.value = value;
    }
    const dinner = announcementForm.elements.namedItem("include_dinner");
    if (
      dinner instanceof HTMLInputElement &&
      "includeDinner" in saved &&
      typeof saved.includeDinner === "boolean"
    )
      dinner.checked = saved.includeDinner;
    if (
      "speakerIds" in saved &&
      Array.isArray(saved.speakerIds) &&
      saved.speakerIds.every((id) => typeof id === "string")
    )
      restoredAnnouncementSpeakerIds = new Set(saved.speakerIds);
    document
      .querySelector<HTMLDetailsElement>("[data-admin-announcement-panel]")
      ?.setAttribute("open", "");
    setTextContent(
      "[data-admin-announcement-draft-status]",
      "Draft restored from this browser. Preview recipients before sending.",
    );
  } catch {
    // Keep the form usable if stored data is invalid or browser storage is blocked.
  }
}

function renderAnnouncementSpeakers(speakers: AdminSpeakerItem[]): void {
  if (!announcementSpeakers) return;
  const selected = announcementSpeakers.childElementCount
    ? new Set(
        [
          ...announcementSpeakers.querySelectorAll<HTMLInputElement>(
            'input[name="speaker_id"]:checked',
          ),
        ].map((checkbox) => checkbox.value),
      )
    : restoredAnnouncementSpeakerIds;

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
      checkbox.checked = selected?.has(speaker.speaker_id) ?? true;
      const copy = node("span", "grid gap-1");
      copy.appendChild(node("strong", "uppercase", speaker.name));
      copy.appendChild(
        node(
          "span",
          "text-xs text-paper/60",
          speaker.contact?.email_confirmed_at ||
            speaker.contact?.secondary_email_confirmed_at
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
  saveAnnouncementDraft();
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
  previewToken = response.data.preview_token;
  setAnnouncementPreview(response.data);
  setAnnouncementStatus(
    response.data.recipient_count > 0
      ? "Preview ready. Confirm the exact recipient count before sending."
      : "No selected recipients are currently eligible for this category.",
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
  if (
    announcementBusy ||
    previewedRecipientCount === null ||
    !previewToken ||
    !announcementConfirm?.checked
  )
    return;
  announcementBusy = true;

  const payload = readAnnouncementPayload();
  if (announcementSend) announcementSend.disabled = true;
  setAnnouncementStatus(
    "Sending one separately addressed message per recipient…",
  );

  const response = await requestJson<{
    error?: string;
    failed_count?: number;
    message?: string;
  }>("/api/admin/speakers/announcements/send", {
    body: JSON.stringify({
      ...payload,
      confirm_recipient_count: previewedRecipientCount,
      preview_token: previewToken,
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

  announcementBusy = false;
  if (response.ok) {
    invalidateAnnouncementPreview();
    void loadAnnouncementHistory();
  } else {
    invalidateAnnouncementPreview();
    void loadAnnouncementHistory();
  }
}

function readAnnouncementPayload(): {
  category: string;
  include_dinner: boolean;
  speaker_text_body: string;
  dinner_text_body: string;
  closing_text_body: string;
  speaker_ids: string[];
  subject: string;
  text_body: string;
} {
  const formData = new FormData(announcementForm!);
  return {
    category: String(formData.get("category") ?? ""),
    include_dinner: formData.get("include_dinner") === "on",
    speaker_text_body: String(formData.get("speaker_text_body") ?? ""),
    dinner_text_body: String(formData.get("dinner_text_body") ?? ""),
    closing_text_body: String(formData.get("closing_text_body") ?? ""),
    speaker_ids: formData.getAll("speaker_id").map(String),
    subject: String(formData.get("subject") ?? ""),
    text_body: String(formData.get("text_body") ?? ""),
  };
}

function readAnnouncementMessage(): string | null {
  const {
    subject,
    text_body,
    speaker_text_body,
    dinner_text_body,
    closing_text_body,
  } = readAnnouncementPayload();
  if (!subject.trim() || !text_body.trim()) {
    setAnnouncementStatus("Enter a subject and message first.", true);
    return null;
  }
  return (
    [
      `Subject: ${subject.trim()}`,
      text_body.trim(),
      speaker_text_body.trim(),
      dinner_text_body.trim(),
      closing_text_body.trim(),
    ]
      .filter(Boolean)
      .join("\n\n") + "\n"
  );
}

async function copyAnnouncement(): Promise<void> {
  const message = readAnnouncementMessage();
  if (!message) return;
  try {
    await navigator.clipboard.writeText(message);
    setAnnouncementStatus("Subject and message copied.");
  } catch {
    setAnnouncementStatus(
      "Clipboard access failed. Use Download .txt to save the message.",
      true,
    );
  }
}

function downloadAnnouncement(): void {
  const message = readAnnouncementMessage();
  if (!message) return;
  const url = URL.createObjectURL(
    new Blob([message], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "sdlcai-announcement.txt";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  setAnnouncementStatus("Message file downloaded.");
}

function setAnnouncementPreview(preview: AnnouncementPreviewResponse): void {
  announcementPreviewPanel?.removeAttribute("hidden");
  setTextContent("[data-admin-announcement-text-preview]", preview.text_body);
  setTextContent(
    "[data-admin-announcement-recipient-count]",
    String(preview.recipient_count),
  );
  const recipientNames = preview.recipients
    .map(({ name, groups }) => `${name} (${groups.join(" + ")})`)
    .join(", ");
  const excluded = preview.excluded.length
    ? ` Excluded: ${preview.excluded.map(({ name, speaker_id, reason }) => `${name ?? speaker_id} (${reason})`).join(", ")}.`
    : "";
  setTextContent(
    "[data-admin-announcement-recipient-list]",
    `${recipientNames || "None"}.${excluded}`,
  );
  const counts = preview.audience_counts;
  setTextContent(
    "[data-admin-announcement-audience-counts]",
    `${counts.speakers_only} speakers only / ${counts.dinner_only} dinner only / ${counts.both} in both (one email each)`,
  );
  const variantElement = document.querySelector(
    "[data-admin-announcement-variant]",
  );
  const variant =
    variantElement instanceof HTMLSelectElement ? variantElement : null;
  const showVariant = () => {
    const selected = preview.variants[Number(variant?.value ?? 0)];
    setTextContent(
      "[data-admin-announcement-text-preview]",
      selected?.text_body ?? preview.text_body,
    );
    setAnnouncementHtmlPreview(selected?.html_body ?? preview.html_body);
  };
  if (variant) {
    variant.replaceChildren(
      ...preview.variants.map((v, i) => {
        const option = document.createElement("option");
        option.value = String(i);
        option.textContent = v.label;
        return option;
      }),
    );
    variant.onchange = showVariant;
  }
  showVariant();
  if (announcementConfirm) announcementConfirm.checked = false;
  if (announcementSend) announcementSend.disabled = true;
}

function setAnnouncementHtmlPreview(html: string): void {
  const frame = announcementHtmlPreview;
  if (!frame) return;
  announcementPreviewResizeObserver?.disconnect();
  announcementPreviewResizeObserver = null;
  frame.onload = () => {
    const body = frame.contentDocument?.body;
    if (!body || announcementPreviewPanel?.hidden) return;
    const fitContent = () => {
      frame.style.height = `${Math.ceil(body.getBoundingClientRect().height)}px`;
    };
    announcementPreviewResizeObserver = new ResizeObserver(fitContent);
    announcementPreviewResizeObserver.observe(body);
    fitContent();
  };
  // The sandbox permits measuring the generated email, while scripts stay disabled.
  frame.srcdoc = html;
}

function invalidateAnnouncementPreview(): void {
  previewedRecipientCount = null;
  previewToken = null;
  announcementPreviewResizeObserver?.disconnect();
  announcementPreviewResizeObserver = null;
  if (announcementHtmlPreview) announcementHtmlPreview.onload = null;
  announcementPreviewPanel?.setAttribute("hidden", "");
  if (announcementConfirm) announcementConfirm.checked = false;
  if (announcementSend) announcementSend.disabled = true;
}

async function loadAnnouncementHistory(offset = 0): Promise<void> {
  const history = document.querySelector<HTMLElement>(
    "[data-admin-announcement-history]",
  );
  if (!history) return;

  const response = await requestJson<{
    campaigns: AnnouncementCampaign[];
    next_offset: number | null;
    error?: string;
  }>(`/api/admin/speakers/announcements?offset=${offset}`);

  if (!response.ok || !Array.isArray(response.data.campaigns)) {
    history.textContent =
      response.data.error ?? "Announcement history unavailable.";
    return;
  }

  if (response.data.campaigns.length === 0) {
    history.textContent = "No announcements have been sent.";
    return;
  }

  if (offset === 0) history.replaceChildren();
  history.querySelector("[data-archive-more]")?.remove();
  for (const campaign of response.data.campaigns)
    history.appendChild(renderCampaign(campaign));
  const nextOffset = response.data.next_offset;
  if (nextOffset !== null) {
    const more = reviewButton("Load older messages", false);
    more.dataset.archiveMore = "";
    more.addEventListener("click", async () => {
      more.disabled = true;
      await loadAnnouncementHistory(nextOffset);
      more.disabled = false;
    });
    history.appendChild(more);
  }
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
  const details = node("details", "mt-3");
  details.appendChild(
    node(
      "summary",
      "cursor-pointer text-sm font-bold uppercase",
      "View message and recipients",
    ),
  );
  details.appendChild(
    node(
      "p",
      "my-4 whitespace-pre-wrap break-words text-sm",
      [
        campaign.text_body,
        campaign.speaker_text_body,
        campaign.dinner_text_body,
        campaign.closing_text_body,
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
  );
  const recipients = node("ul", "grid gap-2 text-sm");
  for (const delivery of campaign.deliveries) {
    recipients.appendChild(
      node(
        "li",
        "border-t border-paper/20 pt-2",
        `${delivery.name ?? delivery.speaker_id} / ${delivery.status}${delivery.sent_at ? ` / ${formatDate(delivery.sent_at)}` : ""}`,
      ),
    );
  }
  details.appendChild(recipients);
  copy.appendChild(details);
  row.appendChild(copy);

  if (campaign.failed_count > 0 && campaign.status !== "sending") {
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
    speakers.filter(
      ({ contact }) =>
        contact?.email_confirmed_at || contact?.secondary_email_confirmed_at,
    ).length,
  );
  setCount(
    "submitted",
    speakers.filter(({ revision }) => revision?.state === "submitted").length,
  );
  setCount("dinner", speakers.filter(({ dinner }) => dinner?.response).length);
  setCount(
    "presentation",
    speakers.filter(({ presentation }) => presentation?.responded_at).length,
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
  article.appendChild(renderSlideFiles(speaker));
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
      label: "Name (without titles, shown on badge)",
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
      label: "Title / honorific (optional, before name; omitted from badges)",
      maxLength: 40,
      name: "profile.honorific",
      speakerId: speaker.speaker_id,
      value: content.profile.honorific,
    }),
  );
  profileGrid.appendChild(
    createEditorField({
      fields,
      label: "Credentials (optional, after name; omitted from badges)",
      maxLength: 80,
      name: "profile.credentials",
      speakerId: speaker.speaker_id,
      value: content.profile.credentials,
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
  profileGrid.appendChild(
    createEditorField({
      fields,
      label: "Company (optional, shown on speaker badge)",
      maxLength: 200,
      name: "profile.company",
      speakerId: speaker.speaker_id,
      value: content.profile.company ?? "",
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
      company: value("profile.company"),
      devto: value("profile.devto"),
      github: value("profile.github"),
      linkedin: value("profile.linkedin"),
      name: value("profile.name"),
      honorific: value("profile.honorific"),
      credentials: value("profile.credentials"),
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

function renderSlideFiles(speaker: AdminSpeakerItem): HTMLElement {
  const section = node(
    "section",
    "grid min-w-0 gap-4 border-t border-paper/40 pt-5",
  );
  section.dataset.adminPresentation = speaker.speaker_id;
  section.appendChild(
    node("h4", "font-headline text-2xl font-black uppercase", "Presentation"),
  );
  section.appendChild(renderPresentation(speaker));
  for (const talk of speaker.canonical.talks) {
    const group = node("div", "grid min-w-0 gap-2");
    group.dataset.adminPresentationTalk = talk.id;
    group.appendChild(node("h5", "text-sm font-bold leading-6", talk.title));
    const upload = renderAdminSlideUpload(speaker, talk);
    const files = speaker.slides.filter((file) => file.talk_id === talk.id);
    if (!files.length)
      group.appendChild(node("p", "text-sm text-paper/60", "No files yet."));
    for (const file of files)
      group.appendChild(renderSlideFile(speaker, file, upload));
    const link = speaker.workspace_only ? null : renderSlideLink(speaker, talk);
    const recording = speaker.workspace_only
      ? null
      : renderSlideLink(speaker, talk, "recording");
    if (link?.row) group.appendChild(link.row);
    if (recording?.row) group.appendChild(recording.row);
    const actions = node("div", "flex flex-wrap gap-4 pt-1");
    const addFile = slideAction("Upload file");
    addFile.dataset.adminUploadToggle = "";
    addFile.setAttribute("aria-controls", upload.form.id);
    addFile.setAttribute("aria-expanded", "false");
    addFile.addEventListener("click", () => upload.open());
    actions.appendChild(addFile);
    if (link && !link.row) {
      const addLink = slideAction("Add public slide link");
      addLink.setAttribute("aria-controls", link.form.id);
      addLink.setAttribute("aria-expanded", "false");
      addLink.addEventListener("click", link.open);
      actions.appendChild(addLink);
    }
    if (recording && !recording.row) {
      const addRecording = slideAction("Add recording link");
      addRecording.setAttribute("aria-controls", recording.form.id);
      addRecording.setAttribute("aria-expanded", "false");
      addRecording.addEventListener("click", recording.open);
      actions.appendChild(addRecording);
    }
    group.appendChild(actions);
    group.appendChild(upload.form);
    if (link) group.appendChild(link.form);
    if (recording) group.appendChild(recording.form);
    section.appendChild(group);
  }
  return section;
}

function renderSlideFile(
  speaker: AdminSpeakerItem,
  file: SpeakerSlideFile,
  upload: ReturnType<typeof renderAdminSlideUpload>,
): HTMLElement {
  const row = node(
    "article",
    "grid min-w-0 gap-2 border-b border-paper/20 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
  );
  row.dataset.adminSlide = file.slide_id;
  const copy = node(
    "div",
    "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1",
  );
  copy.appendChild(node("strong", "min-w-0 break-all text-sm", file.filename));
  copy.appendChild(
    node(
      "span",
      "text-xs text-paper/60",
      `${(file.byte_size / (1024 * 1024)).toFixed(1)} MB`,
    ),
  );
  copy.appendChild(
    slideVisibility(file.published_at ? "Published" : "Private"),
  );
  row.appendChild(copy);
  const actions = node("div", "flex flex-wrap items-center gap-2");
  const download = node(
    "a",
    "px-2 py-2 text-sm font-bold underline underline-offset-4",
    "Download",
  );
  download.href = file.download_url;
  download.setAttribute(
    "aria-label",
    `Download ${slideFormatLabel(file.format)}`,
  );
  actions.appendChild(download);
  const replace = slideAction("Replace");
  replace.setAttribute(
    "aria-label",
    `Replace ${slideFormatLabel(file.format)}`,
  );
  replace.setAttribute("aria-controls", upload.form.id);
  replace.setAttribute("aria-expanded", "false");
  replace.addEventListener("click", () => upload.open(file));
  actions.appendChild(replace);
  const status = slideStatus();
  status.classList.add("sm:col-span-2");
  let permissionPrompt: HTMLLabelElement | null = null;
  if (file.format === "pdf") {
    const permission = node("input", "mt-1 h-5 w-5 shrink-0");
    permission.type = "checkbox";
    const publish = slideAction(file.published_at ? "Unpublish" : "Publish");
    publish.setAttribute(
      "aria-label",
      file.published_at ? "Unpublish PDF" : "Publish PDF on schedule",
    );
    publish.disabled =
      !file.published_at && (!file.may_publish || speaker.workspace_only);
    if (publish.disabled)
      publish.title = speaker.workspace_only
        ? "Private test account: publication is unavailable."
        : "Confirm the speaker's permission below before publishing.";
    if (!file.may_publish && !speaker.workspace_only) {
      permissionPrompt = node(
        "label",
        "flex items-start gap-3 text-sm leading-6 sm:col-span-2",
      );
      permissionPrompt.appendChild(permission);
      permissionPrompt.appendChild(
        node(
          "span",
          "",
          "The speaker has allowed this PDF to be shared publicly.",
        ),
      );
      permission.addEventListener("change", () => {
        publish.disabled = !permission.checked;
      });
    }
    publish.addEventListener("click", async () => {
      publish.disabled = true;
      permission.disabled = true;
      setSlideStatus(
        status,
        file.published_at ? "Unpublishing PDF…" : "Publishing PDF…",
      );
      const response = await requestJson<{ error?: string; message?: string }>(
        "/api/admin/speakers/slides/publication",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-action": "publish-speaker-slides",
          },
          body: JSON.stringify({
            slide_id: file.slide_id,
            published: !file.published_at,
            permission_confirmed: permission.checked,
          }),
        },
      );
      permission.disabled = false;
      publish.disabled =
        !file.published_at &&
        (speaker.workspace_only || (!file.may_publish && !permission.checked));
      if (!response.ok) {
        setSlideStatus(
          status,
          response.data.error ?? "Publication could not be saved.",
          true,
        );
        return;
      }
      await loadSpeakers();
      setStatus(response.data.message ?? "PDF publication saved.");
    });
    actions.appendChild(publish);
  }
  const more = slideMoreActions(file.filename);
  more.body.appendChild(
    node(
      "p",
      "text-xs leading-5 text-paper/70",
      `Uploaded ${formatDate(file.uploaded_at)}`,
    ),
  );
  more.body.appendChild(
    node(
      "p",
      "text-xs leading-5 text-paper/70",
      file.format !== "pdf"
        ? "Private for venue use."
        : speaker.workspace_only
          ? "Private test account: publication is unavailable."
          : file.may_publish
            ? "Speaker permission recorded for public sharing."
            : "Speaker permission is needed before publishing.",
    ),
  );
  if (file.public_url) {
    const publicLink = node(
      "a",
      "py-2 text-sm font-bold underline underline-offset-4",
      "Public PDF",
    );
    publicLink.href = file.public_url;
    more.body.appendChild(publicLink);
  }
  const remove = slideAction("Remove file");
  remove.setAttribute("aria-label", `Remove ${slideFormatLabel(file.format)}`);
  remove.addEventListener("click", async () => {
    if (
      !window.confirm(
        `Remove ${file.filename}? Any public schedule link will also be removed.`,
      )
    )
      return;
    remove.disabled = true;
    more.details.open = false;
    setSlideStatus(status, "Removing slides…");
    const response = await requestJson<{ error?: string; message?: string }>(
      `${file.download_url}?${new URLSearchParams({ speaker_id: speaker.speaker_id })}`,
      {
        method: "DELETE",
        headers: { "x-admin-action": "remove-speaker-slides" },
      },
    );
    remove.disabled = false;
    if (!response.ok) {
      setSlideStatus(
        status,
        response.data.error ?? "Slides could not be removed.",
        true,
      );
      return;
    }
    await loadSpeakers();
    setStatus(response.data.message ?? "Slides removed.");
  });
  more.body.appendChild(remove);
  actions.appendChild(more.details);
  row.appendChild(actions);
  if (permissionPrompt) row.appendChild(permissionPrompt);
  row.appendChild(status);
  return row;
}

function renderAdminSlideUpload(
  speaker: AdminSpeakerItem,
  talk: AdminSpeakerContent["talks"][number],
): { form: HTMLFormElement; open: (file?: SpeakerSlideFile) => void } {
  const form = node(
    "form",
    "grid min-w-0 gap-3 border-l-2 border-paper/40 py-3 pl-4",
  );
  form.dataset.adminSlideUpload = talk.id;
  form.id = `slide-upload-${speaker.speaker_id}-${talk.id}`;
  form.hidden = true;
  const title = node("strong", "text-sm font-bold uppercase", "Upload file");
  form.appendChild(title);
  const label = node(
    "label",
    "grid min-w-0 gap-2 text-sm font-bold",
    "Presentation file (PDF, .pptx, or HTML, up to 50 MB)",
  );
  const input = node(
    "input",
    "min-w-0 w-full border border-paper/40 p-2 text-sm font-normal file:mr-3 file:border-0 file:bg-paper file:px-3 file:py-2 file:font-bold file:text-ink",
  );
  input.type = "file";
  input.accept = ".pdf,.pptx,.html,.htm";
  input.required = true;
  label.appendChild(input);
  form.appendChild(label);
  const hint = node("p", "text-xs leading-5 text-paper/70");
  hint.hidden = true;
  form.appendChild(hint);
  const permissionLabel = node(
    "label",
    "grid grid-cols-[auto_1fr] items-start gap-3",
  );
  const permission = node("input", "mt-1 h-5 w-5");
  permission.type = "checkbox";
  permissionLabel.appendChild(permission);
  permissionLabel.appendChild(
    node(
      "span",
      "text-sm leading-6",
      "The speaker has allowed this PDF to be shared publicly.",
    ),
  );
  permissionLabel.hidden = true;
  permission.disabled = true;
  form.appendChild(permissionLabel);
  const actions = node("div", "flex flex-wrap items-center gap-3");
  const upload = slideAction("Upload slides", true);
  upload.type = "submit";
  const cancel = slideAction("Cancel");
  const status = slideStatus();
  actions.appendChild(upload);
  actions.appendChild(cancel);
  form.appendChild(actions);
  form.appendChild(status);
  let opener: HTMLElement | null = null;
  let expectedFormat: SpeakerSlideFile["format"] | null = null;
  const close = () => {
    form.hidden = true;
    form.reset();
    setSlideStatus(status, "");
    opener?.setAttribute("aria-expanded", "false");
    opener?.focus();
  };
  cancel.addEventListener("click", close);
  const update = () => {
    const file = input.files?.[0];
    const format = file ? slideFormatFromFilename(file.name) : null;
    const existing = speaker.slides.find(
      (item) => item.talk_id === talk.id && item.format === format,
    );
    permissionLabel.hidden = format !== "pdf";
    permission.disabled = format !== "pdf";
    permission.checked = false;
    upload.textContent = existing
      ? `Replace ${slideFormatLabel(existing.format)}`
      : "Upload slides";
    const replacement = existing
      ? `Replaces ${existing.filename}.${existing.published_at ? " Its public download will be removed." : ""} `
      : "";
    hint.textContent =
      replacement +
      (format === "pdf"
        ? "Upload stays private until you publish it."
        : format === "html"
          ? "Use a standalone HTML file. It stays private and downloads for local use."
          : format === "powerpoint"
            ? "Private for venue use."
            : "");
    hint.hidden = !hint.textContent;
    setSlideStatus(status, "");
  };
  input.addEventListener("change", update);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const file = input.files?.[0];
    const format = file ? slideFormatFromFilename(file.name) : null;
    if (!file || !format || (expectedFormat && format !== expectedFormat)) {
      setSlideStatus(
        status,
        expectedFormat
          ? `Choose a ${slideFormatLabel(expectedFormat)} file to replace this presentation.`
          : "Choose a PDF, PowerPoint (.pptx), or HTML file.",
        true,
      );
      return;
    }
    if (file.size === 0 || file.size > maxSlideFileBytes) {
      setSlideStatus(
        status,
        "Choose a non-empty file that is 50 MB or smaller.",
        true,
      );
      return;
    }
    const existing = speaker.slides.find(
      (item) => item.talk_id === talk.id && item.format === format,
    );
    const params = new URLSearchParams({
      speaker_id: speaker.speaker_id,
      talk_id: talk.id,
      filename: file.name,
      replaces_slide_id: existing?.slide_id ?? "",
      may_publish: format === "pdf" && permission.checked ? "1" : "0",
    });
    upload.disabled = true;
    cancel.disabled = true;
    input.disabled = true;
    permission.disabled = true;
    setSlideStatus(status, "Uploading slides…");
    const response = await requestJson<{ error?: string; message?: string }>(
      `/api/admin/speakers/slides/upload?${params}`,
      {
        method: "POST",
        headers: {
          "content-type": slideContentTypes[format],
          "x-admin-action": "upload-speaker-slides",
        },
        body: file,
      },
    );
    upload.disabled = false;
    cancel.disabled = false;
    input.disabled = false;
    permission.disabled = format !== "pdf";
    if (!response.ok) {
      setSlideStatus(
        status,
        response.data.error ?? "Slides could not be uploaded.",
        true,
      );
      return;
    }
    await loadSpeakers();
    setStatus(response.data.message ?? "Slides uploaded privately.");
  });
  return {
    form,
    open: (file) => {
      opener?.setAttribute("aria-expanded", "false");
      opener =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      opener?.setAttribute("aria-expanded", "true");
      form.reset();
      expectedFormat = file?.format ?? null;
      input.accept = file
        ? file.format === "powerpoint"
          ? ".pptx"
          : file.format === "html"
            ? ".html,.htm"
            : ".pdf"
        : ".pdf,.pptx,.html,.htm";
      title.textContent = file
        ? `Replace ${slideFormatLabel(file.format)}`
        : "Upload file";
      update();
      form.hidden = false;
      input.focus();
    },
  };
}

function renderSlideLink(
  speaker: AdminSpeakerItem,
  talk: AdminSpeakerContent["talks"][number],
  type: "slide" | "recording" = "slide",
): { form: HTMLFormElement; row: HTMLElement | null; open: () => void } {
  const recording = type === "recording";
  const title = recording ? "Recording" : "Slide";
  const savedSlide = speaker.slide_links.find(
    ({ talk_id }) => talk_id === talk.id,
  );
  const saved = recording
    ? speaker.recording_links.find(({ talk_id }) => talk_id === talk.id)
    : savedSlide;
  const savedKind = savedSlide?.kind ?? "presentation";
  const form = node(
    "form",
    "grid min-w-0 gap-3 border-l-2 border-paper/40 py-3 pl-4",
  );
  if (recording) form.dataset.adminRecordingLink = talk.id;
  else form.dataset.adminSlideLink = talk.id;
  form.id = `${type}-link-${speaker.speaker_id}-${talk.id}`;
  form.hidden = true;
  const label = node(
    "label",
    "grid min-w-0 gap-2 text-sm font-bold",
    `${title} URL (HTTPS)`,
  );
  const input = node(
    "input",
    "min-w-0 w-full border border-paper/40 bg-ink p-2 text-sm font-normal text-paper",
  );
  input.type = "url";
  input.required = true;
  input.maxLength = 2048;
  input.placeholder = "https://…";
  input.value = saved?.url ?? "";
  label.appendChild(input);
  form.appendChild(label);
  const kind = node(
    "select",
    "w-full border border-paper/40 bg-ink p-2 text-sm font-normal text-paper",
  );
  for (const [value, text] of [
    ["presentation", "Presentation"],
    ["resource", "Related resource"],
  ] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    kind.appendChild(option);
  }
  kind.value = savedKind;
  if (!recording) {
    const field = node("div", "grid gap-2");
    const kindLabel = node("label", "text-sm font-bold", "Link type");
    kind.id = `${form.id}-kind`;
    kindLabel.htmlFor = kind.id;
    field.appendChild(kindLabel);
    field.appendChild(kind);
    form.appendChild(field);
  }
  form.appendChild(
    node(
      "p",
      "text-xs leading-5 text-paper/70",
      "Saving publishes this link on the public schedule.",
    ),
  );
  const actions = node("div", "flex flex-wrap items-center gap-3");
  const save = slideAction(`Save ${type} link`, true);
  save.type = "submit";
  const cancel = slideAction("Cancel");
  actions.appendChild(save);
  actions.appendChild(cancel);
  form.appendChild(actions);
  const status = slideStatus();
  form.appendChild(status);
  const rowStatus = slideStatus();
  const remove = slideAction("Remove link");
  remove.setAttribute("aria-label", `Remove ${type} link`);
  let opener: HTMLElement | null = null;
  cancel.addEventListener("click", () => {
    input.value = saved?.url ?? "";
    kind.value = savedKind;
    form.hidden = true;
    setSlideStatus(status, "");
    opener?.setAttribute("aria-expanded", "false");
    opener?.focus();
  });
  const open = () => {
    opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    opener?.setAttribute("aria-expanded", "true");
    form.hidden = false;
    input.focus();
  };
  const submit = async (url: string) => {
    const feedback = form.hidden ? rowStatus : status;
    for (const control of [save, remove, cancel, input, kind])
      control.disabled = true;
    setSlideStatus(
      feedback,
      url ? `Saving ${type} link…` : `Removing ${type} link…`,
    );
    const response = await requestJson<{ error?: string; message?: string }>(
      `/api/admin/speakers/slides/${recording ? "recordings" : "links"}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-action": "publish-speaker-slides",
        },
        body: JSON.stringify({
          speaker_id: speaker.speaker_id,
          talk_id: talk.id,
          url,
          previous_url: saved?.url ?? null,
          ...(!recording ? { kind: kind.value, previous_kind: savedKind } : {}),
        }),
      },
    );
    for (const control of [save, remove, cancel, input, kind])
      control.disabled = false;
    if (!response.ok) {
      setSlideStatus(
        feedback,
        response.data.error ?? `${title} link could not be saved.`,
        true,
      );
      return;
    }
    await loadSpeakers();
    setStatus(response.data.message ?? `${title} link saved.`);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.reportValidity()) void submit(input.value.trim());
  });
  let row: HTMLElement | null = null;
  if (saved) {
    row = node(
      "div",
      "grid min-w-0 gap-2 border-b border-paper/20 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
    );
    if (recording) row.dataset.adminRecordingLinkRow = talk.id;
    else row.dataset.adminSlideLinkRow = talk.id;
    const copy = node("div", "grid min-w-0 gap-1");
    const heading = node("div", "flex flex-wrap items-center gap-3");
    heading.appendChild(
      node(
        "strong",
        "text-sm",
        recording
          ? "Talk recording"
          : savedKind === "resource"
            ? "Related resource"
            : "Public slide link",
      ),
    );
    heading.appendChild(slideVisibility("Published"));
    copy.appendChild(heading);
    const address = node("p", "truncate text-xs text-paper/60", saved.url);
    address.title = saved.url;
    copy.appendChild(address);
    row.appendChild(copy);
    const rowActions = node("div", "flex flex-wrap items-center gap-2");
    const visit = node(
      "a",
      "px-2 py-2 text-sm font-bold underline underline-offset-4",
      "Open",
    );
    visit.href = saved.url;
    visit.setAttribute("aria-label", `Open ${type} link`);
    rowActions.appendChild(visit);
    const edit = slideAction("Edit");
    edit.setAttribute("aria-label", `Edit public ${type} link`);
    edit.setAttribute("aria-controls", form.id);
    edit.setAttribute("aria-expanded", "false");
    edit.addEventListener("click", open);
    rowActions.appendChild(edit);
    const more = slideMoreActions(`public ${type} link`);
    remove.addEventListener("click", () => {
      more.details.open = false;
      void submit("");
    });
    more.body.appendChild(remove);
    rowActions.appendChild(more.details);
    row.appendChild(rowActions);
    rowStatus.classList.add("sm:col-span-2");
    row.appendChild(rowStatus);
  }
  return { form, row, open };
}

function slideAction(label: string, primary = false): HTMLButtonElement {
  const button = node(
    "button",
    primary
      ? "border border-paper bg-paper px-3 py-2 text-sm font-bold text-ink disabled:opacity-40"
      : "px-2 py-2 text-sm font-bold underline underline-offset-4 disabled:no-underline disabled:opacity-40",
    label,
  );
  button.type = "button";
  return button;
}

function slideVisibility(label: string): HTMLElement {
  return node(
    "span",
    "w-fit border border-paper/30 px-2 py-1 text-xs font-bold uppercase",
    label,
  );
}

function slideMoreActions(label: string): {
  details: HTMLDetailsElement;
  body: HTMLElement;
} {
  const details = node("details", "relative ml-auto sm:ml-0");
  const summary = node(
    "summary",
    "cursor-pointer list-none px-3 py-2 text-sm font-bold",
    "⋯",
  );
  summary.setAttribute("aria-label", `More actions for ${label}`);
  const body = node(
    "div",
    "absolute right-0 top-full z-10 mt-1 grid w-56 gap-2 border border-paper bg-ink p-3 text-paper shadow-lg",
  );
  details.appendChild(summary);
  details.appendChild(body);
  details.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      details.open = false;
      summary.focus();
    }
  });
  return { details, body };
}

function slideStatus(): HTMLParagraphElement {
  const status = node("p", "text-sm font-bold");
  status.hidden = true;
  status.setAttribute("aria-live", "polite");
  return status;
}

function setSlideStatus(
  target: HTMLElement,
  message: string,
  error = false,
): void {
  target.hidden = !message;
  setEditorStatus(target, message, error);
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
    "grid gap-x-3 gap-y-4 border-t border-paper/40 pt-5 md:grid-cols-2",
  ) as HTMLFormElement;
  region.dataset.adminSpeakerContact = speaker.speaker_id;
  const label = node("label", "grid gap-2 md:col-start-1 md:row-start-1");
  const labelText = node(
    "span",
    "font-bold uppercase",
    "Primary speaker email",
  );
  const input = document.createElement("input");
  input.className =
    "w-full border border-paper bg-ink px-4 py-3 text-paper outline-none focus:ring-2 focus:ring-paper";
  input.type = "email";
  input.name = "email";
  input.autocomplete = "email";
  input.required = true;
  input.maxLength = 254;
  input.value = speaker.contact?.email ?? "";
  const secondaryLabel = node(
    "label",
    "grid gap-2 md:col-start-2 md:row-start-1",
  );
  const secondaryInput = document.createElement("input");
  secondaryInput.className = input.className;
  secondaryInput.type = "email";
  secondaryInput.name = "secondary_email";
  secondaryInput.autocomplete = "email";
  secondaryInput.maxLength = 254;
  secondaryInput.value = speaker.contact?.secondary_email ?? "";
  secondaryLabel.appendChild(
    node("span", "font-bold uppercase", "Secondary email (optional)"),
  );
  secondaryLabel.appendChild(secondaryInput);
  const guidance = node(
    "p",
    "text-xs leading-5 text-paper/70 md:col-span-2 md:row-start-2",
    "Either address can receive a one-time sign-in link, valid for up to 24 hours. Updates go to the primary email. Leave the secondary email blank to remove it. Changing either address signs the speaker out.",
  );
  const help = node(
    "span",
    "text-xs text-paper/60 md:col-span-2 md:row-start-4",
    invitationHelp(speaker),
  );
  help.setAttribute("role", "status");
  const button = node(
    "button",
    "w-fit border border-paper bg-paper px-5 py-3 font-bold uppercase text-ink transition hover:bg-ink hover:text-paper disabled:cursor-wait disabled:opacity-60 md:col-span-2 md:row-start-3",
    "Save emails",
  ) as HTMLButtonElement;
  button.type = "submit";
  label.appendChild(labelText);
  label.appendChild(input);
  region.appendChild(label);
  region.appendChild(secondaryLabel);
  region.appendChild(guidance);
  region.appendChild(button);
  region.appendChild(help);

  region.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    help.textContent = "Saving encrypted contact…";

    const response = await requestJson<{ error?: string; message?: string }>(
      "/api/admin/speakers/contact",
      {
        body: JSON.stringify({
          email: input.value,
          secondary_email: secondaryInput.value,
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
  const manage = node(
    "a",
    "w-fit border border-paper/50 px-3 py-2 text-xs font-bold uppercase",
    "Manage dinner attendance →",
  );
  manage.href = `/admin/dinner/#speaker-${speaker.speaker_id}`;
  section.appendChild(manage);
  if (speaker.dinner?.attendance_source === "admin")
    section.appendChild(
      node(
        "p",
        "text-sm text-paper/60",
        "Attendance recorded by an organizer.",
      ),
    );

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

function renderPresentation(speaker: AdminSpeakerItem): HTMLElement {
  const response = speaker.presentation?.response;
  if (!response)
    return node("p", "text-sm text-paper/60", "Setup not provided.");
  const details = node("details", "min-w-0");
  details.dataset.adminPresentationSetup = speaker.speaker_id;
  const summary = node(
    "summary",
    "flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 text-sm",
  );
  summary.appendChild(
    node(
      "strong",
      "font-bold",
      response.delivery_method === "own_laptop"
        ? "Own laptop"
        : `Materials in advance · ${presentationMaterialLabel(response.material_format)}`,
    ),
  );
  if (response.delivery_method === "own_laptop") {
    summary.appendChild(
      node(
        "span",
        "text-xs font-bold text-red-300 dark:text-red-700",
        "Needs venue confirmation",
      ),
    );
  }
  summary.appendChild(
    node(
      "span",
      "py-2 text-xs text-paper/60 underline underline-offset-4",
      "Setup details",
    ),
  );
  details.appendChild(summary);
  const body = node(
    "div",
    "mt-2 grid gap-2 border-l border-paper/30 pl-3 text-sm leading-6 text-paper/70",
  );
  if (response.delivery_method === "own_laptop") {
    body.appendChild(
      node(
        "p",
        "",
        "Discouraged by the venue; confirm the connection and changeover plan with the speaker.",
      ),
    );
  }
  if (response.material_url) {
    const anchor = node(
      "a",
      "break-all underline underline-offset-4",
      response.material_url,
    );
    anchor.href = response.material_url;
    anchor.rel = "noopener";
    anchor.target = "_blank";
    body.appendChild(anchor);
  }
  body.appendChild(
    node(
      "p",
      "text-xs",
      `Private venue details${speaker.presentation?.responded_at ? ` · Updated ${formatDate(speaker.presentation.responded_at)}` : ""}`,
    ),
  );
  details.appendChild(body);
  return details;
}

function presentationMaterialLabel(
  value: "" | "pdf" | "powerpoint" | "web",
): string {
  return {
    "": "Not stated",
    pdf: "PDF",
    powerpoint: "PowerPoint (.pptx)",
    web: "Web presentation",
  }[value];
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
  const signedInAt =
    speaker.contact.email_confirmed_at ||
    speaker.contact.secondary_email_confirmed_at;
  if (!signedInAt) {
    return "Mapped / speaker has not signed in yet.";
  }
  return `Signed in / ${formatDate(signedInAt)}`;
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
