import { append, button, el } from "./admin-toolkit.ts";
import { appendDietDetails } from "./catering-summary.ts";
import { createDietReviewPanel } from "./attendee-diet-review-panel.ts";
import type { DietReview } from "./attendee-diet-reviews.ts";
import {
  buildDinnerCateringRoster,
  dinnerCateringSummaryText,
  summarizeDinnerDiets,
  type DinnerCateringResponse,
  type DinnerCateringData,
} from "./dinner-diets.ts";

export function createDinnerCateringPanel(
  saveReview: (
    review: DietReview,
    snapshot: { revision: number; version: string },
  ) => Promise<DinnerCateringData>,
  exportAvailabilityChanged: (disabled: boolean) => void,
) {
  const panel = el("section", "", "border border-ink p-5 md:p-7");
  panel.dataset.dinnerCatering = "";
  append(
    panel,
    el(
      "h3",
      "Dinner catering summary",
      "font-headline text-3xl font-black uppercase",
    ),
    el(
      "p",
      "All attending speakers and guests, including attendance recorded by organizers. Totals match the Caterer CSV and use the full dinner list regardless of the filters below.",
      "mt-3 max-w-3xl leading-7 text-muted",
    ),
  );
  const content = el("div", "Loading dietary responses…", "mt-6");
  const status = el("p", "", "mt-3 text-sm leading-6");
  status.setAttribute("role", "status");
  const fallback = el("label", "", "mt-4 grid gap-2 text-sm font-bold");
  fallback.hidden = true;
  const text = el(
    "textarea",
    "",
    "min-h-64 w-full border border-ink bg-paper p-3 font-normal leading-6",
  );
  text.readOnly = true;
  append(
    fallback,
    el("span", "Dinner catering summary (select and copy)"),
    text,
  );
  let guests: readonly DinnerCateringResponse[] = [];
  let loaded = false;
  let busy = false;
  let cateringData: DinnerCateringData | undefined;
  const dietReview = createDietReviewPanel(
    async (review, snapshot) => {
      if (!loaded || busy || !cateringData)
        throw new Error("Refresh dinner responses before reviewing diets.");
      const saved = await saveReview(review, snapshot);
      render(guests, saved);
    },
    () => updateControls(),
    5,
  );
  const report = () =>
    dinnerCateringSummaryText(
      summarizeDinnerDiets(guests, cateringData?.reviews),
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()) + " (Helsinki time)",
    );
  const copy = button("Copy dinner summary", () => {
    const value = report();
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(() => {
        fallback.hidden = true;
        status.textContent = "Dinner summary copied.";
      })
      .catch(() => {
        text.value = value;
        fallback.hidden = false;
        text.focus();
        text.select();
        status.textContent =
          "Copy the selected text below, or download the summary.";
      });
  });
  const download = button("Download dinner summary", () => {
    const url = URL.createObjectURL(
      new Blob([report()], { type: "text/plain;charset=utf-8" }),
    );
    const link = el("a");
    link.href = url;
    link.download = "sdlcai-2026-dinner-catering-summary.txt";
    append(document.body, link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Dinner summary downloaded.";
  });
  const actions = el("div", "", "mt-6 flex flex-wrap gap-3");
  append(actions, copy, download);
  append(panel, content, actions, status, fallback);
  const updateControls = () => {
    dietReview.setBusy(busy || !loaded || !cateringData);
    copy.disabled = download.disabled =
      busy || !loaded || !cateringData || dietReview.hasDrafts();
    exportAvailabilityChanged(copy.disabled);
  };
  updateControls();

  function render(
    responses: readonly DinnerCateringResponse[],
    data: DinnerCateringData,
  ) {
    guests = responses;
    cateringData = data;
    loaded = true;
    dietReview.render(
      buildDinnerCateringRoster(guests, data.reviews),
      data,
      busy,
    );
    const summary = summarizeDinnerDiets(guests, data.reviews);
    content.replaceChildren();
    const counts = el(
      "dl",
      "",
      "grid gap-5 border-y border-ink/20 py-5 sm:grid-cols-2 lg:grid-cols-4",
    );
    for (const [label, count] of [
      ["Dinner headcount", summary.active],
      ["Requirements reported", summary.requirements],
      ["Explicitly no restrictions", summary.noRestrictions],
      ["No answer / placeholder", summary.missing],
    ] as const) {
      const item = el("div");
      append(
        item,
        el("dt", label, "text-sm font-bold uppercase text-muted"),
        el("dd", String(count), "mt-2 font-headline text-4xl font-black"),
      );
      append(counts, item);
    }
    append(
      content,
      counts,
      el(
        "p",
        `${summary.notAttending} not attending and ${summary.pending} awaiting an attendance reply are excluded.`,
        "mt-4 text-sm leading-6",
      ),
    );
    if (summary.active) {
      append(
        content,
        el(
          "h4",
          "Meal preferences",
          "mt-6 font-headline text-2xl font-black uppercase",
        ),
      );
      const meals = el(
        "dl",
        "",
        "mt-3 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3",
      );
      for (const meal of summary.meals) {
        const row = el(
          "div",
          "",
          "flex items-baseline justify-between gap-4 border-b border-ink/20 py-3",
        );
        row.dataset.dinnerMeal = meal.id || "missing";
        append(
          row,
          el("dt", meal.label),
          el("dd", String(meal.count), "font-bold"),
        );
        append(meals, row);
      }
      append(
        content,
        meals,
        el(
          "p",
          `Cross-contamination concern: ${summary.crossContaminationConcern}. Unsure: ${summary.crossContaminationUnsure}. Keep these notes with the original requirements when preparing meals.`,
          "mt-4 text-sm leading-6",
        ),
      );
    }
    appendDietDetails(
      content,
      summary,
      "No guests are currently attending dinner.",
      4,
      dietReview,
    );
    if (!fallback.hidden) text.value = report();
    updateControls();
  }
  return {
    panel,
    render,
    setBusy(value: boolean) {
      busy = value;
      updateControls();
    },
    unavailable(message: string) {
      loaded = false;
      guests = [];
      cateringData = undefined;
      content.replaceChildren(
        el(
          "p",
          `${message} Refresh before exporting the dinner summary.`,
          "font-bold leading-7",
        ),
      );
      fallback.hidden = true;
      updateControls();
    },
  };
}
