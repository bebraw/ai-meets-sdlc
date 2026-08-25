declare global {
  interface Window {
    onInterestTurnstileExpired?: () => void;
    onInterestTurnstileError?: (errorCode?: string) => boolean;
    onInterestTurnstileSuccess?: () => void;
    onPosterTurnstileExpired?: () => void;
    onPosterTurnstileError?: (errorCode?: string) => boolean;
    onPosterTurnstileSuccess?: () => void;
    turnstile?: {
      reset: (widget?: string) => void;
    };
  }
}

type FormResponse = {
  detail?: string;
  duplicate?: boolean;
  error?: string;
  message?: string;
};

type InterestContact = {
  created_at: string;
  email: string;
  name: string;
  organization: string;
};

const posterStatuses = [
  "submitted",
  "shortlisted",
  "accepted",
  "waitlisted",
  "declined",
  "withdrawn",
] as const;

type PosterStatus = (typeof posterStatuses)[number];

type PosterProposal = {
  abstract: string;
  authors: string;
  consent_text: string;
  created_at: string;
  email: string;
  id: number;
  name: string;
  organization: string;
  poster_size: "a0" | "a1" | "either";
  reviewed_at: string | null;
  setup_notes: string;
  status: PosterStatus;
  supporting_url: string;
  terms_text: string;
  title: string;
  updated_at: string;
};

type SpeakerDinnerResponse = {
  attendance: "attending" | "not_attending";
  cross_contamination: "" | "yes" | "no" | "unsure";
  food_requirements: string;
  meal_preference: "" | "omnivore" | "vegetarian" | "vegan" | "other";
};

type SpeakerDinnerAdminItem = {
  expires_at: string | null;
  invited: boolean;
  name: string;
  responded_at: string | null;
  response: SpeakerDinnerResponse | null;
  speaker_id: string;
  updated_at: string | null;
};

type SpeakerDinnerSharedAdminItem = {
  name: string;
  responded_at: string;
  response: SpeakerDinnerResponse;
  updated_at: string;
};

type SpeakerDinnerStatus = {
  closed: boolean;
  deadline: string;
  name: string;
  responded_at: string | null;
  response: SpeakerDinnerResponse | null;
};

const units: [string, number][] = [
  ["days", 24 * 60 * 60 * 1000],
  ["hours", 60 * 60 * 1000],
  ["minutes", 60 * 1000],
  ["seconds", 1000],
];

function renderCountdown(): boolean {
  const root = document.querySelector<HTMLElement>("[data-countdown]");
  const expiresAt = Date.parse(
    root?.closest<HTMLElement>("[data-expires-at]")?.dataset.expiresAt ?? "",
  );

  if (!root || !Number.isFinite(expiresAt)) return false;

  let remaining = expiresAt - Date.now();

  if (remaining <= 0) return false;

  for (const [name, size] of units) {
    const value = Math.floor(remaining / size);
    remaining -= value * size;

    const node = root.querySelector(`[data-countdown-unit="${name}"]`);

    if (node) {
      node.textContent = String(value).padStart(name === "days" ? 3 : 2, "0");
    }
  }

  return true;
}

function initCountdown() {
  if (!renderCountdown()) return;

  const intervalId = window.setInterval(() => {
    if (!renderCountdown()) {
      window.clearInterval(intervalId);
    }
  }, 1000);
}

function initExpiringElements() {
  const elements = document.querySelectorAll<HTMLElement>("[data-expires-at]");

  for (const element of elements) {
    const expiresAt = Date.parse(element.dataset.expiresAt ?? "");

    if (!Number.isFinite(expiresAt)) continue;

    function updateVisibility() {
      const remaining = expiresAt - Date.now();

      element.hidden = remaining <= 0;

      if (remaining > 0) {
        window.setTimeout(updateVisibility, Math.min(remaining, 2_147_000_000));
      }
    }

    updateVisibility();
  }
}

function setTheme(theme: "dark" | "light") {
  const themeLabel = document.querySelector("[data-theme-label]");

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;

  if (themeLabel) {
    themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
  }

  try {
    localStorage.setItem("sdlcai-theme", theme);
  } catch {
    // Ignore blocked storage.
  }
}

function initThemeToggle() {
  const themeToggle = document.querySelector("[data-theme-toggle]");

  setTheme(
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  themeToggle?.addEventListener("click", () => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "light" : "dark",
    );
  });
}

function initTurnstileWidgets() {
  const widgets = document.querySelectorAll<HTMLElement>(
    "[data-turnstile-widget], [data-poster-turnstile]",
  );
  let hasVisibleWidget = false;

  for (const widget of widgets) {
    const interestSection = widget.closest<HTMLElement>(
      "[data-interest-section]",
    );
    const hasConfiguredSiteKey = Boolean(
      widget.dataset.sitekey &&
      widget.dataset.sitekey !== "__TURNSTILE_SITE_KEY__",
    );

    if (interestSection?.hidden || !hasConfiguredSiteKey) {
      widget.hidden = true;
    }

    hasVisibleWidget ||= !widget.hidden;
  }

  const hasTurnstileScript = Boolean(
    document.querySelector(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
    ),
  );

  if (hasVisibleWidget && !hasTurnstileScript) {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.addEventListener("error", () => {
      for (const widget of widgets) {
        if (widget.hidden) continue;

        if (widget.matches("[data-poster-turnstile]")) {
          window.onPosterTurnstileError?.();
        } else if (widget.matches("[data-turnstile-widget]")) {
          window.onInterestTurnstileError?.();
        }
      }
    });
    document.head.appendChild(script);
  }
}

