import "./index.ts";
import "./admin-navigation.ts";
import {
  feedbackQuestions,
  recommendationSummary,
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
      card.className =
        question.kind === "nps"
          ? "min-w-0 border border-ink p-5 md:col-span-2 xl:col-span-3"
          : "min-w-0 border border-ink p-5";
      append(
        card,
        textElement(
          "h2",
          question.kind === "nps" ? "Net Promoter Score (NPS)" : question.label,
          "font-bold leading-6",
        ),
      );
      const options =
        question.kind === "nps"
          ? Array.from({ length: 11 }, (_, index) => String(index))
          : question.kind === "rating"
            ? ["1", "2", "3", "4", "5"]
            : question.options;
      const answered =
        question.kind === "multiple"
          ? total
          : result.totals
              .filter(
                (t) =>
                  t.question === question.id &&
                  options.some((option) => option === t.answer),
              )
              .reduce((count, t) => count + t.count, 0);
      if (question.kind === "nps") {
        const nps = recommendationSummary(result.totals);
        append(
          card,
          textElement("p", question.label, "mt-2 text-muted leading-7"),
        );
        const headline = document.createElement("div");
        headline.className = "my-5 flex flex-wrap items-end gap-x-6 gap-y-2";
        const score = textElement(
          "p",
          nps.score === null ? "—" : `${nps.score > 0 ? "+" : ""}${nps.score}`,
          "font-headline text-7xl font-black leading-none",
        );
        score.dataset.feedbackNps = "";
        score.setAttribute(
          "aria-label",
          nps.score === null
            ? "No recommendation ratings yet"
            : `Net Promoter Score: ${nps.score}`,
        );
        const count = textElement(
          "p",
          `${nps.answered} recommendation ${nps.answered === 1 ? "rating" : "ratings"}`,
          "pb-1 text-sm font-bold",
        );
        count.dataset.feedbackNpsCount = "";
        append(headline, score, count);
        append(card, headline);
        const groups = document.createElement("dl");
        groups.className =
          "grid gap-4 border-y border-ink/30 py-4 sm:grid-cols-3";
        for (const [label, count] of [
          ["Promoters · 9–10", nps.promoters],
          ["Passives · 7–8", nps.passives],
          ["Detractors · 0–6", nps.detractors],
        ] as const) {
          const group = document.createElement("div");
          append(
            group,
            textElement("dt", label, "text-sm text-muted"),
            textElement(
              "dd",
              `${count} (${nps.answered ? Math.round((100 * count) / nps.answered) : 0}%)`,
              "mt-1 text-xl font-bold",
            ),
          );
          append(groups, group);
        }
        append(
          card,
          groups,
          textElement(
            "p",
            "NPS = % promoters − % detractors, on a scale from −100 to +100. Passives count in the denominator. The score is rounded to a whole number.",
            "mt-4 text-sm leading-6 text-muted",
          ),
        );
        if (total > nps.answered)
          append(
            card,
            textElement(
              "p",
              `${total - nps.answered} ${total - nps.answered === 1 ? "response has" : "responses have"} no recommendation rating and ${total - nps.answered === 1 ? "is" : "are"} excluded from NPS.`,
              "mt-2 text-sm leading-6 text-muted",
            ),
          );
        append(
          card,
          textElement(
            "p",
            "Treat this as directional feedback from respondents. A small or self-selected sample may not represent all attendees; compare events only with consistent wording, timing and invitation methods.",
            "mt-2 text-sm leading-6 text-muted",
          ),
        );
      }
      if (question.kind === "rating") {
        const sum = result.totals
          .filter((t) => t.question === question.id)
          .reduce((value, t) => value + Number(t.answer) * t.count, 0);
        append(
          card,
          textElement(
            "p",
            answered ? `${(sum / answered).toFixed(1)} / 5` : "No ratings yet",
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
            `${count} (${answered ? Math.round((count / answered) * 100) : 0}%)`,
            "text-sm font-bold leading-6",
          ),
        );
        const bar = document.createElement("div");
        bar.className = "col-span-2 h-1 bg-ink/10";
        const fill = document.createElement("div");
        fill.className = "h-1 bg-ink";
        fill.style.width = `${answered ? Math.min(100, (count / answered) * 100) : 0}%`;
        append(bar, fill);
        append(item, bar);
        append(list, item);
      }
      if (question.kind === "nps") {
        const distribution = document.createElement("details");
        distribution.className = "mt-5 border-t border-ink/30 pt-4";
        append(
          distribution,
          textElement(
            "summary",
            "Recommendation rating distribution · 0–10",
            "cursor-pointer font-bold leading-6",
          ),
          list,
        );
        append(card, distribution);
      } else append(card, list);
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
      const comments = ["recommendReason", "best", "improve", "future"].filter(
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
