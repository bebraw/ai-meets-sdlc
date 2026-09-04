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
  canonical_version: number;
  content: WorkspaceContent;
  error?: string;
  field_errors?: Record<string, string>;
  immutable: {
    photo: string;
    speaker_id: string;
    talk_ids: string[];
    workspace_only: boolean;
  };
  message?: string;
  revision: {
    revision_id: string;
    state: "approved" | "draft" | "submitted";
    submitted_at: string | null;
    updated_at: string;
  } | null;
}

interface SpeakerDinnerResponseData {
  attendance: "attending" | "not_attending";
  cross_contamination: "" | "yes" | "no" | "unsure";
  food_requirements: string;
  meal_preference: "" | "omnivore" | "vegetarian" | "vegan" | "other";
}

interface SpeakerDinnerResponse {
  closed: boolean;
  consent_text: string;
  deadline: string;
  error?: string;
  message?: string;
  responded_at: string | null;
  response: SpeakerDinnerResponseData | null;
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

interface SpeakerPhotoStatus {
  error?: string;
  message?: string;
  photo: {
    image_url: string;
    review_note: string | null;
    state: "approved" | "submitted";
    updated_at: string;
  } | null;
}

interface SpeakerVideoSubmission {
  duration_seconds: number | null;
  error_code: string | null;
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

interface SpeakerVideosResponse {
  error?: string;
  submissions: SpeakerVideoSubmission[];
}

const videoPermissionText =
  "I confirm that I created or control this video and grant Toska Osuuskunta permission to use it for SDLCAI promotion according to the options selected here. I understand that the upload remains private until organizer review and that I can contact info@sdlcai.org to withdraw permission for future use.";

const loading = document.querySelector<HTMLElement>("[data-speaker-loading]");
const loginPanel = document.querySelector<HTMLElement>("[data-speaker-login]");
const loginMessage = document.querySelector<HTMLElement>(
  "[data-speaker-login-message]",
);
const defaultLoginMessage = loginMessage?.textContent?.trim() ?? "";
const loginForm = document.querySelector<HTMLFormElement>(
  "[data-speaker-login-form]",
);
const loginStatus = document.querySelector<HTMLElement>(
  "[data-speaker-login-status]",
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
const dinnerForm = document.querySelector<HTMLFormElement>(
  "[data-speaker-dinner-form]",
);
const dinnerStatus = document.querySelector<HTMLElement>(
  "[data-speaker-dinner-status]",
);
let currentWorkspace: WorkspaceResponse | null = null;

void initialize();

async function initialize(): Promise<void> {
  const signInToken = readSignInToken();

  if (signInToken) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);

    const redemption = await requestJson<{
      authenticated?: boolean;
      error?: string;
    }>("/api/speaker/session", {
      method: "POST",
      headers: { authorization: `Bearer ${signInToken}` },
    });

    if (!redemption.ok) {
      showLogin(
        redemption.data.error ??
          "That sign-in link is invalid or expired. Request a fresh one below.",
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
    showLogin(
      response.status === 401
        ? undefined
        : (response.data.error ?? "The workspace could not be loaded."),
    );
    return;
  }

  currentWorkspace = response.data;
  renderWorkspace(response.data);
  await Promise.all([
    loadPromotions(
      response.data.immutable.speaker_id,
      response.data.immutable.workspace_only,
    ),
    loadPhotoStatus(),
    loadVideos(),
    loadDinner(),
  ]);
}

function renderWorkspace(data: WorkspaceResponse): void {
  loading?.setAttribute("hidden", "");
  loginPanel?.setAttribute("hidden", "");
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
  renderVideoTalkOptions(data.content.talks);
  setLockedState(data.revision?.state ?? null);
}

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!loginForm.reportValidity()) return;

  const formData = new FormData(loginForm);
  const turnstileToken = String(
    formData.get("cf-turnstile-response") ?? "",
  ).trim();
  const turnstileWidget = loginForm.querySelector<HTMLElement>(
    "[data-speaker-login-turnstile]",
  );
  const turnstileConfigured = Boolean(
    turnstileWidget?.dataset.sitekey &&
    turnstileWidget.dataset.sitekey !== "__TURNSTILE_SITE_KEY__",
  );

  if (turnstileConfigured && !turnstileToken) {
    setLoginStatus("Complete the verification first.", true);
    return;
  }

  const submit = loginForm.querySelector<HTMLButtonElement>(
    "[data-speaker-login-submit]",
  );
  if (submit) submit.disabled = true;
  setLoginStatus("Requesting a private sign-in link…");

