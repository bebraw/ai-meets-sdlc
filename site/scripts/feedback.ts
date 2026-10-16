import "./index.ts";
import {
  feedbackConsentText,
  feedbackFormVersion,
  feedbackSections,
} from "../../shared/feedback.ts";
import {
  append,
  downloadFeedbackFile,
  feedbackError,
  feedbackFetch,
  textElement,
} from "./feedback-ui.ts";

declare global {
  interface Window {
    onFeedbackTurnstileSuccess?: () => void;
    onFeedbackTurnstileExpired?: () => void;
    onFeedbackTurnstileError?: () => boolean;
  }
}

const form = document.querySelector<HTMLFormElement>("[data-feedback-form]")!;
const root = form.querySelector<HTMLElement>("[data-feedback-questions]")!;
form.querySelector<HTMLElement>("[data-feedback-consent]")!.textContent =
  feedbackConsentText;
form.querySelector<HTMLInputElement>('[name="formVersion"]')!.value =
  feedbackFormVersion;
for (const [sectionIndex, section] of feedbackSections.entries()) {
  const group = document.createElement("section");
  group.className = "grid gap-7";
  append(
    group,
    textElement(
      "h2",
      `${String(sectionIndex + 1).padStart(2, "0")} / ${section.title}`,
      "font-headline text-3xl font-black uppercase",
    ),
  );
  append(
    group,
    textElement("p", section.description, "-mt-3 leading-7 text-muted"),
  );
  for (const question of section.questions) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "min-w-0 border-t border-ink/30 pt-5";
    append(
      fieldset,
      textElement(
        "legend",
        `${question.label}${question.kind === "text" ? " (optional)" : " *"}`,
        "mb-3 max-w-full text-lg font-bold leading-7",
      ),
    );
    if (question.kind === "text") {
      const input = document.createElement("textarea");
      input.name = question.id;
      input.id = `feedback-${question.id}`;
      input.setAttribute("aria-label", question.label);
      input.className = "w-full border border-ink bg-paper px-4 py-3";
      input.rows = 3;
      input.maxLength = 2000;
      input.setAttribute("aria-describedby", `feedback-${question.id}-limit`);
      append(
        fieldset,
        input,
        textElement("p", "Up to 2,000 characters.", "mt-2 text-sm text-muted"),
      );
      fieldset.lastElementChild!.id = `feedback-${question.id}-limit`;
    } else {
      const numeric = question.kind === "rating" || question.kind === "nps";
      const options =
        question.kind === "nps"
          ? Array.from({ length: 11 }, (_, index) => String(index))
          : question.kind === "rating"
            ? ["1", "2", "3", "4", "5"]
            : question.options;
      const choices = document.createElement("div");
      choices.className =
        question.kind === "nps"
          ? "grid grid-cols-6 gap-2 sm:grid-cols-[repeat(11,minmax(0,1fr))]"
          : question.kind === "rating"
            ? "grid grid-cols-5 gap-2"
            : "grid gap-3";
      for (const option of options) {
        const label = document.createElement("label");
        label.className = numeric
          ? "flex min-h-14 cursor-pointer items-center justify-center gap-2 border border-ink p-2 font-bold has-[:checked]:bg-ink has-[:checked]:text-paper"
          : "flex cursor-pointer items-start gap-3 border border-ink/30 px-4 py-3 leading-6 has-[:checked]:border-ink";
        const input = document.createElement("input");
        input.type = question.kind === "multiple" ? "checkbox" : "radio";
        input.name = question.id;
        input.value = option;
        input.required = question.kind !== "multiple";
        input.className =
          question.kind === "nps" ? "sr-only" : "h-4 w-4 shrink-0 accent-ink";
        if (question.kind === "nps")
          label.classList.add(
            "focus-within:outline",
            "focus-within:outline-2",
            "focus-within:outline-offset-2",
            "focus-within:outline-ink",
          );
        if (!numeric) input.classList.add("mt-1");
        append(label, input, textElement("span", option));
        append(choices, label);
      }
      append(fieldset, choices);
      if (numeric) {
        const anchors = textElement(
          "p",
          "",
          "mt-2 flex justify-between text-sm text-muted",
        );
        append(
          anchors,
          textElement(
            "span",
            question.kind === "nps" ? "0 — Not at all likely" : "1 — Very poor",
          ),
          textElement(
            "span",
            question.kind === "nps" ? "10 — Extremely likely" : "5 — Excellent",
          ),
        );
        if (question.kind === "nps") {
          anchors.id = "recommend-scale";
          fieldset.setAttribute("aria-describedby", anchors.id);
        }
        append(fieldset, anchors);
      }
      if (question.kind === "multiple")
        append(
          fieldset,
          textElement(
            "p",
            "Choose at least one. You can select several.",
            "mt-2 text-sm text-muted",
          ),
        );
    }
    append(group, fieldset);
  }
  append(root, group);
}

