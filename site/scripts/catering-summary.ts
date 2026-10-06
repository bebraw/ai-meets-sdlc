import { append, button, el } from "./admin-toolkit.ts";
import type { CateringSummary } from "./attendee-diets.ts";

export function appendDietDetails(
  content: HTMLElement,
  summary: CateringSummary,
  emptyMessage: string,
  headingLevel: 3 | 4 = 3,
  review?: { panel: HTMLElement; openResponses: (responses: string[]) => void },
): void {
  if (summary.needsReview)
    append(
      content,
      el(
        "p",
        `${summary.needsReview} person${summary.needsReview === 1 ? " needs" : "s need"} dietary review. Review the marked groups and original responses before sending the summary.`,
        "mt-5 border-l-2 border-ink pl-4 font-bold leading-7",
      ),
    );
  append(
    content,
    el(
      "p",
      "Blank answers and placeholders do not confirm that a person has no restrictions. Diet responses are kept in the organizer workspace. The summary exports counts and original responses; names, emails, and ticket codes are not added.",
      "mt-4 max-w-3xl text-sm leading-6 text-muted",
    ),
  );
  if (!summary.active) {
    append(content, el("p", emptyMessage, "mt-6 font-bold"));
    return;
  }
  if (!summary.requirements) {
    if (review) append(content, review.panel);
    append(
      content,
      el(
        "p",
        "No dietary requirements reported by the people included in catering.",
        "mt-6 font-bold",
      ),
    );
    return;
  }
  append(
    content,
    el(
      headingLevel === 3 ? "h3" : "h4",
      "Requirement counts",
      "mt-8 font-headline text-2xl font-black uppercase",
    ),
    el(
      "p",
      "Counts overlap and can include alternatives. Use the combined groups for meal counts and check the marked responses before choosing meals.",
      "mt-2 text-sm leading-6 text-muted",
    ),
  );
  const requirementCounts = el(
    "dl",
    "",
    "mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3",
  );
  for (const item of summary.counts.filter((item) => item.count)) {
    const row = el(
      "div",
      "",
      "flex items-baseline justify-between gap-4 border-b border-ink/20 py-3",
    );
    append(
      row,
      el("dt", item.label),
      el("dd", String(item.count), "font-bold"),
    );
    append(requirementCounts, row);
  }
  append(
    content,
    requirementCounts,
    el(
      headingLevel === 3 ? "h3" : "h4",
      "Combined requirements",
      "mt-8 font-headline text-2xl font-black uppercase",
    ),
    el(
      "p",
      "Each person with reported requirements appears in one group. Original responses below each group preserve the details, including specific allergies and alternatives.",
      "mt-2 max-w-3xl text-sm leading-6 text-muted",
    ),
  );
  if (review) append(content, review.panel);
  const groups = el("div", "", "mt-5 grid gap-3 lg:grid-cols-2");
  for (const group of summary.groups) {
    const card = el(
      "article",
      "",
      "min-w-0 break-words border border-ink/40 p-4",
    );
    card.dataset.dietReview = String(group.needsReview);
    append(
      card,
      el(
        headingLevel === 3 ? "h4" : "h5",
        `${group.count} x ${group.label}`,
        "text-lg font-bold",
      ),
    );
    if (group.needsReview)
      append(
        card,
        el("p", "Review original response", "mt-1 text-sm font-bold uppercase"),
      );
    else if (group.reviewed)
      append(card, el("p", "Reviewed", "mt-1 text-sm font-bold uppercase"));
    const responses = el("ul", "", "mt-3 grid gap-2 text-sm leading-6");
    for (const response of group.responses)
      append(
        responses,
        el("li", `${response.count} x ${response.text}`, "whitespace-pre-wrap"),
      );
    append(card, responses);
    for (const note of group.notes ?? [])
      append(
        card,
        el(
          "p",
          `Catering instructions (${note.count}): ${note.text}`,
          "mt-3 whitespace-pre-wrap border-t border-ink/20 pt-3 text-sm leading-6",
        ),
      );
    if (review) {
      const action = button("Review people in this group", () =>
        review.openResponses(group.responses.map(({ text }) => text)),
      );
      action.classList.add("mt-4");
      append(card, action);
    }
    append(groups, card);
  }
  append(content, groups);
}