function initInterestForm() {
  const foundInterestForm = document.querySelector<HTMLFormElement>(
    "[data-interest-form]",
  );
  const interestStatus = document.querySelector("[data-interest-status]");
  const submitButton = document.querySelector<HTMLButtonElement>(
    "[data-interest-submit]",
  );

  if (!foundInterestForm) return;

  const interestForm = foundInterestForm;
  const turnstileWidget = interestForm.querySelector<HTMLElement>(
    "[data-turnstile-widget]",
  );
  let isSubmitting = false;

  function setInterestStatus(message: string) {
    if (interestStatus) {
      interestStatus.textContent = message;
    }
  }

  function resetTurnstile() {
    if (
      window.turnstile &&
      turnstileWidget?.dataset.sitekey &&
      !turnstileWidget.hidden
    ) {
      window.turnstile.reset("#interest-turnstile");
    }
  }

  function hasTurnstileToken() {
    if (!turnstileWidget || turnstileWidget.hidden) return true;

    return Boolean(
      interestForm
        .querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
        ?.value.trim(),
    );
  }

  function updateSubmitState() {
    if (!submitButton) return;

    submitButton.disabled =
      isSubmitting || !interestForm.checkValidity() || !hasTurnstileToken();
  }

  window.onInterestTurnstileSuccess = updateSubmitState;
  window.onInterestTurnstileExpired = updateSubmitState;
  window.onInterestTurnstileError = () => {
    setInterestStatus(
      "Spam check unavailable. Refresh the page and try again.",
    );
    updateSubmitState();

    return true;
  };

  interestForm.addEventListener("input", updateSubmitState);
  interestForm.addEventListener("change", updateSubmitState);
  updateSubmitState();

  async function submitInterestForm() {
    if (!submitButton || submitButton.disabled) return;

    isSubmitting = true;
    submitButton.disabled = true;
    setInterestStatus("Sending...");

    try {
      const response = await fetch(interestForm.action, {
        method: "POST",
        body: new FormData(interestForm),
      });
      const contentType = response.headers.get("content-type") || "";
      const result: FormResponse = contentType.includes("application/json")
        ? ((await response.json()) as FormResponse)
        : {
            error: `${response.status} ${response.statusText || "Unexpected response"}`,
            detail: await response.text(),
          };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Submission failed");
      }

      setInterestStatus(result.message || "Thanks. You are on the list.");
      interestForm.reset();
    } catch (error) {
      setInterestStatus(
        error instanceof Error ? error.message : "Submission failed",
      );
    } finally {
      resetTurnstile();
      isSubmitting = false;
      updateSubmitState();
    }
  }

  interestForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    await submitInterestForm();
  });
}

function initPosterForm() {
  const posterForm =
    document.querySelector<HTMLFormElement>("[data-poster-form]");
  const posterStatus = document.querySelector("[data-poster-status]");
  const submitButton = document.querySelector<HTMLButtonElement>(
    "[data-poster-submit]",
  );

  if (!posterForm || !submitButton) return;

  const form = posterForm;
  const button = submitButton;
  const turnstileWidget = form.querySelector<HTMLElement>(
    "[data-poster-turnstile]",
  );
  let isSubmitting = false;

  function setPosterStatus(message: string) {
    if (posterStatus) posterStatus.textContent = message;
  }

  function hasTurnstileToken() {
    if (!turnstileWidget || turnstileWidget.hidden) return true;

    return Boolean(
      form
        .querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]')
        ?.value.trim(),
    );
  }

  function resetTurnstile() {
    if (
      window.turnstile &&
      turnstileWidget?.dataset.sitekey &&
      !turnstileWidget.hidden
    ) {
      window.turnstile.reset("#poster-turnstile");
    }
  }

  function updateSubmitState() {
    button.disabled = isSubmitting;
  }

  window.onPosterTurnstileSuccess = () => {
    if (
      posterStatus?.textContent?.startsWith("Spam check") ||
      posterStatus?.textContent === "Complete the spam check before submitting."
    ) {
      setPosterStatus("");
    }

    updateSubmitState();
  };
  window.onPosterTurnstileExpired = () => {
    setPosterStatus("Spam check expired. Please complete it again.");
    updateSubmitState();
  };
  window.onPosterTurnstileError = () => {
    setPosterStatus("Spam check unavailable. Refresh the page and try again.");
    updateSubmitState();

    return true;
  };

  form.addEventListener("input", updateSubmitState);
  form.addEventListener("change", updateSubmitState);
  updateSubmitState();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.checkValidity()) {
      form.reportValidity();
      updateSubmitState();
      return;
    }

    if (!hasTurnstileToken()) {
      setPosterStatus("Complete the spam check before submitting.");
      updateSubmitState();
      return;
    }

    if (isSubmitting) return;

    isSubmitting = true;
    updateSubmitState();
    setPosterStatus("Submitting proposal...");

    try {
      const response = await fetch("/api/poster-proposals", {
        method: "POST",
        body: new FormData(form),
      });
      const contentType = response.headers.get("content-type") || "";
      const result: FormResponse = contentType.includes("application/json")
        ? ((await response.json()) as FormResponse)
        : {
            error: `${response.status} ${response.statusText || "Unexpected response"}`,
            detail: await response.text(),
          };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Proposal submission failed");
      }

      form.reset();
      setPosterStatus(
        result.message ||
          (result.duplicate
            ? "We already have this proposal."
            : "Proposal received. Thank you."),
      );
    } catch (error) {
      setPosterStatus(
        error instanceof Error ? error.message : "Proposal submission failed",
      );
    } finally {
      resetTurnstile();
      isSubmitting = false;
      updateSubmitState();
    }
  });
}

