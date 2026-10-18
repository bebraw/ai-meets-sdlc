import "./index.ts";
import "./admin-navigation.ts";
import {
  api,
  append,
  button,
  buttonClass,
  el,
  field,
  message,
} from "./admin-toolkit.ts";
const endpoint = "/api/admin/attendee-messages",
  action = "attendee-messages";
interface Counts {
  pending: number;
  accepted: number;
  failed: number;
  unknown: number;
  skipped: number;
}
interface Campaign extends Counts {
  id: string;
  subject: string;
  text_body: string;
  created_at: string;
}
interface History {
  campaigns: Campaign[];
  recipient_count: number;
  excluded: Record<string, number>;
  next_offset: number | null;
  sending: { configured: boolean; from: string };
}
interface Draft {
  subject: string;
  text_body: string;
  revision: number;
  updated_at: string | null;
}
interface Preview {
  preview_token: string;
  recipient_count: number;
  recipients: { email: string; names: string[] }[];
  excluded: Record<string, number>;
  text_body: string;
}
interface Deliveries {
  deliveries: {
    email: string;
    status: string;
    attempts: number;
    updated_at: string;
    message_id: string | null;
  }[];
  next_offset: number | null;
}
const root = document.querySelector<HTMLElement>("[data-attendee-messages]");
if (root) setup(root);

