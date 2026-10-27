import { eventFetch as fetch } from "./event-context.ts";
import "./index.ts";
declare global {
  interface Window {
    onNewsletterTurnstileSuccess?: () => void;
    onNewsletterTurnstileExpired?: () => void;
    onNewsletterTurnstileError?: () => boolean;
  }
}
const form = document.querySelector<HTMLFormElement>(
  "[data-newsletter-form]:not([hidden])",
);
if (form) {
  const status = form.querySelector<HTMLElement>("[data-newsletter-status]")!;
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  let verified = false,
    busy = false;
  window.onNewsletterTurnstileSuccess = () => {
    verified = true;
    submit.disabled = busy;
    status.textContent = "";
  };
  window.onNewsletterTurnstileExpired = () => {
    verified = false;
    submit.disabled = true;
    status.textContent =
      "The security check expired. Please complete it again.";
  };
  window.onNewsletterTurnstileError = () => {
    verified = false;
    submit.disabled = true;
    status.textContent =
      "The security check could not load. Reload the page to try again.";
    return true;
  };
  const sitekey = form.querySelector<HTMLElement>("[data-newsletter-turnstile]")
    ?.dataset.sitekey;
  if (sitekey && sitekey !== "__TURNSTILE_SITE_KEY__") {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.addEventListener("error", () =>
      window.onNewsletterTurnstileError?.(),
    );
    document.head.appendChild(script);
  } else
    status.textContent =
      "Email subscriptions are temporarily unavailable. Please try again later.";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!verified || busy || !form.reportValidity()) return;
    const data = new FormData(form);
    busy = true;
    submit.disabled = true;
    status.textContent = "Requesting your confirmation email…";
    void fetch("/api/newsletter/subscribe", {
      method: "POST",
      body: data,
      credentials: "same-origin",
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          message?: string;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error ?? "Please try again later.");
        status.textContent =
          result.message ?? "Check your inbox to confirm your subscription.";
        form.reset();
      })
      .catch((error: unknown) => {
        status.textContent =
          error instanceof Error
            ? error.message
            : "Unable to reach the server. Please try again.";
      })
      .finally(() => {
        busy = false;
        verified = false;
        submit.disabled = true;
        window.turnstile?.reset();
      });
  });
}