function initAdminInterests() {
  const rowsRoot = document.querySelector("[data-admin-interests]");
  const status = document.querySelector("[data-admin-status]");

  if (!rowsRoot) return;

  const rows = rowsRoot;

  function setStatus(message: string) {
    if (status) status.textContent = message;
  }

  function cell(value: string) {
    const td = document.createElement("td");
    td.className = "border-t border-ink px-4 py-3 align-top";
    td.textContent = value || "-";

    return td;
  }

  function renderRows(contacts: InterestContact[]) {
    rows.replaceChildren();

    if (!contacts.length) {
      const tr = document.createElement("tr");
      const td = cell("No interested people yet.");
      td.colSpan = 4;
      tr.appendChild(td);
      rows.appendChild(tr);
      return;
    }

    for (const contact of contacts) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(contact.email));
      tr.appendChild(cell(contact.name));
      tr.appendChild(cell(contact.organization));
      tr.appendChild(cell(contact.created_at));
      rows.appendChild(tr);
    }
  }

  async function loadInterests() {
    try {
      const response = await fetch("/api/admin/interests", {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as {
        contacts?: InterestContact[];
      };
      const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];

      renderRows(contacts);
      setStatus(`${contacts.length} people`);
    } catch (error) {
      renderRows([]);
      setStatus("Failed to load");
      console.error(error);
    }
  }

  void loadInterests();
}

