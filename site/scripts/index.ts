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
        .querySelector<HTMLInputElement>(
          'input[name="cf-turnstile-response"]',
        )
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

renderCountdown();
setInterval(renderCountdown, 1000);
initThemeToggle();
initInterestForm();

export {};
