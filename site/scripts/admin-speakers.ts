export {};

interface AdminSpeakerContent {
  profile: Record<string, string>;
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
  contact: {
    delivery_status: "active" | "suppressed";
    email: string | null;
    email_confirmed_at: string | null;
    operational_email_enabled: boolean;
    promotion_email_enabled: boolean;
    retention_until: string;
    updated_at: string;
  } | null;
  invitation: {
    active: boolean;
    expires_at: string;
    last_sent_at: string | null;
  } | null;
  name: string;
  revision: AdminSpeakerRevision | null;
  speaker_id: string;
}

interface AdminSpeakersResponse {
  count: number;
  error?: string;
  speakers: AdminSpeakerItem[];
}

const container = document.querySelector<HTMLElement>("[data-admin-speakers]");
const refreshButton = document.querySelector<HTMLButtonElement>(
  "[data-admin-speakers-refresh]",
);
const status = document.querySelector<HTMLElement>(
  "[data-admin-speakers-status]",
);

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
  container?.replaceChildren(
    ...response.data.speakers.map((speaker) => renderSpeaker(speaker)),
  );
  setStatus(`Loaded ${response.data.speakers.length} speakers.`);
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
    speaker.speaker_id,
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

  if (speaker.revision) {
    article.appendChild(renderRevision(speaker));
  }

  return article;
}

function renderInvitation(speaker: AdminSpeakerItem): HTMLElement {
  const region = node(
    "form",
    "grid gap-3 border-t border-paper/40 pt-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
  ) as HTMLFormElement;
  const label = node("label", "grid gap-2");
  const labelText = node("span", "font-bold uppercase", "Speaker email");
  const input = document.createElement("input");
  input.className =
    "w-full border border-paper bg-ink px-4 py-3 text-paper outline-none focus:ring-2 focus:ring-paper";
  input.type = "email";
  input.name = "email";
  input.autocomplete = "email";
  input.required = true;
  input.value = speaker.contact?.email ?? "";
  const help = node("span", "text-xs text-paper/60", invitationHelp(speaker));
  const button = node(
    "button",
    "border border-paper bg-paper px-5 py-3 font-bold uppercase text-ink transition hover:bg-ink hover:text-paper disabled:cursor-wait disabled:opacity-60",
    speaker.invitation?.last_sent_at ? "Rotate and resend" : "Send invitation",
  ) as HTMLButtonElement;
  button.type = "submit";
  label.appendChild(labelText);
  label.appendChild(input);
  label.appendChild(help);
  region.appendChild(label);
  region.appendChild(button);

  region.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    help.textContent = "Sending…";

    const response = await requestJson<{ error?: string; message?: string }>(
      "/api/admin/speakers/invite",
      {
        body: JSON.stringify({
          email: input.value,
          speaker_id: speaker.speaker_id,
        }),
        headers: {
          "content-type": "application/json",
          "x-admin-action": "send-speaker-invite",
        },
        method: "POST",
      },
    );

    button.disabled = false;
    help.textContent = response.ok
      ? (response.data.message ?? "Invitation sent.")
      : (response.data.error ?? "Invitation could not be sent.");

    if (response.ok) void loadSpeakers();
  });

  return region;
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
    section.appendChild(renderCopyAction(revision.content));
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
  const approve = reviewButton("Approve", true);
  const reject = reviewButton("Request changes", false);
  const copy = renderCopyAction(speaker.revision!.content);
  label.appendChild(labelText);
  label.appendChild(textarea);
  actions.appendChild(approve);
  actions.appendChild(reject);
  region.appendChild(label);
  region.appendChild(actions);
  region.appendChild(copy);

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

function renderCopyAction(content: AdminSpeakerContent | null): HTMLElement {
  const wrapper = node("div", "flex items-center gap-3");
  const button = node(
    "button",
    "border border-paper px-3 py-2 text-sm font-bold uppercase",
    "Copy revision JSON",
  ) as HTMLButtonElement;
  const result = node("span", "text-xs text-paper/60");
  button.type = "button";
  button.disabled = !content;
  button.addEventListener("click", async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(content, null, 2));
      result.textContent = "Copied";
    } catch {
      result.textContent = "Copy failed";
    }
  });
  wrapper.appendChild(button);
  wrapper.appendChild(result);
  return wrapper;
}

function invitationHelp(speaker: AdminSpeakerItem): string {
  if (!speaker.contact?.email)
    return "Stored encrypted; never added to public JSON.";
  if (!speaker.invitation?.last_sent_at)
    return "Address saved; invitation not sent.";
  const state = speaker.contact.email_confirmed_at
    ? "Confirmed"
    : "Unconfirmed";
  return `${state} / Last sent ${formatDate(speaker.invitation.last_sent_at)}`;
}

function revisionLabel(revision: AdminSpeakerRevision | null): string {
  if (!revision) return "No revision";
  return {
    approved: "Approved / apply to Git",
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
