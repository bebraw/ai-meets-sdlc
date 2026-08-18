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

const target = new Date("2026-10-13T09:00:00+03:00");
const units: [string, number][] = [
  ["days", 24 * 60 * 60 * 1000],
  ["hours", 60 * 60 * 1000],
  ["minutes", 60 * 1000],
  ["seconds", 1000],
];

function renderCountdown() {
  const root = document.querySelector("[data-countdown]");

  if (!root) return;

  let remaining = Math.max(0, target.getTime() - Date.now());

  for (const [name, size] of units) {
    const value = Math.floor(remaining / size);
    remaining -= value * size;

    const node = root.querySelector(`[data-countdown-unit="${name}"]`);

    if (node) {
      node.textContent = String(value).padStart(name === "days" ? 3 : 2, "0");
    }
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

  function posterSizeLabel(size: PosterProposal["poster_size"]) {
    if (size === "a0") return "A0 portrait";
    if (size === "a1") return "A1 portrait";

    return "A0 or A1 portrait";
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
      addProposalField(
        details,
        "Poster size",
        posterSizeLabel(proposal.poster_size),
      );
      addProposalField(details, "Authors / presenters", proposal.authors, true);
      addProposalField(details, "Abstract", proposal.abstract, true);
      addSupportingUrl(details, proposal.supporting_url);
      addProposalField(details, "Setup notes", proposal.setup_notes, true);
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

renderCountdown();
setInterval(renderCountdown, 1000);
initThemeToggle();
initTurnstileWidgets();
initInterestForm();
initPosterForm();
initAdminInterests();
initAdminPosterProposals();
initTitoWidget();

export {};
