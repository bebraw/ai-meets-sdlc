import "./index.ts";
import type { FeedbackSubmission } from "../../shared/feedback.ts";
import {
  downloadFeedbackFile,
  feedbackError,
  feedbackFetch,
  renderFeedbackAnswers,
} from "./feedback-ui.ts";

const root = document.querySelector<HTMLElement>("[data-feedback-response]")!;
const status = root.querySelector<HTMLElement>(
  "[data-feedback-response-status]",
)!;
const body = root.querySelector<HTMLElement>("[data-feedback-response-body]")!;
const code = new URLSearchParams(location.hash.slice(1)).get("code") ?? "";
const form = new FormData();
form.set("receipt", code);
if (!/^[a-f0-9]{64}$/u.test(code))
  status.textContent =
    "Open the complete private link you saved after submitting. We cannot look up a response by name or email.";
else
  void feedbackFetch<FeedbackSubmission & { expiresAt: number }>(
    "/api/feedback/response",
    { method: "POST", body: form },
  )
    .then((result) => {
      status.textContent = `Your raw answers expire on ${new Date(result.expiresAt).toLocaleDateString("en-GB")}.`;
      renderFeedbackAnswers(
        root.querySelector<HTMLElement>("[data-feedback-response-answers]")!,
        result.answers,
      );
      body.hidden = false;
      root
        .querySelector("[data-feedback-download]")!
        .addEventListener("click", () =>
          downloadFeedbackFile(
            "sdlcai-feedback.json",
            JSON.stringify(result, null, 2),
            "application/json",
          ),
        );
      root
        .querySelector<HTMLFormElement>("[data-feedback-delete]")!
        .addEventListener("submit", (event) => {
          event.preventDefault();
          const button = root.querySelector<HTMLButtonElement>(
            "button[type=submit]",
          )!;
          button.disabled = true;
          void feedbackFetch("/api/feedback/response", {
            method: "DELETE",
            body: form,
          })
            .then(() => {
              body.hidden = true;
              root
                .querySelector<HTMLElement>("[data-feedback-response-answers]")!
                .replaceChildren();
              status.textContent =
                "Your response has been deleted and removed from the totals. Thank you for taking part.";
              history.replaceState(null, "", location.pathname);
            })
            .catch((error: unknown) => {
              status.textContent = feedbackError(error);
              button.disabled = false;
            });
        });
    })
    .catch((error: unknown) => {
      status.textContent = feedbackError(error);
    });
