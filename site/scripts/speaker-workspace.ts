export {};

interface WorkspaceProfile {
  bio: string;
  devto: string;
  github: string;
  linkedin: string;
  name: string;
  role: string;
  scholar: string;
  website: string;
  x: string;
}

interface WorkspaceTalk {
  abstract: string;
  id: string;
  title: string;
}

interface WorkspaceContent {
  profile: WorkspaceProfile;
  talks: WorkspaceTalk[];
}

interface WorkspaceResponse {
  authenticated: boolean;
  content: WorkspaceContent;
  error?: string;
  field_errors?: Record<string, string>;
  immutable: {
    photo: string;
    speaker_id: string;
    talk_ids: string[];
  };
  message?: string;
  revision: {
    revision_id: string;
    state: "approved" | "draft" | "submitted";
    submitted_at: string | null;
    updated_at: string;
  } | null;
}

interface PromotionAsset {
  height: number;
  path: string;
  presetId: string;
  version: string;
  width: number;
}

interface PromotionTalk {
  assets: PromotionAsset[];
  id: string;
  title: string;
}

interface PromotionManifest {
  schemaVersion: number;
  speakers: Array<{
    id: string;
    talks: PromotionTalk[];
  }>;
}

const loading = document.querySelector<HTMLElement>("[data-speaker-loading]");
const errorPanel = document.querySelector<HTMLElement>("[data-speaker-error]");
const errorMessage = document.querySelector<HTMLElement>(
  "[data-speaker-error-message]",
);
const workspace = document.querySelector<HTMLElement>(
  "[data-speaker-workspace]",
);
const form = document.querySelector<HTMLFormElement>("[data-speaker-form]");
const status = document.querySelector<HTMLElement>("[data-speaker-status]");
const logoutButton = document.querySelector<HTMLButtonElement>(
  "[data-speaker-logout]",
);
const talkContainer = document.querySelector<HTMLElement>(
  "[data-speaker-talks]",
);
const talkTemplate = document.querySelector<HTMLTemplateElement>(
  "[data-speaker-talk-template]",
);
const promotionContainer = document.querySelector<HTMLElement>(
  "[data-speaker-promotions]",
);
let currentWorkspace: WorkspaceResponse | null = null;

void initialize();

async function initialize(): Promise<void> {
  const invitationToken = readInvitationToken();

  if (invitationToken) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);

    const redemption = await requestJson<{
      authenticated?: boolean;
      error?: string;
    }>("/api/speaker/session", {
      method: "POST",
      headers: { authorization: `Bearer ${invitationToken}` },
    });

    if (!redemption.ok) {
      showError(
        redemption.data.error ?? "This invitation is invalid or expired.",
      );
      return;
    }
  }

  await loadWorkspace();
}

async function loadWorkspace(): Promise<void> {
  const response = await requestJson<WorkspaceResponse>(
    "/api/speaker/workspace",
  );

  if (!response.ok) {
    showError(response.data.error ?? "Open the invitation link sent to you.");
    return;
  }

  currentWorkspace = response.data;
  renderWorkspace(response.data);
  await loadPromotions(response.data.immutable.speaker_id);
}

function renderWorkspace(data: WorkspaceResponse): void {
  loading?.setAttribute("hidden", "");
  errorPanel?.setAttribute("hidden", "");
  workspace?.removeAttribute("hidden");
  logoutButton?.removeAttribute("hidden");

  setText("[data-speaker-name]", data.content.profile.name);
  setText(
    "[data-speaker-revision]",
    data.revision?.state === "submitted"
      ? "In review"
      : data.revision?.state === "approved"
        ? "Approved / publishing"
        : data.revision?.state === "draft"
          ? "Draft"
          : "Published",
  );

  const photo = document.querySelector<HTMLImageElement>(
    "[data-speaker-photo]",
  );
  if (photo) {
    photo.src = data.immutable.photo;
    photo.alt = `${data.content.profile.name}'s current public portrait`;
  }

  for (const [field, value] of Object.entries(data.content.profile)) {
    const input = form?.elements.namedItem(`profile.${field}`);
    if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLTextAreaElement
    ) {
      input.value = value;
    }
  }

  renderTalks(data.content.talks);
  setLockedState(data.revision?.state ?? null);
}