const status = form.querySelector<HTMLElement>("[data-feedback-status]")!;
const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
let verified = false,
  busy = false;
// Generated locally, never tied to a person. Reusing this code on network retry
// prevents duplicate counts, even if the first response was lost in transit.
const receipt = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
  v.toString(16).padStart(2, "0"),
).join("");
window.onFeedbackTurnstileSuccess = () => {
  verified = true;
  submit.disabled = busy;
  status.textContent = "";
};
window.onFeedbackTurnstileExpired = () => {
  verified = false;
  submit.disabled = true;
  status.textContent = "The security check expired. Please complete it again.";
};
window.onFeedbackTurnstileError = () => {
  verified = false;
  submit.disabled = true;
  status.textContent =
    "The security check could not load. Reload the page to try again.";
  return true;
};
const sitekey = form.querySelector<HTMLElement>("[data-feedback-turnstile]")
  ?.dataset.sitekey;
if (sitekey && sitekey !== "__TURNSTILE_SITE_KEY__") {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  script.addEventListener("error", () => window.onFeedbackTurnstileError?.());
  append(document.head, script);
} else
  status.textContent =
    "Feedback is temporarily unavailable. Please try again later.";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!verified || busy || !form.reportValidity()) return;
  const data = new FormData(form);
  if (!data.getAll("valuable").length) {
    status.textContent = "Choose at least one valuable part of the programme.";
    form.querySelector<HTMLInputElement>('[name="valuable"]')!.focus();
    return;
  }
  data.set("receipt", receipt);
  busy = true;
  submit.disabled = true;
  status.textContent = "Sending your feedback…";
  void feedbackFetch<{ saved: boolean; expiresAt: number }>("/api/feedback", {
    method: "POST",
    body: data,
  })
    .then((result) => {
      const thanks = document.querySelector<HTMLElement>(
        "[data-feedback-thanks]",
      )!;
      const link = new URL("/feedback/response/", location.origin);
      link.hash = `code=${receipt}`;
      const input = thanks.querySelector<HTMLInputElement>(
        "[data-feedback-link]",
      )!;
      const savedStatus = thanks.querySelector<HTMLElement>(
        "[data-feedback-saved-status]",
      )!;
      input.value = link.href;
      thanks.querySelector<HTMLAnchorElement>("[data-feedback-view]")!.href =
        link.href;
      thanks
        .querySelector("[data-feedback-copy]")!
        .addEventListener("click", () => {
          void navigator.clipboard
            .writeText(link.href)
            .then(() => {
              savedStatus.textContent =
                "Private link copied. Keep it somewhere safe.";
            })
            .catch(() => {
              input.select();
              savedStatus.textContent =
                "Copy the selected private link and keep it somewhere safe.";
            });
        });
      thanks
        .querySelector("[data-feedback-save]")!
        .addEventListener("click", () =>
          downloadFeedbackFile(
            "sdlcai-feedback-private-link.txt",
            `SDLCAI 2026 — private feedback link\n\n${link.href}\n\nAnyone with this link can view or delete your response. Raw answers expire on ${new Date(result.expiresAt).toISOString().slice(0, 10)}.\n`,
          ),
        );
      form.reset();
      form.hidden = true;
      thanks.hidden = false;
      thanks.focus();
    })
    .catch((error: unknown) => {
      status.textContent = feedbackError(error);
    })
    .finally(() => {
      busy = false;
      verified = false;
      submit.disabled = true;
      window.turnstile?.reset();
    });
});