  const response = await requestJson<{
    accepted?: boolean;
    error?: string;
    message?: string;
  }>("/api/speaker/login", {
    body: JSON.stringify({
      email: formData.get("email"),
      turnstile_token: turnstileToken,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (submit) submit.disabled = false;
  window.turnstile?.reset("#speaker-login-turnstile");
  setLoginStatus(
    response.data.message ??
      response.data.error ??
      "The sign-in link could not be requested.",
    !response.ok,
  );
});

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

async function loadPromotions(
  speakerId: string,
  workspaceOnly: boolean,
): Promise<void> {
  if (!promotionContainer) return;

  const response = await requestJson<PromotionManifest>(
    "/assets/social/speakers.json",
  );
  const speaker = response.data.speakers?.find(({ id }) => id === speakerId);

  if (workspaceOnly && !speaker) {
    promotionContainer.textContent =
      "Promotion graphics are not generated for this private test account.";
    return;
  }

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
      body: JSON.stringify({
        action,
        base_content_version: currentWorkspace.canonical_version,
        content,
      }),
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

for (const attendance of dinnerForm?.querySelectorAll<HTMLInputElement>(
  '[name="attendance"]',
) ?? []) {
  attendance.addEventListener("change", updateDinnerMealVisibility);
}

dinnerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!dinnerForm.reportValidity()) return;

  const formData = new FormData(dinnerForm);
  const attendance = String(formData.get("attendance") ?? "");
  const submit = dinnerForm.querySelector<HTMLButtonElement>(
    "[data-speaker-dinner-submit]",
  );

  if (submit) submit.disabled = true;
  setDinnerStatus("Saving private dinner response…");

  const response = await requestJson<SpeakerDinnerResponse>(
    "/api/speaker/dinner",
    {
      body: JSON.stringify({
        attendance,
        consent: formData.get("consent") === "yes",
        cross_contamination:
          attendance === "attending" ? formData.get("cross_contamination") : "",
        food_requirements:
          attendance === "attending" ? formData.get("food_requirements") : "",
        meal_preference:
          attendance === "attending" ? formData.get("meal_preference") : "",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );

  if (submit) submit.disabled = false;

  if (!response.ok) {
    setDinnerStatus(
      response.data.error ?? "Dinner response could not be saved.",
      true,
    );
    return;
  }

  renderDinner(response.data);
  setDinnerStatus(response.data.message ?? "Dinner response saved.");
});

async function loadDinner(): Promise<void> {
  if (!dinnerForm) return;

  const response = await requestJson<SpeakerDinnerResponse>(
    "/api/speaker/dinner",
  );

  if (!response.ok) {
    setDinnerStatus(
      response.data.error ?? "Dinner details could not be loaded.",
      true,
    );
    return;
  }

  renderDinner(response.data);
}

function renderDinner(data: SpeakerDinnerResponse): void {
  if (!dinnerForm) return;

  const response = data.response;

  for (const attendance of dinnerForm.querySelectorAll<HTMLInputElement>(
    '[name="attendance"]',
  )) {
    attendance.checked = attendance.value === response?.attendance;
  }

  const mealPreference = dinnerForm.elements.namedItem("meal_preference");
  const crossContamination = dinnerForm.elements.namedItem(
    "cross_contamination",
  );
  const foodRequirements = dinnerForm.elements.namedItem("food_requirements");
  const consent = dinnerForm.elements.namedItem("consent");

  if (mealPreference instanceof HTMLSelectElement) {
    mealPreference.value = response?.meal_preference ?? "";
  }
  if (crossContamination instanceof HTMLSelectElement) {
    crossContamination.value = response?.cross_contamination ?? "";
  }
  if (foodRequirements instanceof HTMLTextAreaElement) {
    foodRequirements.value = response?.food_requirements ?? "";
  }
  if (consent instanceof HTMLInputElement) consent.checked = false;

  const consentCopy = dinnerForm.querySelector<HTMLElement>(
    "[data-speaker-dinner-consent]",
  );
  if (consentCopy && data.consent_text) {
    consentCopy.textContent = data.consent_text;
  }

  updateDinnerMealVisibility();

  if (data.closed) {
    for (const control of dinnerForm.elements) {
      if (
        control instanceof HTMLInputElement ||
        control instanceof HTMLTextAreaElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLButtonElement
      ) {
        control.disabled = true;
      }
    }
    setDinnerStatus(
      `Dinner responses closed on ${formatWorkspaceDate(data.deadline)}.`,
    );
  } else if (data.responded_at) {
    setDinnerStatus(`Last saved ${formatWorkspaceDate(data.responded_at)}.`);
  } else {
    setDinnerStatus(`Please respond by ${formatWorkspaceDate(data.deadline)}.`);
  }
}

function updateDinnerMealVisibility(): void {
  if (!dinnerForm) return;

  const selected = dinnerForm.querySelector<HTMLInputElement>(
    '[name="attendance"]:checked',
  );
  const mealFields = dinnerForm.querySelector<HTMLElement>(
    "[data-speaker-dinner-meal]",
  );
  const attending = selected?.value === "attending";

  mealFields?.toggleAttribute("hidden", !attending);

  for (const control of mealFields?.querySelectorAll("select, textarea") ??
    []) {
    if (
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ) {
      control.disabled = !attending;
    }
  }
}

function setDinnerStatus(message: string, isError = false): void {
  if (!dinnerStatus) return;
  dinnerStatus.textContent = message;
  dinnerStatus.classList.toggle("text-signal", isError);
}

document
  .querySelector<HTMLFormElement>("[data-speaker-photo-form]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>(
      "[data-speaker-photo-input]",
    );
    const button = document.querySelector<HTMLButtonElement>(
      "[data-speaker-photo-submit]",
    );
    const file = input?.files?.[0];

    if (!file) {
      setPhotoStatus("Choose a portrait first.", true);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setPhotoStatus("Photo must be no larger than 5 MB.", true);
      return;
    }

    if (button) button.disabled = true;
    setPhotoStatus("Decoding, cropping, and re-encoding…");
    const response = await requestJson<SpeakerPhotoStatus>(
      "/api/speaker/photo",
      {
        body: file,
        headers: { "content-type": "application/octet-stream" },
        method: "POST",
      },
    );
    if (button) button.disabled = false;

    if (!response.ok) {
      setPhotoStatus(
        response.data.error ?? "Photo could not be processed.",
        true,
      );
      return;
    }

    if (input) input.value = "";
    setPhotoStatus(response.data.message ?? "Photo submitted.");
    await loadPhotoStatus();
  });

async function loadPhotoStatus(): Promise<void> {
  const response = await requestJson<SpeakerPhotoStatus>("/api/speaker/photo");

  if (!response.ok || !response.data.photo) return;

  const photo = document.querySelector<HTMLImageElement>(
    "[data-speaker-photo]",
  );
  const state = document.querySelector<HTMLElement>(
    "[data-speaker-photo-state]",
  );
  if (photo) photo.src = response.data.photo.image_url;
  if (state) {
    state.textContent =
      response.data.photo.state === "approved"
        ? "Approved and published"
        : "Replacement / awaiting review";
  }
  if (response.data.photo.review_note) {
    setPhotoStatus(response.data.photo.review_note, true);
  }
}

function setPhotoStatus(message: string, isError = false): void {
  const target = document.querySelector<HTMLElement>(
    "[data-speaker-photo-status]",
  );
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("text-signal", isError);
}

document
  .querySelector<HTMLFormElement>("[data-speaker-video-form]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fileInput = document.querySelector<HTMLInputElement>(
      "[data-speaker-video-input]",
    );
    const talkSelectTarget = document.querySelector(
      "[data-speaker-video-talk]",
    );
    const talkSelect =
      talkSelectTarget instanceof HTMLSelectElement ? talkSelectTarget : null;
    const submit = document.querySelector<HTMLButtonElement>(
      "[data-speaker-video-submit]",
    );
    const file = fileInput?.files?.[0];

    if (!form.reportValidity() || !file || !talkSelect?.value) return;

    if (file.size > 200 * 1024 * 1024) {
      setVideoStatus("Video must be no larger than 200 MB.", true);
      return;
    }

    if (submit) submit.disabled = true;
    setVideoStatus("Creating a private one-time upload…");
    const permissions = Object.fromEntries(
      ["may_publish", "may_caption", "may_crop", "may_excerpt", "may_edit"].map(
        (name) => [
          name,
          Boolean(
            document.querySelector<HTMLInputElement>(
              `[data-video-permission="${name}"]`,
            )?.checked,
          ),
        ],
      ),
    );
    const creation = await requestJson<{
      error?: string;
      upload_url?: string;
    }>("/api/speaker/videos/upload", {
      body: JSON.stringify({
        permission_text: videoPermissionText,
        permissions,
        talk_id: talkSelect.value,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    if (!creation.ok || !creation.data.upload_url) {
      if (submit) submit.disabled = false;
      setVideoStatus(
        creation.data.error ?? "Private upload could not be created.",
        true,
      );
      return;
    }

    try {
      await uploadVideoDirectly(creation.data.upload_url, file);
      setVideoStatus(
        "Upload complete. Stream is processing the private video; this status updates after verification.",
      );
      if (fileInput) fileInput.value = "";
      await loadVideos();
    } catch (error) {
      setVideoStatus(
        error instanceof Error ? error.message : "Video upload failed.",
        true,
      );
    } finally {
      if (submit) submit.disabled = false;
      setVideoProgress(null);
    }
  });

function renderVideoTalkOptions(talks: WorkspaceTalk[]): void {
  const selectTarget = document.querySelector("[data-speaker-video-talk]");
  if (!(selectTarget instanceof HTMLSelectElement)) return;
  const select = selectTarget;
  const previous = select.value;
  select.replaceChildren(
    ...talks.map((talk) => {
      const option = document.createElement("option");
      option.value = talk.id;
      option.textContent = talk.title;
      return option;
    }),
  );
  if (talks.some(({ id }) => id === previous)) select.value = previous;
}

async function loadVideos(): Promise<void> {
  const container = document.querySelector<HTMLElement>(
    "[data-speaker-videos]",
  );
  if (!container) return;
  const response = await requestJson<SpeakerVideosResponse>(
    "/api/speaker/videos",
  );

  if (!response.ok || !Array.isArray(response.data.submissions)) {
    container.textContent =
      response.data.error ?? "Video status is unavailable.";
    return;
  }

  if (response.data.submissions.length === 0) {
    container.textContent = "No private topic video has been submitted yet.";
    return;
  }

  container.replaceChildren(
    ...response.data.submissions.map((video) => renderVideo(video)),
  );
}

function renderVideo(video: SpeakerVideoSubmission): HTMLElement {
  const article = element(
    "article",
    "grid gap-3 border border-ink p-4 sm:grid-cols-[1fr_auto] sm:items-center",
  );
  const copy = element("div", "grid gap-1");
  const talk = currentWorkspace?.content.talks.find(
    ({ id }) => id === video.talk_id,
  );
  copy.appendChild(
    element("p", "font-bold uppercase", talk?.title ?? video.talk_id),
  );
  copy.appendChild(
    element(
      "p",
      "text-sm text-muted",
      `${videoStateLabel(video.state)}${video.duration_seconds ? ` / ${Math.round(video.duration_seconds)} seconds` : ""}`,
    ),
  );
  if (video.review_note || video.error_code) {
    copy.appendChild(
      element(
        "p",
        "text-sm font-bold text-signal",
        video.review_note ?? video.error_code ?? "",
      ),
    );
  }
  article.appendChild(copy);

  if (video.preview_endpoint) {
    const button = element(
      "button",
      "border border-ink px-4 py-3 text-sm font-bold uppercase",
      "Private preview",
    ) as HTMLButtonElement;
    button.type = "button";
    button.addEventListener(
      "click",
      () => void openVideoPreview(video, button),
    );
    article.appendChild(button);
  }

  return article;
}

async function openVideoPreview(
  video: SpeakerVideoSubmission,
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
    setVideoStatus(
      response.data.error ?? "Private preview is unavailable.",
      true,
    );
    return;
  }

  if (previewWindow) previewWindow.location.href = response.data.preview_url;
}

function uploadVideoDirectly(uploadUrl: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const body = new FormData();
    body.append("file", file);
    request.open("POST", uploadUrl);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setVideoProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error("Stream did not accept the video upload."));
    });
    request.addEventListener("error", () =>
      reject(new Error("The video upload was interrupted.")),
    );
    request.addEventListener("abort", () =>
      reject(new Error("The video upload was cancelled.")),
    );
    setVideoProgress(0);
    request.send(body);
  });
}