function renderTalks(talks: WorkspaceTalk[]): void {
  if (!talkContainer || !talkTemplate) return;

  talkContainer.replaceChildren();

  for (const [index, talk] of talks.entries()) {
    const fragment = talkTemplate.content.cloneNode(true) as DocumentFragment;
    const fieldset = fragment.querySelector<HTMLFieldSetElement>("fieldset");
    const idInput =
      fragment.querySelector<HTMLInputElement>('[name="talk.id"]');
    const titleInput = fragment.querySelector<HTMLInputElement>(
      '[name="talk.title"]',
    );
    const abstractInput = fragment.querySelector<HTMLTextAreaElement>(
      '[name="talk.abstract"]',
    );
    const legend = fragment.querySelector<HTMLElement>("[data-talk-legend]");

    if (!fieldset || !idInput || !titleInput || !abstractInput || !legend)
      continue;

    fieldset.dataset.talkIndex = String(index);
    idInput.value = talk.id;
    titleInput.value = talk.title;
    abstractInput.value = talk.abstract;
    legend.textContent = `Assigned talk / ${talk.id}`;
    talkContainer.appendChild(fragment);
  }
}

async function loadPromotions(speakerId: string): Promise<void> {
  if (!promotionContainer) return;

  const response = await requestJson<PromotionManifest>(
    "/assets/social/speakers.json",
  );
  const speaker = response.data.speakers?.find(({ id }) => id === speakerId);

  if (!response.ok || response.data.schemaVersion !== 1 || !speaker) {
    promotionContainer.textContent =
      "Promotion graphics are temporarily unavailable. Please try again later.";
    return;
  }

  promotionContainer.replaceChildren(
    ...speaker.talks.map((talk) => renderPromotionTalk(talk)),
  );
}

function renderPromotionTalk(talk: PromotionTalk): HTMLElement {
  const article = element("article", "grid gap-5 border border-ink p-5 md:p-7");
  const heading = element(
    "h3",
    "font-headline text-3xl font-black uppercase leading-none",
    talk.title,
  );
  const assetGrid = element(
    "div",
    "grid gap-px bg-ink sm:grid-cols-2 xl:grid-cols-3",
  );

  for (const asset of talk.assets) {
    const card = element("div", "grid gap-3 bg-paper p-4");
    const label = element(
      "p",
      "font-bold uppercase",
      promotionLabel(asset.presetId),
    );
    const dimensions = element(
      "p",
      "text-sm text-muted",
      `${asset.width} × ${asset.height} JPG`,
    );
    const actions = element("div", "flex flex-wrap gap-2");
    const versionedPath = `${asset.path}?v=${asset.version}`;
    const preview = link("Preview", versionedPath, false);
    const download = link("Download", versionedPath, true);

    actions.appendChild(preview);
    actions.appendChild(download);
    card.appendChild(label);
    card.appendChild(dimensions);
    card.appendChild(actions);
    assetGrid.appendChild(card);
  }

  article.appendChild(heading);
  article.appendChild(assetGrid);
  return article;
}

function link(
  label: string,
  href: string,
  download: boolean,
): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.className =
    "border border-ink px-3 py-2 text-sm font-bold uppercase transition hover:bg-ink hover:text-paper";
  anchor.href = href;
  anchor.textContent = label;

  if (download) anchor.download = "";
  else {
    anchor.target = "_blank";
    anchor.rel = "noopener";
  }

  return anchor;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentWorkspace || !form) return;

  const submitter = (event as SubmitEvent)
    .submitter as HTMLButtonElement | null;
  const action = submitter?.value === "submit" ? "submit" : "save";
  const content = readFormContent();

  clearErrors();
  setBusy(true);
  setStatus(action === "submit" ? "Submitting…" : "Saving…");

  const response = await requestJson<WorkspaceResponse>(
    "/api/speaker/workspace",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, content }),
    },
  );

  setBusy(false);

  if (!response.ok) {
    showFieldErrors(response.data.field_errors ?? {});
    setStatus(response.data.error ?? "Changes could not be saved.", true);
    return;
  }

  currentWorkspace = response.data;
  renderWorkspace(response.data);
  setStatus(response.data.message ?? "Saved.");
});

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  await requestJson("/api/speaker/session", { method: "DELETE" });
  location.reload();
});