function setup(root: HTMLElement) {
  let preview: Preview | null = null,
    busy = false,
    historyOffset: number | null = 0,
    draftRevision: number | null = null,
    savedCopy = JSON.stringify({ subject: "", text_body: "" }),
    savedAt: string | null = null;
  const status = el("p", "Loading current audience…", "font-bold leading-7");
  status.setAttribute("role", "status");
  const audience = el("p", "", "leading-7 text-muted");
  const sending = el(
    "p",
    "Checking email configuration…",
    "leading-7 text-muted",
  );
  const intro = el("div", "", "grid gap-3 border border-ink p-5");
  append(
    intro,
    el(
      "h2",
      "Event communications",
      "font-headline text-2xl font-black uppercase",
    ),
    el(
      "p",
      "Send welcome information, practical updates, or follow-up about SDLCAI 2026. Future event promotions belong in the separate, consent-based news list. Marketing campaigns await provider selection.",
      "max-w-4xl leading-7",
    ),
    audience,
    sending,
  );
  const form = el(
    "form",
    "",
    "grid min-w-0 gap-5 border border-ink p-5 md:p-7",
  );
  const templates = el("div", "", "flex flex-wrap gap-3");
  append(
    templates,
    button("Use welcome draft", () => useTemplate("welcome")),
    button("Use follow-up draft", () => useTemplate("followup")),
  );
  const subject = field("Subject");
  subject.input.required = true;
  subject.input.minLength = 4;
  subject.input.maxLength = 160;
  const bodyLabel = el("label", "", "grid gap-2 text-sm font-bold"),
    body = el(
      "textarea",
      "",
      "min-w-0 w-full border border-ink bg-paper px-3 py-3 font-normal leading-7",
    );
  body.rows = 16;
  body.required = true;
  body.minLength = 20;
  body.maxLength = 10000;
  append(
    bodyLabel,
    el("span", "Message (plain text; web links become clickable)"),
    body,
  );
  const draftStatus = el(
    "p",
    "Loading saved draft…",
    "text-sm leading-6 text-muted",
  );
  draftStatus.setAttribute("role", "status");
  const saveDraftButton = button("Save draft", () => void saveDraft());
  const draftActions = el("div", "", "flex flex-wrap items-center gap-4");
  append(draftActions, saveDraftButton, draftStatus);
  const test = field("Test recipient email", "", "email");
  test.input.maxLength = 254;
  test.input.autocomplete = "email";
  const testButton = button("Send test email", () => void sendTest());
  const testRow = el(
    "div",
    "",
    "grid gap-3 md:grid-cols-[1fr_auto] md:items-end",
  );
  append(testRow, test.label, testButton);
  const previewButton = el(
    "button",
    "Preview message and recipients",
    buttonClass,
  );
  previewButton.type = "submit";
  const previewArea = el("div", "", "grid min-w-0 gap-5");
  previewArea.hidden = true;
  const reviewedLabel = el("label", "", "flex items-start gap-3 leading-7"),
    reviewed = el("input");
  reviewed.type = "checkbox";
  reviewed.className = "mt-1 h-5 w-5 shrink-0";
  append(
    reviewedLabel,
    reviewed,
    el(
      "span",
      "I reviewed the message and recipient list. This email contains SDLCAI 2026 event information only.",
    ),
  );
  const sendButton = button("Send to attendees", () => void send());
  sendButton.disabled = true;
  append(
    form,
    templates,
    subject.label,
    bodyLabel,
    draftActions,
    testRow,
    previewButton,
    previewArea,
    reviewedLabel,
    sendButton,
  );
  const historySection = el(
      "section",
      "",
      "grid gap-5 border-t border-ink pt-8",
    ),
    heading = el(
      "div",
      "",
      "flex flex-wrap items-center justify-between gap-4",
    );
  const historyList = el("div", "", "grid gap-4");
  const moreHistory = button("Load older messages", () => {
    if (historyOffset !== null) void loadHistory(historyOffset);
  });
  moreHistory.hidden = true;
  append(
    heading,
    el("h2", "Message history", "font-headline text-3xl font-black uppercase"),
    button("Reload history", () => void loadHistory()),
  );
  append(
    historySection,
    heading,
    el(
      "p",
      "Accepted means the email provider accepted the message; it does not confirm inbox delivery. Unknown sends are never retried automatically. Check provider logs before deciding how to handle them.",
      "max-w-4xl leading-7 text-muted",
    ),
    historyList,
    moreHistory,
  );
  append(root, intro, status, form, historySection);
  function input() {
    return {
      subject: subject.input.value,
      text_body: body.value,
      category: "operational",
    };
  }
  function invalidate() {
    preview = null;
    previewArea.replaceChildren();
    previewArea.hidden = true;
    reviewed.checked = false;
    sendButton.disabled = true;
    sendButton.textContent = "Send to attendees";
  }
  function copy() {
    return { subject: subject.input.value, text_body: body.value };
  }
  function isDirty() {
    return JSON.stringify(copy()) !== savedCopy;
  }
  function updateDraftStatus() {
    saveDraftButton.disabled = busy || draftRevision === null || !isDirty();
    draftStatus.textContent = isDirty()
      ? "Unsaved changes. Save draft to keep editing later."
      : savedAt
        ? `Draft saved ${new Date(savedAt).toLocaleString()}. Available to organizers on any device.`
        : "No saved draft yet.";
  }
  function changed() {
    invalidate();
    updateDraftStatus();
  }
  subject.input.addEventListener("input", changed);
  body.addEventListener("input", changed);
  addEventListener("beforeunload", (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  async function loadDraft() {
    try {
      const data = await api<{ draft: Draft }>(`${endpoint}/draft`, action);
      applyDraft(data.draft);
    } catch (error) {
      draftStatus.textContent = message(error);
    }
  }
  function applyDraft(draft: Draft) {
    subject.input.value = draft.subject;
    body.value = draft.text_body;
    draftRevision = draft.revision;
    savedAt = draft.updated_at;
    savedCopy = JSON.stringify(copy());
    updateDraftStatus();
  }
  async function saveDraft() {
    if (busy || draftRevision === null || !isDirty()) return;
    setBusy(true);
    draftStatus.textContent = "Saving draft…";
    try {
      const data = await api<{ draft: Draft }>(
        `${endpoint}/draft`,
        action,
        "POST",
        {
          ...copy(),
          revision: draftRevision,
        },
      );
      applyDraft(data.draft);
      status.textContent = "Draft saved. No email was sent.";
    } catch (error) {
      draftStatus.textContent = message(error);
    } finally {
      setBusy(false);
    }
  }
  reviewed.addEventListener("change", () => {
    sendButton.disabled =
      busy || !preview || !preview.recipient_count || !reviewed.checked;
  });
  function setBusy(value: boolean) {
    busy = value;
    for (const control of form.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement
    >("input, button, textarea"))
      control.disabled = value;
    sendButton.disabled =
      value || !preview || !preview.recipient_count || !reviewed.checked;
    saveDraftButton.disabled = value || draftRevision === null || !isDirty();
    for (const control of historyList.querySelectorAll<HTMLButtonElement>(
      "button",
    ))
      control.disabled = value;
  }
  function useTemplate(kind: "welcome" | "followup") {
    subject.input.value =
      kind === "welcome"
        ? "Welcome to SDLCAI 2026"
        : "Thank you for SDLCAI 2026 — photos, recording and feedback";
    body.value =
      kind === "welcome"
        ? "Hello,\n\nWe're looking forward to seeing you at SDLCAI on 13 October 2026.\n\nVenue: Marsio, Otakaari 2A, 02150 Espoo, Finland.\n\nWe recommend the metro or light rail 15 to Aalto University (Aalto-yliopisto). From the metro, take exit A towards Otaniementie / University at the end of the platform. Walk across Korkeakouluaukio square and cross the light rail tracks. Marsio is the first building on your left after the tracks. The tram stop is also a short walk from Marsio.\n\nLunch is included, along with coffee and pastries during breaks and food at the afterparty. The afterparty is at the same venue.\n\nFind arrival directions and parking information here:\nhttps://sdlcai.org/2026/faq/\n\nSee the schedule and plan your day:\nhttps://sdlcai.org/2026/schedule/\n\nSee you at Marsio!"
        : "Hello everyone,\n\nThank you for joining us at SDLCAI 2026 on 13 October. We hope the talks, panels and conversations gave you useful ideas to take back to your work.\n\nWe'd love to hear what worked well and what we could improve. Share your feedback here:\nhttps://sdlcai.org/feedback/\n\nRevisit the day in photos\nExplore the photo timeline, follow a talk or topic, and download your favourite moments:\nhttps://sdlcai.org/2026/timeline/\n\nYou can also browse the photo media bank:\nhttps://sdlcai.org/2026/photos/\n\nThe photos are shared under CC BY 4.0. Please credit the photographer named beside each photo when you reuse it.\n\nRecording and presentation materials\nWatch the event recording:\nhttps://youtube.com/live/d7POyy6dYFI\n\nFind available slides and other talk materials in the programme:\nhttps://sdlcai.org/2026/schedule/\n\nThank you to our speakers, panellists, partners, volunteers and everyone who contributed to the discussions. It was a pleasure to bring this community together.\n\nThe SDLCAI organising team";
    changed();
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    invalidate();
    setBusy(true);
    status.textContent = "Preparing message preview…";
    void api<Preview>(`${endpoint}/preview`, action, "POST", input())
      .then((data) => {
        preview = data;
        previewArea.hidden = false;
        const copy = el(
          "pre",
          data.text_body,
          "min-w-0 whitespace-pre-wrap break-words border border-ink bg-paper p-5 font-body text-base leading-7",
        );
        const recipients = el("details"),
          summary = el(
            "summary",
            `${data.recipient_count} unique recipient addresses — review list`,
            "cursor-pointer font-bold underline",
          );
        const list = el(
          "ul",
          "",
          "mt-4 grid max-h-80 gap-2 overflow-y-auto break-words",
        );
        for (const recipient of data.recipients)
          append(
            list,
            el(
              "li",
              `${recipient.names.filter(Boolean).join(" / ")} — ${recipient.email}`,
            ),
          );
        append(recipients, summary, list);
        append(
          previewArea,
          el(
            "h3",
            "Message preview",
            "font-headline text-2xl font-black uppercase",
          ),
          copy,
          recipients,
          el("p", exclusionText(data.excluded), "text-sm text-muted"),
        );
        sendButton.textContent = `Send event email to ${data.recipient_count} addresses`;
        status.textContent =
          "Review the preview and audience, then confirm below to send.";
      })
      .catch((error: unknown) => {
        status.textContent = message(error);
      })
      .finally(() => setBusy(false));
  });
  async function sendTest() {
    if (
      busy ||
      !subject.input.reportValidity() ||
      !body.reportValidity() ||
      !test.input.value ||
      !test.input.reportValidity()
    ) {
      if (!test.input.value) {
        status.textContent = "Enter a test recipient email address.";
        test.input.focus();
      }
      return;
    }
    setBusy(true);
    status.textContent = "Sending a test message…";
    try {
      const data = await api<{ message: string }>(
        `${endpoint}/test`,
        action,
        "POST",
        { ...input(), test_email: test.input.value },
      );
      status.textContent = data.message;
    } catch (error) {
      status.textContent = message(error);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if (busy || !preview || !reviewed.checked) return;
    setBusy(true);
    status.textContent = "Saving message and recipients…";
    try {
      const data = await api<{ campaign_id: string }>(
        `${endpoint}/send`,
        action,
        "POST",
        {
          ...input(),
          preview_token: preview.preview_token,
          confirm_recipient_count: preview.recipient_count,
        },
      );
      invalidate();
      await continueSend(data.campaign_id);
    } catch (error) {
      status.textContent = `${message(error)} Check history before starting another send.`;
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }
  async function continueSend(id: string, retry = false) {
    setBusy(true);
    try {
      let result: Counts;
      do {
        result = await api<Counts>(
          `${endpoint}/${retry ? "retry" : "continue"}`,
          action,
          "POST",
          { id },
        );
        retry = false;
        status.textContent = outcome(result);
      } while (result.pending > 0);
    } catch (error) {
      status.textContent = `${message(error)} The send is saved. Reload history to continue remaining recipients.`;
    } finally {
      await loadHistory();
      setBusy(false);
    }
  }
  async function loadHistory(offset = 0) {
    moreHistory.disabled = true;
    try {
      const data = await api<History>(`${endpoint}?offset=${offset}`, action);
      sending.textContent = data.sending.configured
        ? `Sender configured: SDLCAI <${data.sending.from}>. Use Send test email to check delivery before sending to attendees.`
        : "Email sending is not configured. You can save a draft while the sender is being set up.";
      audience.textContent = `${data.recipient_count} eligible unique addresses from active attendee registrations, accepted posters, and volunteers. ${exclusionText(data.excluded)}`;
      if (!offset) historyList.replaceChildren();
      if (!data.campaigns.length && !offset)
        append(
          historyList,
          el("p", "No attendee messages sent yet.", "text-muted"),
        );
      for (const campaign of data.campaigns) {
        const card = el(
          "article",
          "",
          "grid min-w-0 gap-3 border border-ink p-5",
        );
        append(
          card,
          el("h3", campaign.subject, "break-words text-xl font-bold"),
          el(
            "p",
            new Date(campaign.created_at).toLocaleString(),
            "text-sm text-muted",
          ),
          el("p", outcome(campaign), "leading-7"),
        );
        const saved = el("details"),
          deliveryList = el("div", "", "grid gap-3");
        append(
          saved,
          el(
            "summary",
            "Saved message and recipient history",
            "cursor-pointer font-bold underline",
          ),
          el(
            "pre",
            campaign.text_body,
            "my-5 min-w-0 whitespace-pre-wrap break-words font-body leading-7",
          ),
          deliveryList,
        );
        let deliveryOffset: number | null = 0,
          deliveryBusy = false;
        const load = button("Load recipient history", () => {
          if (deliveryOffset !== null) void loadDeliveries();
        });
        async function loadDeliveries() {
          if (deliveryBusy) return;
          deliveryBusy = true;
          load.disabled = true;
          try {
            const data = await api<Deliveries>(
              `${endpoint}/deliveries?id=${campaign.id}&offset=${deliveryOffset ?? 0}`,
              action,
            );
            for (const row of data.deliveries)
              append(
                deliveryList,
                el(
                  "p",
                  `${row.email} / ${row.status} / ${row.attempts} attempts / ${new Date(row.updated_at).toLocaleString()}${row.message_id ? ` / provider ID: ${row.message_id}` : ""}`,
                  "break-words text-sm leading-6",
                ),
              );
            deliveryOffset = data.next_offset;
            load.hidden = deliveryOffset === null;
            load.textContent = "Load more recipient history";
          } catch (error) {
            status.textContent = message(error);
          } finally {
            deliveryBusy = false;
            load.disabled = false;
          }
        }
        append(saved, load);
        append(card, saved);
        if (campaign.pending > 0)
          append(
            card,
            button("Continue remaining recipients", () => {
              if (!busy) void continueSend(campaign.id);
            }),
          );
        if (campaign.failed > 0)
          append(
            card,
            button("Retry rejected sends", () => {
              if (!busy) void continueSend(campaign.id, true);
            }),
          );
        append(historyList, card);
      }
      historyOffset = data.next_offset;
      moreHistory.hidden = historyOffset === null;
    } catch (error) {
      status.textContent = message(error);
    } finally {
      moreHistory.disabled = false;
    }
  }
  function exclusionText(excluded: Record<string, number>) {
    return `Excluded: ${Object.entries(excluded)
      .map(([reason, count]) => `${count} ${reason.replaceAll("_", " ")}`)
      .join(", ")}.`;
  }
  function outcome(counts: Counts) {
    return `${counts.accepted} accepted / ${counts.pending} pending / ${counts.failed} rejected / ${counts.skipped} skipped / ${counts.unknown} unknown.`;
  }
  setBusy(true);
  void Promise.all([loadHistory(), loadDraft()]).then(() => {
    setBusy(false);
    if (status.textContent === "Loading current audience…")
      status.textContent = "Compose a message or start from a draft below.";
  });
}
