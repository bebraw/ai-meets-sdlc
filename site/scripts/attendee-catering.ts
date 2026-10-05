import { append, button, el } from "./admin-toolkit.ts";
import {
  cateringSummaryText,
  summarizeAttendeeDiets,
} from "./attendee-diets.ts";
import type { Attendee } from "./attendee-model.ts";

export function createAttendeeCateringPanel() {
  const panel = el("section", "", "my-8 border border-ink p-5 md:p-7");
  panel.dataset.attendeeCatering = "";
  append(
    panel,
    el(
      "h2",
      "03 / Catering summary",
      "font-headline text-3xl font-black uppercase",
    ),
    el(
      "p",
      "Active attendee registrations from Tito and Webropol. Cancelled registrations are excluded. This summary uses the complete list, regardless of the search filters below.",
      "mt-3 max-w-3xl leading-7 text-muted",
    ),
    el(
      "p",
      "Speakers, volunteers, and guests without an attendee registration need to be added to the catering headcount separately.",
      "mt-2 max-w-3xl text-sm leading-6 text-muted",
    ),
  );
  const content = el("div", "Loading dietary responses…", "mt-6");
  const actions = el("div", "", "mt-6 flex flex-wrap gap-3");
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
  append(fallback, el("span", "Catering summary (select and copy)"), text);
  let attendees: readonly Attendee[] = [];
  const report = () =>
    cateringSummaryText(
      summarizeAttendeeDiets(attendees),
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()) + " (Helsinki time)",
    );
  const copy = button("Copy catering summary", () => {
    const value = report();
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(value))
      .then(() => {
        fallback.hidden = true;
        status.textContent = "Catering summary copied.";
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
  const download = button("Download catering summary", () => {
    const url = URL.createObjectURL(
      new Blob([report()], { type: "text/plain;charset=utf-8" }),
    );
    const link = el("a");
    link.href = url;
    link.download = "sdlcai-2026-attendee-catering-summary.txt";
    append(document.body, link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Catering summary downloaded.";
  });
  copy.disabled = true;
  download.disabled = true;
  append(actions, copy, download);
  append(panel, content, actions, status, fallback);

  function render(people: readonly Attendee[]): void {
    attendees = people;
    if (!fallback.hidden) text.value = report();
    const summary = summarizeAttendeeDiets(people);
    content.replaceChildren();
    const counts = el(
      "dl",
      "",
      "grid gap-5 border-y border-ink/20 py-5 sm:grid-cols-2 lg:grid-cols-4",
    );
    for (const [label, count] of [
      ["Active registrations", summary.active],
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
    append(content, counts);
    if (summary.needsReview)
      append(
        content,
        el(
          "p",
          `${summary.needsReview} registration${summary.needsReview === 1 ? " has" : "s have"} specific details or ambiguous wording. Review the marked groups and original responses before sending the summary.`,
          "mt-5 border-l-2 border-ink pl-4 font-bold leading-7",
        ),
      );
    append(
      content,
      el(
        "p",
        "Blank answers and placeholders do not confirm that an attendee has no restrictions. Diet responses are kept in the organizer workspace. The summary exports counts and original responses; attendee names, emails, and ticket codes are not added.",
        "mt-4 max-w-3xl text-sm leading-6 text-muted",
      ),
    );
    if (!summary.active) {
      append(
        content,
        el(
          "p",
          "No active attendee registrations yet. Import a CSV to prepare the summary.",
          "mt-6 font-bold",
        ),
      );
      return;
    }
    if (!summary.requirements) {
      append(
        content,
        el(
          "p",
          "No dietary requirements reported in the active registrations.",
          "mt-6 font-bold",
        ),
      );
      return;
    }
    append(
      content,
      el(
        "h3",
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
        "h3",
        "Combined requirements",
        "mt-8 font-headline text-2xl font-black uppercase",
      ),
      el(
        "p",
        "Each registration with reported requirements appears in one group. Original responses below each group preserve the details, including specific allergies and alternatives.",
        "mt-2 max-w-3xl text-sm leading-6 text-muted",
      ),
    );
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
        el("h4", `${group.count} x ${group.label}`, "text-lg font-bold"),
      );
      if (group.needsReview)
        append(
          card,
          el(
            "p",
            "Review original response",
            "mt-1 text-sm font-bold uppercase",
          ),
        );
      const responses = el("ul", "", "mt-3 grid gap-2 text-sm leading-6");
      for (const response of group.responses)
        append(
          responses,
          el(
            "li",
            `${response.count} x ${response.text}`,
            "whitespace-pre-wrap",
          ),
        );
      append(card, responses);
      append(groups, card);
    }
    append(content, groups);
  }
  return { panel, render };
}