function setVideoProgress(percent: number | null): void {
  const track = document.querySelector<HTMLElement>(
    "[data-speaker-video-progress]",
  );
  const bar = document.querySelector<HTMLElement>(
    "[data-speaker-video-progress-bar]",
  );
  if (!track || !bar) return;
  if (percent === null) {
    track.setAttribute("hidden", "");
    bar.style.width = "0%";
    return;
  }
  track.removeAttribute("hidden");
  bar.style.width = `${Math.max(0, Math.min(percent, 100))}%`;
}

function setVideoStatus(message: string, isError = false): void {
  const target = document.querySelector<HTMLElement>(
    "[data-speaker-video-status]",
  );
  if (!target) return;
  target.textContent = message;
  target.classList.toggle("text-signal", isError);
}

function videoStateLabel(state: SpeakerVideoSubmission["state"]): string {
  return {
    approved: "Approved for promotion",
    changes_requested: "Organizer requested changes",
    error: "Processing failed",
    processing: "Processing privately",
    ready: "Ready for organizer review",
    upload_pending: "Upload created / processing not yet verified",
  }[state];
}

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
    setStatus("Your approved changes are published.");
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

function showLogin(message?: string): void {
  loading?.setAttribute("hidden", "");
  workspace?.setAttribute("hidden", "");
  logoutButton?.setAttribute("hidden", "");
  loginPanel?.removeAttribute("hidden");
  if (loginMessage) loginMessage.textContent = message ?? defaultLoginMessage;
}

function setLoginStatus(message: string, isError = false): void {
  if (!loginStatus) return;
  loginStatus.textContent = message;
  loginStatus.classList.toggle("text-signal", isError);
}

function readSignInToken(): string {
  const token = location.hash.slice(1);
  return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : "";
}

function formatWorkspaceDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
