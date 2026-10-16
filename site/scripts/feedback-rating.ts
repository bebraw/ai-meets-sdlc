import { type FeedbackQuestion } from "../../shared/feedback.ts";
import { append, textElement } from "./feedback-ui.ts";

export function renderFeedbackRating(
  question: Extract<FeedbackQuestion, { kind: "rating" }>,
  fieldset: HTMLFieldSetElement,
  form: HTMLFormElement,
) {
  const prefix = `feedback-${question.id}`;
  fieldset.querySelector("legend")!.id = `${prefix}-legend`;
  const panel = document.createElement("div");
  panel.className = "feedback-rating";
  const heading = document.createElement("div");
  heading.className =
    "mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-ink/30 pt-4";
  const selected = textElement("p", "", "min-w-0 text-lg font-bold leading-7");
  selected.dataset.ratingLabel = question.id;
  const clear = textElement(
    "button",
    "Clear answer",
    "min-h-11 text-sm underline underline-offset-4",
  );
  clear.type = "button";
  clear.setAttribute("aria-label", `Clear answer: ${question.label}`);
  append(heading, selected, clear);
  const hint = textElement(
    "p",
    "Move the slider or choose a number. No rating is selected automatically.",
    "text-sm leading-6 text-muted",
  );
  hint.id = `${prefix}-hint`;
  const track = document.createElement("div");
  track.className = "feedback-rating-track";
  const range = document.createElement("input");
  range.type = "range";
  range.min = "1";
  range.max = "5";
  range.step = "1";
  range.value = "3";
  range.id = `${prefix}-rating`;
  range.className = "feedback-rating-range";
  range.setAttribute("aria-labelledby", `${prefix}-legend`);
  range.setAttribute("aria-describedby", hint.id);
  // Native ranges always have a value. Only the explicit answer is submitted;
  // focusing the slider must not turn its initial midpoint into a response.
  const answer = document.createElement("input");
  answer.type = "hidden";
  answer.name = question.id;
  answer.disabled = true;
  const numbers = document.createElement("div");
  numbers.className = "feedback-rating-numbers";
  numbers.setAttribute("role", "group");
  numbers.setAttribute("aria-label", `Choose a rating: ${question.label}`);
  const buttons = question.scale.map((label, index) => {
    const value = String(index + 1);
    const button = textElement("button", value, "feedback-rating-number");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", `Choose ${value} — ${label}`);
    button.addEventListener("click", () => chooseRating(value));
    append(numbers, button);
    return button;
  });
  const endpoints = document.createElement("div");
  endpoints.className =
    "mt-2 flex justify-between gap-5 text-sm leading-6 text-muted";
  append(
    endpoints,
    textElement("p", `1 — ${question.scale[0]}`, "max-w-[45%]"),
    textElement("p", `5 — ${question.scale[4]}`, "max-w-[45%] text-right"),
  );
  append(track, range);
  append(panel, hint, track, numbers, endpoints, heading, answer);
  append(fieldset, panel);

  const unscored: HTMLInputElement[] = [];
  if (question.unscoredOptions?.length) {
    const choices = document.createElement("div");
    choices.className =
      question.unscoredOptions.length > 1
        ? "mt-2 grid gap-2 sm:grid-cols-2"
        : "mt-2 grid gap-2";
    for (const option of question.unscoredOptions) {
      const label = document.createElement("label");
      label.className =
        "flex cursor-pointer items-start gap-3 border border-ink/30 px-4 py-3 leading-6 has-[:checked]:border-ink";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = question.id;
      input.value = option;
      input.className = "mt-1 h-4 w-4 shrink-0 accent-ink";
      input.addEventListener("change", () => {
        if (input.checked) update(option);
      });
      unscored.push(input);
      append(label, input, textElement("span", option));
      append(choices, label);
    }
    append(
      fieldset,
      textElement(
        "p",
        "Or, if you cannot give a rating:",
        "mt-4 text-sm text-muted",
      ),
      choices,
    );
  }

  function update(value = "") {
    const numeric = /^[1-5]$/u.test(value);
    answer.disabled = !numeric;
    answer.value = numeric ? value : "";
    range.dataset.answered = String(numeric);
    range.value = numeric ? value : "3";
    range.style.setProperty(
      "--rating-progress",
      numeric ? `${(Number(value) - 1) * 25}%` : "0%",
    );
    selected.textContent = numeric
      ? `${value} / 5 — ${question.scale[Number(value) - 1]}`
      : value || "Choose a rating";
    selected.classList.toggle("text-muted", !value);
    range.setAttribute(
      "aria-valuetext",
      numeric
        ? selected.textContent
        : value
          ? `No numeric rating: ${value}. Move the slider to choose a rating.`
          : "No rating selected. Move the slider or choose a number.",
    );
    range.setCustomValidity(
      value ? "" : "Choose a rating or an applicable unscored option.",
    );
    clear.hidden = !value;
    for (const [index, button] of buttons.entries())
      button.setAttribute(
        "aria-pressed",
        String(numeric && Number(value) === index + 1),
      );
  }
  function chooseRating(value: string) {
    for (const input of unscored) input.checked = false;
    update(value);
  }
  range.addEventListener("input", () => chooseRating(range.value));
  range.addEventListener("change", () => chooseRating(range.value));
  // Selecting the initial middle value or an already-reached endpoint does
  // not always fire input/change. An explicit pointer or key action still counts.
  range.addEventListener("pointerup", () => chooseRating(range.value));
  range.addEventListener("keyup", (event) => {
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ].includes(event.key)
    )
      chooseRating(range.value);
  });
  clear.addEventListener("click", () => {
    for (const input of unscored) input.checked = false;
    update();
    range.focus();
  });
  form.addEventListener("reset", () => update());
  update();
}
