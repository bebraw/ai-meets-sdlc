import "./index.ts";
import "./admin-navigation.ts";
import {
  feedbackQuestions,
  type FeedbackDashboard,
} from "../../shared/feedback.ts";
import {
  append,
  feedbackError,
  feedbackFetch,
  renderFeedbackAnswers,
  textElement,
} from "./feedback-ui.ts";

const root = document.querySelector<HTMLElement>("[data-admin-feedback]")!;
const status = root.querySelector<HTMLElement>("[data-admin-feedback-status]")!;
const totalsRoot = root.querySelector<HTMLElement>("[data-feedback-totals]")!;
const itemsRoot = root.querySelector<HTMLElement>("[data-feedback-items]")!;
const next = root.querySelector<HTMLButtonElement>("[data-feedback-next]")!;
const previous = root.querySelector<HTMLButtonElement>(
  "[data-feedback-previous]",
)!;
const refresh = root.querySelector<HTMLButtonElement>(
  "[data-feedback-refresh]",
)!;
let offset = 0,
  nextOffset: number | null = null,
  busy = false;
async function load() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  next.disabled = true;
  previous.disabled = true;
  status.textContent = "Loading feedback…";
  try {
    const result = await feedbackFetch<FeedbackDashboard>(
      `/api/admin/feedback?offset=${offset}`,
    );
    const total =
      result.totals.find(
        (t) => t.question === "responses" && t.answer === "all",
      )?.count ?? 0;
    status.textContent = `${total} ${total === 1 ? "response" : "responses"} in the totals. ${result.activeCount} individual ${result.activeCount === 1 ? "response" : "responses"} within retention.`;
    totalsRoot.replaceChildren();
    itemsRoot.replaceChildren();
    for (const question of feedbackQuestions) {
      if (question.kind === "text") continue;
      const card = document.createElement("section");
      card.className = "min-w-0 border border-ink p-5";
      append(card, textElement("h2", question.label, "font-bold leading-6"));
      const options =
        question.kind === "rating"
          ? ["1", "2", "3", "4", "5"]
          : question.options;
      if (question.kind === "rating") {
        const sum = result.totals
          .filter((t) => t.question === question.id)
          .reduce((value, t) => value + Number(t.answer) * t.count, 0);
        append(
          card,
          textElement(
            "p",
            total ? `${(sum / total).toFixed(1)} / 5` : "No ratings yet",
            "my-4 font-headline text-4xl font-black",
          ),
        );
      }
      const list = document.createElement("ul");
      list.className = "mt-4 grid gap-3";
      for (const option of options) {
        const count =
          result.totals.find(
            (t) => t.question === question.id && t.answer === option,
          )?.count ?? 0;
        const item = document.createElement("li");
        item.className = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1";
        append(
          item,
          textElement(
            "span",
            question.kind === "rating" ? `${option} / 5` : option,
            "text-sm leading-6",
          ),
          textElement(
            "span",
            `${count} (${total ? Math.round((count / total) * 100) : 0}%)`,
            "text-sm font-bold leading-6",
          ),
        );
        const bar = document.createElement("div");
        bar.className = "col-span-2 h-1 bg-ink/10";
        const fill = document.createElement("div");
        fill.className = "h-1 bg-ink";
        fill.style.width = `${total ? Math.min(100, (count / total) * 100) : 0}%`;
        append(bar, fill);
        append(item, bar);
        append(list, item);
      }
      append(card, list);
      append(totalsRoot, card);
    }
    if (!result.responses.length)
      append(
        itemsRoot,
        textElement("p", "No individual responses available.", "text-muted"),
      );
    for (const item of result.responses) {
      const details = document.createElement("details");
      details.className = "min-w-0 border border-ink p-5";
      const comments = ["best", "improve", "future"].filter(
        (id) => item.answers[id],
      ).length;
      append(
        details,
        textElement(
          "summary",
          `Response · expires ${new Date(item.expiresAt).toLocaleDateString("en-GB")} · ${comments} optional ${comments === 1 ? "comment" : "comments"}`,
          "cursor-pointer font-bold leading-7",
        ),
      );
      const answers = document.createElement("div");
      answers.className = "mt-6 grid gap-5";
      renderFeedbackAnswers(answers, item.answers);
      append(details, answers);
      append(
        details,
        textElement(
          "p",
          `Consent recorded · notice ${item.noticeVersion}`,
          "mt-5 text-sm text-muted",
        ),
      );
      const deleteForm = document.createElement("form");
      deleteForm.className = "mt-5 grid gap-3 border-t border-ink/30 pt-5";
      const label = document.createElement("label");
      label.className = "flex items-start gap-3 leading-6";
      const confirm = document.createElement("input");
      confirm.type = "checkbox";
      confirm.required = true;
      confirm.className = "mt-1 h-5 w-5 shrink-0";
      append(
        label,
        confirm,
        textElement(
          "span",
          "Delete this response, including its contribution to the totals.",
        ),
      );
      const button = textElement(
        "button",
        "Delete response",
        "justify-self-start border border-ink px-4 py-3 font-bold",
      );
      button.type = "submit";
      const message = textElement("p", "");
      message.setAttribute("role", "status");
      append(deleteForm, label, button, message);
      append(details, deleteForm);
      deleteForm.addEventListener("submit", (event) => {
        event.preventDefault();
        button.disabled = true;
        const body = new FormData();
        body.set("id", item.id);
        void feedbackFetch("/api/admin/feedback", {
          method: "DELETE",
          headers: { "x-admin-action": "delete-feedback" },
          body,
        })
          .then(() => {
            offset = 0;
            return load();
          })
          .catch((error: unknown) => {
            message.textContent = feedbackError(error);
            button.disabled = false;
          });
      });
      append(itemsRoot, details);
    }
    nextOffset = result.nextOffset;
    next.hidden = nextOffset === null;
    previous.hidden = offset === 0;
  } catch (error) {
    status.textContent = feedbackError(error);
  } finally {
    busy = false;
    refresh.disabled = false;
    next.disabled = false;
    previous.disabled = false;
  }
}
refresh.addEventListener("click", () => {
  offset = 0;
  void load();
});
next.addEventListener("click", () => {
  if (nextOffset !== null && !busy) {
    offset = nextOffset;
    void load();
  }
});
previous.addEventListener("click", () => {
  if (!busy) {
    offset = Math.max(0, offset - 20);
    void load();
  }
});
root
  .querySelector("[data-feedback-public-copy]")!
  .addEventListener("click", () => {
    void navigator.clipboard
      .writeText("https://sdlcai.org/feedback/")
      .then(() => {
        status.textContent =
          "Public form link copied: https://sdlcai.org/feedback/";
      })
      .catch(() => {
        status.textContent = "Public form link: https://sdlcai.org/feedback/";
      });
  });
void load();