function initAdminPosterProposals() {
  const proposalsRoot = document.querySelector<HTMLElement>(
    "[data-admin-poster-proposals]",
  );
  const adminStatus = document.querySelector("[data-admin-poster-status]");
  const refreshButton = document.querySelector<HTMLButtonElement>(
    "[data-admin-poster-refresh]",
  );

  if (!proposalsRoot) return;
  const root = proposalsRoot;

  function setAdminStatus(message: string) {
    if (adminStatus) adminStatus.textContent = message;
  }

  function createDomElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className?: string,
    textContent?: string,
  ) {
    const element = document.createElement(tagName);

    if (className) element.className = className;
    if (textContent !== undefined) element.textContent = textContent;

    return element;
  }

  function addProposalField(
    list: HTMLElement,
    label: string,
    value: string | number | null,
    wide = false,
  ) {
    const group = createDomElement(
      "div",
      wide ? "grid gap-1 md:col-span-2" : "grid min-w-0 gap-1",
    );
    const term = createDomElement(
      "dt",
      "text-xs font-bold uppercase tracking-wide text-muted",
      label,
    );
    const description = createDomElement(
      "dd",
      "min-w-0 whitespace-pre-wrap break-words leading-6",
      value === null || value === "" ? "-" : String(value),
    );

    group.appendChild(term);
    group.appendChild(description);
    list.appendChild(group);
  }

  function addSupportingUrl(list: HTMLElement, value: string) {
    const group = createDomElement("div", "grid min-w-0 gap-1 md:col-span-2");
    const term = createDomElement(
      "dt",
      "text-xs font-bold uppercase tracking-wide text-muted",
      "Supporting URL",
    );
    const description = createDomElement("dd", "min-w-0 break-words leading-6");
    let url: URL | null = null;

    try {
      const candidate = new URL(value);
      if (candidate.protocol === "https:" || candidate.protocol === "http:") {
        url = candidate;
      }
    } catch {
      // Render invalid or absent URLs as plain text.
    }

    if (url) {
      const link = createDomElement(
        "a",
        "font-bold underline decoration-1 underline-offset-2",
        value,
      );
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      description.appendChild(link);
    } else {
      description.textContent = value || "-";
    }

    group.appendChild(term);
    group.appendChild(description);
    list.appendChild(group);
  }

  function renderProposals(proposals: PosterProposal[]) {
    root.replaceChildren();

    if (!proposals.length) {
      root.appendChild(
        createDomElement(
          "p",
          "border border-ink p-5 text-muted",
          "No poster proposals yet.",
        ),
      );
      return;
    }

    for (const proposal of proposals) {
      const titleId = `poster-proposal-${proposal.id}`;
      const formStatusId = `${titleId}-status`;
      const article = createDomElement("article", "border border-ink bg-paper");
      article.setAttribute("aria-labelledby", titleId);
      article.dataset.posterProposalId = String(proposal.id);

      const header = createDomElement(
        "header",
        "grid gap-4 bg-ink p-5 text-paper md:grid-cols-[minmax(0,1fr)_14rem] md:items-start",
      );
      const headingGroup = createDomElement("div", "min-w-0");
      const eyebrow = createDomElement(
        "p",
        "text-xs font-bold uppercase text-paper/60",
        `Proposal ${proposal.id}`,
      );
      const heading = createDomElement(
        "h3",
        "mt-2 break-words font-headline text-2xl font-black uppercase leading-none md:text-3xl",
        proposal.title || "Untitled proposal",
      );
      heading.id = titleId;
      headingGroup.appendChild(eyebrow);
      headingGroup.appendChild(heading);

      const statusForm = createDomElement(
        "form",
        "grid gap-2 border border-paper/50 p-3",
      );
      statusForm.dataset.adminPosterStatusForm = "";
      const hiddenId = document.createElement("input");
      hiddenId.type = "hidden";
      hiddenId.name = "id";
      hiddenId.value = String(proposal.id);

      const statusLabel = createDomElement("label", "grid gap-1");
      const statusLabelText = createDomElement(
        "span",
        "text-xs font-bold uppercase text-paper/70",
        "Review status",
      );
      const statusSelect = createDomElement(
        "select",
        "border border-paper bg-ink px-3 py-2 font-bold text-paper outline-none focus:ring-2 focus:ring-paper",
      );
      statusSelect.name = "status";
      statusSelect.setAttribute("aria-describedby", formStatusId);

      for (const status of posterStatuses) {
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        option.selected = proposal.status === status;
        statusSelect.appendChild(option);
      }

      statusLabel.appendChild(statusLabelText);
      statusLabel.appendChild(statusSelect);

      const saveButton = createDomElement(
        "button",
        "border border-paper bg-paper px-3 py-2 text-sm font-bold uppercase text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60",
        "Save status",
      );
      saveButton.type = "submit";
      const formStatus = createDomElement(
        "p",
        "min-h-5 text-xs font-bold uppercase text-paper/70",
      );
      formStatus.id = formStatusId;
      formStatus.setAttribute("aria-live", "polite");
      statusForm.appendChild(hiddenId);
      statusForm.appendChild(statusLabel);
      statusForm.appendChild(saveButton);
      statusForm.appendChild(formStatus);

      statusForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const formData = new FormData(statusForm);
        saveButton.disabled = true;
        statusSelect.disabled = true;
        formStatus.textContent = "Saving...";
        setAdminStatus(`Updating proposal ${proposal.id}...`);

        try {
          const response = await fetch("/api/admin/poster-proposals/status", {
            method: "POST",
            headers: {
              accept: "application/json",
              "x-admin-action": "update-poster-status",
            },
            body: formData,
          });
          const contentType = response.headers.get("content-type") || "";
          const result = contentType.includes("application/json")
            ? ((await response.json()) as FormResponse)
            : { error: `${response.status} ${response.statusText}` };

          if (!response.ok || result.error) {
            throw new Error(result.error || "Status update failed");
          }

          await loadProposals(
            `Proposal ${proposal.id} updated to ${statusSelect.value}.`,
            proposal.id,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Status update failed";
          formStatus.textContent = message;
          setAdminStatus(message);
          saveButton.disabled = false;
          statusSelect.disabled = false;
        }
      });

      header.appendChild(headingGroup);
      header.appendChild(statusForm);

      const details = createDomElement(
        "dl",
        "grid gap-x-8 gap-y-6 p-5 text-sm md:grid-cols-2 md:p-6",
      );
      addProposalField(details, "Designated presenter", proposal.name);
      addProposalField(details, "Contact email", proposal.email);
      addProposalField(details, "Organization", proposal.organization);
      if (proposal.authors) {
        addProposalField(
          details,
          "Authors / presenters",
          proposal.authors,
          true,
        );
      }
      addProposalField(details, "Abstract", proposal.abstract, true);
      if (proposal.supporting_url) {
        addSupportingUrl(details, proposal.supporting_url);
      }
      if (proposal.setup_notes) {
        addProposalField(details, "Setup notes", proposal.setup_notes, true);
      }
      addProposalField(details, "Presenter terms", proposal.terms_text, true);
      addProposalField(details, "Privacy consent", proposal.consent_text, true);
      addProposalField(details, "Submitted", proposal.created_at);
      addProposalField(details, "Last updated", proposal.updated_at);
      addProposalField(details, "Reviewed", proposal.reviewed_at);
      addProposalField(details, "Current status", proposal.status);

      article.appendChild(header);
      article.appendChild(details);
      root.appendChild(article);
    }
  }

  async function loadProposals(
    successMessage?: string,
    focusProposalId?: number,
  ) {
    refreshButton?.setAttribute("disabled", "true");
    if (!successMessage) setAdminStatus("Loading poster proposals...");

    try {
      const response = await fetch("/api/admin/poster-proposals", {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const payload = (await response.json()) as {
        count?: number;
        proposals?: PosterProposal[];
      };
      const proposals = Array.isArray(payload.proposals)
        ? payload.proposals
        : [];
      const count =
        typeof payload.count === "number" ? payload.count : proposals.length;

      renderProposals(proposals);
      setAdminStatus(
        successMessage || `${count} poster proposal${count === 1 ? "" : "s"}`,
      );

      if (focusProposalId !== undefined) {
        const focusTarget = root.querySelector(
          `[data-poster-proposal-id="${focusProposalId}"] select[name="status"]`,
        ) as unknown as HTMLSelectElement | null;

        focusTarget?.focus();
      }
    } catch (error) {
      renderProposals([]);
      setAdminStatus(
        error instanceof Error ? error.message : "Failed to load proposals",
      );
      console.error(error);
    } finally {
      refreshButton?.removeAttribute("disabled");
    }
  }

  refreshButton?.addEventListener("click", () => {
    void loadProposals();
  });

  void loadProposals();
}

function initSpeakerDinnerForm() {
  const form = document.querySelector<HTMLFormElement>("[data-dinner-form]");

  if (!form) return;
  const dinnerForm = form;

  const loading = document.querySelector<HTMLElement>("[data-dinner-loading]");
  const errorRoot = document.querySelector<HTMLElement>("[data-dinner-error]");
  const errorMessage = document.querySelector<HTMLElement>(
    "[data-dinner-error-message]",
  );
  const speakerName = dinnerForm.querySelector<HTMLElement>(
    "[data-dinner-speaker-name]",
  );
  const deadline = dinnerForm.querySelector<HTMLElement>(
    "[data-dinner-deadline]",
  );
  const mealFields = dinnerForm.querySelector<HTMLElement>(
    "[data-dinner-meal-fields]",
  );
  const submitButton = dinnerForm.querySelector<HTMLButtonElement>(
    "[data-dinner-submit]",
  );
  const status = dinnerForm.querySelector<HTMLElement>("[data-dinner-status]");
  const nameField = dinnerForm.querySelector<HTMLElement>(
    "[data-dinner-name-field]",
  );
  const nameInput = dinnerForm.elements.namedItem("name");
  const inviteEyebrow = document.querySelector<HTMLElement>(
    "[data-dinner-invite-eyebrow]",
  );
  const linkCopy = document.querySelector<HTMLElement>(
    "[data-dinner-link-copy]",
  );
  const isSharedInvitation = location.pathname === "/speaker-dinner/shared/";
  const apiEndpoint = isSharedInvitation
    ? "/api/speaker-dinner/shared"
    : "/api/speaker-dinner";
  const tokenStorageKey = isSharedInvitation
    ? "sdlcai-speaker-dinner-shared-token"
    : "sdlcai-speaker-dinner-token";
  const responseIdStorageKey = "sdlcai-speaker-dinner-shared-response-id";
  let token = window.location.hash.slice(1);
  let responseId = "";
  let isClosed = false;

  if (isSharedInvitation) {
    if (inviteEyebrow) {
      inviteEyebrow.textContent = "Shared invitation / 12.10.2026";
    }
    if (linkCopy) {
      linkCopy.textContent =
        "This shared link is for speakers and organizers. Dinner timing and venue details will be shared separately.";
    }
    if (speakerName) speakerName.textContent = "Speakers + organizers";
    if (nameField) nameField.hidden = false;
    if (nameInput instanceof HTMLInputElement) nameInput.required = true;

    try {
      responseId = sessionStorage.getItem(responseIdStorageKey) ?? "";

      if (!responseId) {
        responseId = crypto.randomUUID();
        sessionStorage.setItem(responseIdStorageKey, responseId);
      }
    } catch {
      responseId = crypto.randomUUID();
    }
  }

  if (/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    try {
      sessionStorage.setItem(tokenStorageKey, token);
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    } catch {
      // The token remains available in memory if storage is blocked.
    }
  } else {
    token = "";

    try {
      token = sessionStorage.getItem(tokenStorageKey) ?? "";
    } catch {
      // A tokenless page shows the invitation help state below.
    }
  }

  function setStatus(message: string) {
    if (status) status.textContent = message;
  }

  function getDinnerRequestHeaders() {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    };

    if (isSharedInvitation) {
      headers["x-dinner-response-id"] = responseId;
    }

    return headers;
  }

  function setRadioValue(name: string, value: string) {
    for (const input of dinnerForm.querySelectorAll<HTMLInputElement>(
      `input[name="${name}"]`,
    )) {
      input.checked = input.value === value;
    }
  }

  function updateMealFields() {
    const attending =
      dinnerForm.querySelector<HTMLInputElement>(
        'input[name="attendance"]:checked',
      )?.value === "attending";

    if (mealFields) mealFields.hidden = !attending;

    for (const input of dinnerForm.querySelectorAll<HTMLInputElement>(
      'input[name="meal_preference"], input[name="cross_contamination"]',
    )) {
      input.required = attending;
    }
  }

  function showError(message: string) {
    if (loading) loading.hidden = true;
    dinnerForm.hidden = true;
    if (errorMessage) errorMessage.textContent = message;
    if (errorRoot) errorRoot.hidden = false;
  }

  function renderResponse(payload: SpeakerDinnerStatus) {
    if (loading) loading.hidden = true;
    if (errorRoot) errorRoot.hidden = true;
    dinnerForm.hidden = false;
    if (speakerName && !isSharedInvitation) {
      speakerName.textContent = payload.name;
    }
    if (deadline) {
      deadline.textContent = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "long",
        timeZone: "Europe/Helsinki",
      }).format(new Date(payload.deadline));
    }

    if (payload.response) {
      setRadioValue("attendance", payload.response.attendance);
      setRadioValue("meal_preference", payload.response.meal_preference);
      setRadioValue(
        "cross_contamination",
        payload.response.cross_contamination,
      );
      const requirements = dinnerForm.elements.namedItem("food_requirements");

      if (requirements instanceof HTMLTextAreaElement) {
        requirements.value = payload.response.food_requirements;
      }
    }

    if (
      isSharedInvitation &&
      nameInput instanceof HTMLInputElement &&
      payload.name
    ) {
      nameInput.value = payload.name;
    }

    updateMealFields();
    isClosed = payload.closed;

    if (isClosed) {
      for (const control of dinnerForm.elements) {
        if (
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLButtonElement
        ) {
          control.disabled = true;
        }
      }
      setStatus(
        "The response deadline has passed. Your saved response is shown above.",
      );
    } else if (payload.responded_at) {
      setStatus("Your saved response is ready to update.");
    }
  }

  dinnerForm.addEventListener("change", updateMealFields);

  dinnerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isClosed || !submitButton) return;

    if (!dinnerForm.checkValidity()) {
      dinnerForm.reportValidity();
      setStatus("Complete the required fields before saving.");
      return;
    }

    submitButton.disabled = true;
    setStatus("Saving your response...");

    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: getDinnerRequestHeaders(),
        body: new FormData(dinnerForm),
      });
      const result = (await response.json()) as FormResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Could not save your response.");
      }

      setStatus(result.message || "Your dinner response has been saved.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not save your response.",
      );
    } finally {
      submitButton.disabled = false;
    }
  });

  async function loadInvitation() {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      showError(
        isSharedInvitation
          ? "This page needs the shared invitation link sent by the SDLCAI team."
          : "This page needs the unique link sent to you by the SDLCAI team.",
      );
      return;
    }

    try {
      const response = await fetch(apiEndpoint, {
        headers: getDinnerRequestHeaders(),
      });
      const payload = (await response.json()) as SpeakerDinnerStatus &
        FormResponse;

      if (!response.ok || payload.error) {
        throw new Error(
          payload.error || "This invitation link could not be opened.",
        );
      }

      renderResponse(payload);
    } catch (error) {
      showError(
        error instanceof Error
          ? error.message
          : "This invitation link could not be opened.",
      );
    }
  }

  void loadInvitation();
}

