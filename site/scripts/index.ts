declare global {
  interface Window {
    onInterestTurnstileExpired?: () => void;
    onInterestTurnstileSuccess?: () => void;
    turnstile?: {
      reset: () => void;
    };
  }
}

type InterestResponse = {
  detail?: string;
  error?: string;
  message?: string;
};

type InterestContact = {
  created_at: string;
  email: string;
  name: string;
  organization: string;
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

function initTurnstileWidget() {
  const turnstileWidget = document.querySelector<HTMLElement>(
    "[data-turnstile-widget]",
  );

  if (
    turnstileWidget &&
    (!turnstileWidget.dataset.sitekey ||
      turnstileWidget.dataset.sitekey === "__TURNSTILE_SITE_KEY__")
  ) {
    turnstileWidget.hidden = true;
  }

  return turnstileWidget;
}

function initInterestForm() {
  const turnstileWidget = initTurnstileWidget();
  const foundInterestForm = document.querySelector<HTMLFormElement>(
    "[data-interest-form]",
  );
  const interestStatus = document.querySelector("[data-interest-status]");
  const submitButton = document.querySelector<HTMLButtonElement>(
    "[data-interest-submit]",
  );

  if (!foundInterestForm) return;

  const interestForm = foundInterestForm;
  let isSubmitting = false;

  function setInterestStatus(message: string) {
    if (interestStatus) {
      interestStatus.textContent = message;
    }
  }

  function resetTurnstile() {
    if (window.turnstile && turnstileWidget?.dataset.sitekey) {
      window.turnstile.reset();
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
      const result: InterestResponse = contentType.includes("application/json")
        ? ((await response.json()) as InterestResponse)
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

renderCountdown();
setInterval(renderCountdown, 1000);
initThemeToggle();
initInterestForm();
initAdminInterests();

export {};