function readFormContent(): WorkspaceContent {
  const formData = new FormData(form!);
  const profile = Object.fromEntries(
    [
      "name",
      "role",
      "bio",
      "website",
      "linkedin",
      "x",
      "github",
      "devto",
      "scholar",
    ].map((field) => [field, String(formData.get(`profile.${field}`) ?? "")]),
  ) as unknown as WorkspaceProfile;
  const talks = [
    ...(talkContainer?.querySelectorAll<HTMLFieldSetElement>(
      "[data-talk-index]",
    ) ?? []),
  ].map((fieldset) => ({
    abstract:
      fieldset.querySelector<HTMLTextAreaElement>('[name="talk.abstract"]')
        ?.value ?? "",
    id:
      fieldset.querySelector<HTMLInputElement>('[name="talk.id"]')?.value ?? "",
    title:
      fieldset.querySelector<HTMLInputElement>('[name="talk.title"]')?.value ??
      "",
  }));

  return { profile, talks };
}

function showFieldErrors(errors: Record<string, string>): void {
  for (const [field, message] of Object.entries(errors)) {
    if (field.startsWith("talks.")) {
      const [, index, talkField] = field.split(".");
      const fieldset = talkContainer?.querySelector<HTMLElement>(
        `[data-talk-index="${index}"]`,
      );
      const target = fieldset?.querySelector<HTMLElement>(
        `[data-talk-error="${talkField}"]`,
      );
      if (target) target.textContent = message;
      continue;
    }

    const target = document.querySelector<HTMLElement>(
      `[data-error-for="${field}"]`,
    );
    if (target) target.textContent = message;
  }
}

function clearErrors(): void {
  for (const target of document.querySelectorAll<HTMLElement>(
    "[data-error-for], [data-talk-error]",
  )) {
    target.textContent = "";
  }
}

function setLockedState(
  revisionState: "approved" | "draft" | "submitted" | null,
): void {
  if (!form) return;
  const locked = revisionState === "submitted" || revisionState === "approved";

  for (const control of form.elements) {
    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLButtonElement
    ) {
      control.disabled = locked;
    }
  }

  if (revisionState === "submitted") {
    setStatus("Submitted changes are awaiting organizer review.");
  } else if (revisionState === "approved") {
    setStatus("Your approved changes are awaiting publication.");
  }
}

function setBusy(busy: boolean): void {
  for (const button of form?.querySelectorAll<HTMLButtonElement>("button") ??
    []) {
    button.disabled = busy;
  }
}

function setStatus(message: string, isError = false): void {
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("text-signal", isError);
}

function showError(message: string): void {
  loading?.setAttribute("hidden", "");
  workspace?.setAttribute("hidden", "");
  errorPanel?.removeAttribute("hidden");
  if (errorMessage) errorMessage.textContent = message;
}

function readInvitationToken(): string {
  const token = location.hash.slice(1);
  return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : "";
}

function promotionLabel(presetId: string): string {
  return (
    {
      bluesky: "Bluesky",
      linkedin: "LinkedIn",
      x: "X",
    }[presetId] ?? presetId
  );
}

function setText(selector: string, value: string): void {
  const target = document.querySelector<HTMLElement>(selector);
  if (target) target.textContent = value;
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

async function requestJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<{ data: T; ok: boolean; status: number }> {
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...init,
    });
    const data = (await response.json()) as T;
    return { data, ok: response.ok, status: response.status };
  } catch {
    return {
      data: { error: "The workspace could not be reached." } as T,
      ok: false,
      status: 0,
    };
  }
}