function initAdminSpeakerDinner() {
  const speakersRoot = document.querySelector<HTMLElement>(
    "[data-admin-dinner-speakers]",
  );

  if (!speakersRoot) return;

  const root = speakersRoot;
  const sharedResponsesRoot = document.querySelector<HTMLElement>(
    "[data-admin-dinner-shared-responses]",
  );
  const status = document.querySelector<HTMLElement>(
    "[data-admin-dinner-status]",
  );
  const refreshButton = document.querySelector<HTMLButtonElement>(
    "[data-admin-dinner-refresh]",
  );
  const purgeButton = document.querySelector<HTMLButtonElement>(
    "[data-admin-dinner-purge]",
  );
  const sharedInviteButton = document.querySelector<HTMLButtonElement>(
    "[data-admin-dinner-shared-invite]",
  );
  const sharedInviteStatus = document.querySelector<HTMLElement>(
    "[data-admin-dinner-shared-invite-status]",
  );
  const sharedLinkRoot = document.querySelector<HTMLElement>(
    "[data-admin-dinner-shared-link]",
  );

  function setStatus(message: string) {
    if (status) status.textContent = message;
  }

  function createElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    className?: string,
    textContent?: string,
  ) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (textContent !== undefined) element.textContent = textContent;
    return element;
  }

  function updateSummary(
    speakers: SpeakerDinnerAdminItem[],
    sharedResponses: SpeakerDinnerSharedAdminItem[],
  ) {
    const allResponses = [
      ...speakers.map((speaker) => speaker.response).filter(Boolean),
      ...sharedResponses.map((item) => item.response),
    ];
    const counts = {
      invited: speakers.filter((speaker) => speaker.invited).length,
      attending: allResponses.filter(
        (response) => response?.attendance === "attending",
      ).length,
      not_attending: allResponses.filter(
        (response) => response?.attendance === "not_attending",
      ).length,
      pending: speakers.filter((speaker) => !speaker.response).length,
      shared: sharedResponses.length,
    };

    for (const [name, count] of Object.entries(counts)) {
      const element = document.querySelector(
        `[data-admin-dinner-count="${name}"]`,
      );
      if (element) element.textContent = String(count);
    }
  }

  function addDinnerField(list: HTMLElement, label: string, value: string) {
    const group = createElement("div", "grid min-w-0 gap-1");
    group.appendChild(
      createElement(
        "dt",
        "text-xs font-bold uppercase tracking-wide text-muted",
        label,
      ),
    );
    group.appendChild(
      createElement(
        "dd",
        "whitespace-pre-wrap break-words leading-6",
        value || "-",
      ),
    );
    list.appendChild(group);
  }

  async function copyInviteLink(
    input: HTMLInputElement,
    button: HTMLButtonElement,
  ) {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = "Copied";
    } catch {
      input.select();
      document.execCommand("copy");
      button.textContent = "Copied";
    }
  }

  function renderCreatedLink(
    container: HTMLElement,
    inviteUrl: string,
    label: string,
  ) {
    container.replaceChildren();
    const linkGroup = createElement(
      "div",
      "grid gap-2 border border-paper/50 p-2 sm:grid-cols-[minmax(0,1fr)_auto]",
    );
    const linkInput = createElement(
      "input",
      "min-w-0 border border-paper bg-ink px-3 py-2 text-xs text-paper",
    );
    linkInput.readOnly = true;
    linkInput.value = inviteUrl;
    linkInput.setAttribute("aria-label", label);
    const copyButton = createElement(
      "button",
      "border border-paper px-3 py-2 text-xs font-bold uppercase",
      "Copy link",
    );
    copyButton.type = "button";
    copyButton.addEventListener("click", () => {
      void copyInviteLink(linkInput, copyButton);
    });
    linkGroup.appendChild(linkInput);
    linkGroup.appendChild(copyButton);
    container.appendChild(linkGroup);
  }

  function renderSharedResponses(items: SpeakerDinnerSharedAdminItem[]) {
    if (!sharedResponsesRoot) return;

    sharedResponsesRoot.replaceChildren();

    if (!items.length) {
      sharedResponsesRoot.appendChild(
        createElement(
          "p",
          "border border-ink p-5 text-muted",
          "No shared-link responses yet.",
        ),
      );
      return;
    }

    for (const item of items) {
      const article = createElement(
        "article",
        "grid border border-ink bg-paper lg:grid-cols-[minmax(16rem,0.6fr)_minmax(0,1fr)]",
      );
      const header = createElement(
        "header",
        "grid content-start gap-3 bg-ink p-5 text-paper",
      );
      header.appendChild(
        createElement(
          "p",
          "text-xs font-bold uppercase text-paper/60",
          item.response.attendance === "attending"
            ? "Shared link / attending"
            : "Shared link / not attending",
        ),
      );
      header.appendChild(
        createElement(
          "h4",
          "font-headline text-3xl font-black uppercase leading-none",
          item.name,
        ),
      );

      const details = createElement(
        "dl",
        "grid content-start gap-x-8 gap-y-5 p-5 text-sm sm:grid-cols-2",
      );
      addDinnerField(
        details,
        "Attendance",
        item.response.attendance.replace("_", " "),
      );
      addDinnerField(details, "Meal", item.response.meal_preference);
      addDinnerField(
        details,
        "Food requirements",
        item.response.food_requirements,
      );
      addDinnerField(
        details,
        "Cross-contamination",
        item.response.cross_contamination,
      );
      addDinnerField(details, "Responded", item.responded_at);
      addDinnerField(details, "Last updated", item.updated_at);

      article.appendChild(header);
      article.appendChild(details);
      sharedResponsesRoot.appendChild(article);
    }
  }

  function renderSpeakers(
    speakers: SpeakerDinnerAdminItem[],
    sharedResponses: SpeakerDinnerSharedAdminItem[],
  ) {
    root.replaceChildren();
    renderSharedResponses(sharedResponses);
    updateSummary(speakers, sharedResponses);

    for (const speaker of speakers) {
      const article = createElement(
        "article",
        "grid border border-ink bg-paper lg:grid-cols-[minmax(16rem,0.6fr)_minmax(0,1fr)]",
      );
      const header = createElement(
        "header",
        "grid content-between gap-5 bg-ink p-5 text-paper",
      );
      const titleGroup = createElement("div");
      const state = speaker.response
        ? speaker.response.attendance === "attending"
          ? "Attending"
          : "Not attending"
        : speaker.invited
          ? "Awaiting reply"
          : "No link created";
      titleGroup.appendChild(
        createElement("p", "text-xs font-bold uppercase text-paper/60", state),
      );
      titleGroup.appendChild(
        createElement(
          "h3",
          "mt-2 font-headline text-3xl font-black uppercase leading-none",
          speaker.name,
        ),
      );

      const inviteGroup = createElement("div", "grid gap-2");
      const inviteButton = createElement(
        "button",
        "border border-paper bg-paper px-4 py-3 text-sm font-bold uppercase text-ink transition hover:bg-ink hover:text-paper disabled:cursor-wait disabled:opacity-60",
        speaker.invited ? "Replace private link" : "Create private link",
      );
      inviteButton.type = "button";
      const inviteStatus = createElement(
        "p",
        "min-h-5 text-xs font-bold uppercase text-paper/70",
      );
      inviteStatus.setAttribute("aria-live", "polite");
      inviteGroup.appendChild(inviteButton);
      inviteGroup.appendChild(inviteStatus);

      inviteButton.addEventListener("click", async () => {
        inviteButton.disabled = true;
        inviteStatus.textContent = "Creating link...";

        try {
          const body = new FormData();
          body.append("speaker_id", speaker.speaker_id);
          const response = await fetch("/api/admin/speaker-dinner/invite", {
            method: "POST",
            headers: {
              accept: "application/json",
              "x-admin-action": "rotate-speaker-dinner-invite",
            },
            body,
          });
          const result = (await response.json()) as FormResponse & {
            invite_url?: string;
          };

          if (!response.ok || result.error || !result.invite_url) {
            throw new Error(
              result.error || "Could not create invitation link.",
            );
          }

          inviteGroup.querySelector("[data-dinner-created-link]")?.remove();
          const linkGroup = createElement(
            "div",
            "grid gap-2 border border-paper/50 p-2",
          );
          linkGroup.dataset.dinnerCreatedLink = "";
          const linkInput = createElement(
            "input",
            "min-w-0 border border-paper bg-ink px-3 py-2 text-xs text-paper",
          );
          linkInput.readOnly = true;
          linkInput.value = result.invite_url;
          linkInput.setAttribute(
            "aria-label",
            `Private link for ${speaker.name}`,
          );
          const copyButton = createElement(
            "button",
            "border border-paper px-3 py-2 text-xs font-bold uppercase",
            "Copy link",
          );
          copyButton.type = "button";
          copyButton.addEventListener("click", () => {
            void copyInviteLink(linkInput, copyButton);
          });
          linkGroup.appendChild(linkInput);
          linkGroup.appendChild(copyButton);
          inviteGroup.appendChild(linkGroup);
          speaker.invited = true;
          inviteButton.textContent = "Replace private link";
          inviteStatus.textContent =
            "New link ready. Earlier links no longer work.";
          updateSummary(speakers, sharedResponses);
          setStatus(
            result.message || `Invitation link created for ${speaker.name}.`,
          );
        } catch (error) {
          inviteStatus.textContent =
            error instanceof Error ? error.message : "Could not create link.";
        } finally {
          inviteButton.disabled = false;
        }
      });

      header.appendChild(titleGroup);
      header.appendChild(inviteGroup);

      const details = createElement(
        "dl",
        "grid content-start gap-x-8 gap-y-5 p-5 text-sm sm:grid-cols-2",
      );
      addDinnerField(
        details,
        "Attendance",
        speaker.response?.attendance.replace("_", " ") ?? "Pending",
      );
      addDinnerField(details, "Meal", speaker.response?.meal_preference ?? "");
      addDinnerField(
        details,
        "Food requirements",
        speaker.response?.food_requirements ?? "",
      );
      addDinnerField(
        details,
        "Cross-contamination",
        speaker.response?.cross_contamination ?? "",
      );
      addDinnerField(details, "Responded", speaker.responded_at ?? "");
      addDinnerField(details, "Invitation updated", speaker.updated_at ?? "");

      article.appendChild(header);
      article.appendChild(details);
      root.appendChild(article);
    }
  }

  async function loadSpeakers(successMessage?: string) {
    refreshButton?.setAttribute("disabled", "true");
    if (!successMessage) setStatus("Loading dinner responses...");

    try {
      const response = await fetch("/api/admin/speaker-dinner", {
        headers: { accept: "application/json" },
      });
      const payload = (await response.json()) as FormResponse & {
        shared_invite_active?: boolean;
        shared_responses?: SpeakerDinnerSharedAdminItem[];
        speakers?: SpeakerDinnerAdminItem[];
      };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Could not load dinner responses.");
      }

      const speakers = Array.isArray(payload.speakers) ? payload.speakers : [];
      const sharedResponses = Array.isArray(payload.shared_responses)
        ? payload.shared_responses
        : [];
      renderSpeakers(speakers, sharedResponses);
      if (sharedInviteButton) {
        sharedInviteButton.textContent = payload.shared_invite_active
          ? "Replace shared link"
          : "Create shared link";
      }
      setStatus(
        successMessage ||
          `${speakers.length} speakers / ${sharedResponses.length} shared replies`,
      );
    } catch (error) {
      root.replaceChildren(
        createElement(
          "p",
          "border border-ink p-5 text-muted",
          error instanceof Error ? error.message : "Could not load responses.",
        ),
      );
      setStatus("Failed to load");
    } finally {
      refreshButton?.removeAttribute("disabled");
    }
  }

  sharedInviteButton?.addEventListener("click", async () => {
    sharedInviteButton.disabled = true;
    if (sharedInviteStatus) {
      sharedInviteStatus.textContent = "Creating shared link...";
    }

    try {
      const response = await fetch("/api/admin/speaker-dinner/shared-invite", {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-admin-action": "rotate-speaker-dinner-shared-invite",
        },
      });
      const result = (await response.json()) as FormResponse & {
        invite_url?: string;
      };

      if (!response.ok || result.error || !result.invite_url) {
        throw new Error(result.error || "Could not create shared link.");
      }

      if (sharedLinkRoot) {
        renderCreatedLink(
          sharedLinkRoot,
          result.invite_url,
          "Shared dinner invitation link",
        );
      }
      sharedInviteButton.textContent = "Replace shared link";
      if (sharedInviteStatus) {
        sharedInviteStatus.textContent =
          "New link ready. Earlier shared links no longer work.";
      }
      setStatus(result.message || "Shared invitation link created.");
    } catch (error) {
      if (sharedInviteStatus) {
        sharedInviteStatus.textContent =
          error instanceof Error
            ? error.message
            : "Could not create shared link.";
      }
    } finally {
      sharedInviteButton.disabled = false;
    }
  });

  refreshButton?.addEventListener("click", () => void loadSpeakers());
  purgeButton?.addEventListener("click", async () => {
    const confirmation = window.prompt(
      "Type DELETE to remove every speaker dinner invitation and response.",
    );

    if (confirmation !== "DELETE") return;

    purgeButton.disabled = true;
    setStatus("Deleting dinner data...");

    try {
      const response = await fetch("/api/admin/speaker-dinner/purge", {
        method: "POST",
        headers: {
          accept: "application/json",
          "x-admin-action": "purge-speaker-dinner-data",
        },
        body: new URLSearchParams({ confirmation }),
      });
      const result = (await response.json()) as FormResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Could not delete dinner data.");
      }

      await loadSpeakers("Dinner invitations and responses deleted.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not delete dinner data.",
      );
    } finally {
      purgeButton.disabled = false;
    }
  });

  void loadSpeakers();
}

function initTitoWidget() {
  const widget = document.querySelector("[data-tito-ticket-widget]");

  if (!widget) return;

  let hasLoaded = false;

  function loadTitoScript() {
    if (hasLoaded) return;
    hasLoaded = true;

    const script = document.createElement("script");
    script.src = "https://js.tito.io/v2/with/inline,hits";
    script.async = true;
    document.body.appendChild(script);
  }

  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;

        observer.disconnect();
        loadTitoScript();
      },
      { rootMargin: "400px" },
    );

    observer.observe(widget);
  } else {
    window.addEventListener("load", loadTitoScript, { once: true });
  }

  window.addEventListener("pointerdown", loadTitoScript, { once: true });
  window.addEventListener("keydown", loadTitoScript, { once: true });
}

initExpiringElements();
initCountdown();
initThemeToggle();
initTurnstileWidgets();
initInterestForm();
initPosterForm();
initAdminInterests();
initAdminPosterProposals();
initSpeakerDinnerForm();
initAdminSpeakerDinner();
initTitoWidget();

export {};
