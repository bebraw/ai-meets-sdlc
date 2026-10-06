import { append, button, el, message } from "./admin-toolkit.ts";
import { classifyDiet, dietCategories } from "./attendee-diets.ts";
import { parseDietReviews, type DietReview } from "./attendee-diet-reviews.ts";
import type { CateringPerson } from "./attendee-catering-model.ts";

type Snapshot = { revision: number; version: string };
const statusLabels = {
  reviewed: "Reviewed requirements",
  clarify: "Needs clarification",
  none: "No restrictions",
  missing: "Missing information",
};

export function createDietReviewPanel(
  save: (review: DietReview, snapshot: Snapshot) => Promise<void>,
  changed: () => void,
) {
  const panel = el("details", "", "mt-5 border border-ink p-4 md:p-5");
  panel.dataset.dietReviewQueue = "";
  const title = el(
    "summary",
    "Review dietary responses",
    "cursor-pointer font-bold uppercase",
  );
  const toolbar = el("div", "", "mt-4 flex flex-wrap items-end gap-3");
  const filterLabel = el("label", "", "grid gap-2 text-sm font-bold");
  const filter = el(
    "select",
    "",
    "border border-ink bg-paper px-3 py-2 font-normal",
  );
  filter.setAttribute("aria-label", "Dietary review filter");
  for (const [value, label] of [
    ["open", "Open cases"],
    ["clarify", "Needs clarification"],
    ["reviewed", "Reviewed cases"],
    ["all", "All responses"],
  ]) {
    const option = el("option", label);
    option.value = value!;
    append(filter, option);
  }
  append(filterLabel, el("span", "Dietary review filter"), filter);
  const progress = el("p", "", "text-sm leading-6");
  const editor = el("div", "", "mt-5");
  const feedback = el("p", "", "mt-3 text-sm leading-6");
  feedback.setAttribute("role", "status");
  let people: CateringPerson[] = [];
  let snapshot: Snapshot = { revision: 0, version: "" };
  let selected = "";
  let dirty = false;
  let busy = false;
  let saving = false;
  let drawSignature = "";
  const isOpen = (person: CateringPerson) =>
    Boolean(
      person.staleReview ||
      (person.review
        ? person.review.status === "clarify"
        : classifyDiet(person.diet).needsReview),
    );
  const queue = () =>
    people.filter((person) => {
      if (filter.value === "open") return isOpen(person);
      if (filter.value === "clarify")
        return person.review?.status === "clarify";
      if (filter.value === "reviewed")
        return person.review && person.review.status !== "clarify";
      return true;
    });
  const previous = button("Previous case", () => navigate(-1));
  const next = button("Next case", () => navigate(1));
  const start = button("Review next", () => {
    if (dirty) return;
    filter.value = "open";
    selected = queue()[0]?.id ?? "";
    panel.open = true;
    drawSignature = "";
    draw();
  });
  append(toolbar, filterLabel, previous, next, start);
  append(
    panel,
    title,
    el(
      "p",
      "Review one person at a time. Select all requirements that apply and preserve specific allergy or preparation details in catering instructions. Your decisions update the combined groups and export; the original answers stay unchanged.",
      "mt-3 max-w-3xl text-sm leading-6 text-muted",
    ),
    toolbar,
    progress,
    editor,
    feedback,
  );
  filter.addEventListener("change", () => {
    selected = "";
    drawSignature = "";
    draw();
  });

  function navigate(direction: number) {
    if (dirty || busy || saving) return;
    const list = queue();
    selected =
      list[list.findIndex((person) => person.id === selected) + direction]
        ?.id ?? selected;
    drawSignature = "";
    draw();
  }
  function controls() {
    const list = queue();
    const index = list.findIndex((person) => person.id === selected);
    filter.disabled = start.disabled = busy || saving || dirty;
    previous.disabled = busy || saving || dirty || index <= 0;
    next.disabled =
      busy || saving || dirty || index < 0 || index >= list.length - 1;
    for (const selector of ["input", "select", "textarea", "button"] as const)
      editor.querySelectorAll(selector).forEach((control) => {
        control.disabled = busy || saving;
      });
    if (!busy && !saving) {
      const decision = editor.querySelector("select");
      const noRequirements =
        decision && ["none", "missing"].includes(decision.value);
      editor
        .querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement
        >("input, textarea")
        .forEach((control) => {
          control.disabled = Boolean(noRequirements);
        });
    }
  }
  function draw() {
    const list = queue();
    if (!list.some((person) => person.id === selected))
      selected = list[0]?.id ?? "";
    const index = list.findIndex((person) => person.id === selected);
    const person = list[index];
    const openCount = people.filter(isOpen).length;
    const reviewed = people.filter(
      (person) => person.review && person.review.status !== "clarify",
    ).length;
    title.textContent = `Review dietary responses · ${openCount} open`;
    progress.textContent = `${openCount} open · ${reviewed} reviewed${person ? ` · Case ${index + 1} of ${list.length}` : ""}`;
    if (dirty) {
      controls();
      return;
    }
    const signature = JSON.stringify([person, snapshot, filter.value]);
    if (signature === drawSignature) {
      controls();
      return;
    }
    drawSignature = signature;
    editor.replaceChildren();
    if (!person) {
      append(
        editor,
        el(
          "p",
          filter.value === "open"
            ? "No open dietary cases. Use All responses to review or change any classification."
            : "No responses in this filter.",
          "font-bold leading-7",
        ),
      );
      controls();
      return;
    }
    const captured = { ...snapshot };
    const saved = person.review;
    const suggested = classifyDiet(person.diet);
    const form = el("form", "", "grid gap-5");
    form.dataset.dietReviewPerson = person.id;
    append(form, el("h4", person.name, "font-headline text-2xl font-black"));
    if (person.staleReview)
      append(
        form,
        el(
          "p",
          "The source response or person mapping changed. The previous decision is no longer applied. Review the current original response before saving again.",
          "border-l-2 border-ink pl-3 font-bold leading-6",
        ),
      );
    const original = el("div", "", "border border-ink/40 p-4");
    append(
      original,
      el("p", "Original response", "text-sm font-bold uppercase"),
      el(
        "p",
        person.diet || "No dietary answer",
        "mt-2 whitespace-pre-wrap break-words leading-7",
      ),
    );
    append(form, original);
    if (person.staleReview)
      append(
        form,
        el(
          "p",
          `Previous decision: ${statusLabels[person.staleReview.status]}${person.staleReview.note ? ` · ${person.staleReview.note}` : ""}`,
          "whitespace-pre-wrap text-sm leading-6 text-muted",
        ),
      );
    const decisionLabel = el("label", "", "grid gap-2 text-sm font-bold");
    const decision = el(
      "select",
      "",
      "w-full border border-ink bg-paper px-3 py-2 font-normal",
    );
    decision.dataset.reviewStatus = "";
    decision.setAttribute("aria-label", "Review decision");
    for (const [value, label] of Object.entries(statusLabels)) {
      const option = el("option", label);
      option.value = value;
      append(decision, option);
    }
    decision.value = saved?.status ?? "reviewed";
    append(decisionLabel, el("span", "Review decision"), decision);
    const categories = el(
      "fieldset",
      "",
      "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
    );
    append(
      categories,
      el(
        "legend",
        "Dietary categories (choose all that apply)",
        "mb-3 text-sm font-bold",
      ),
    );
    for (const category of dietCategories) {
      const label = el(
        "label",
        "",
        "flex items-center gap-3 border border-ink/30 px-3 py-3 text-sm",
      );
      const input = el("input");
      input.type = "checkbox";
      input.value = category.id;
      input.checked = (saved?.categories ?? suggested.categories).includes(
        category.id,
      );
      append(label, input, el("span", category.label));
      append(categories, label);
    }
    const notesLabel = el("label", "", "grid gap-2 text-sm font-bold");
    const notes = el(
      "textarea",
      "",
      "min-h-24 w-full border border-ink bg-paper p-3 font-normal leading-6",
    );
    notes.rows = 3;
    notes.maxLength = 2000;
    notes.value = saved?.note ?? "";
    append(notesLabel, el("span", "Catering instructions"), notes);
    const actions = el("div", "", "flex flex-wrap gap-3");
    const saveNext = button("Save and next", () => form.requestSubmit());
    const discard = button("Discard review changes", () => {
      dirty = false;
      drawSignature = "";
      draw();
      feedback.textContent = "Unsaved review changes discarded.";
      changed();
    });
    append(actions, saveNext, discard);
    append(
      form,
      decisionLabel,
      categories,
      notesLabel,
      el(
        "p",
        "Choose Needs clarification when the answer is ambiguous. No restrictions requires an explicit confirmation; Missing information records an unusable or absent answer. Keep names and contact details out of catering instructions.",
        "max-w-3xl text-sm leading-6 text-muted",
      ),
      actions,
    );
    form.addEventListener("input", () => {
      dirty = true;
      feedback.textContent =
        "Review changes are unsaved. Save or discard before navigating or exporting.";
      controls();
      changed();
    });
    form.addEventListener("change", () => {
      dirty = true;
      controls();
      changed();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (busy || saving) return;
      const noRequirements = ["none", "missing"].includes(decision.value);
      let review: DietReview | undefined;
      try {
        [review] = parseDietReviews([
          {
            personId: person.id,
            sourceSignature: person.sourceSignature,
            status: decision.value,
            categories: noRequirements
              ? []
              : [
                  ...categories.querySelectorAll<HTMLInputElement>(
                    "input:checked",
                  ),
                ].map((input) => input.value),
            note: noRequirements ? "" : notes.value.trim(),
          },
        ]);
      } catch (error) {
        feedback.textContent = message(error);
        return;
      }
      const nextId = list[index + 1]?.id ?? list[index - 1]?.id ?? "";
      saving = true;
      feedback.textContent = "Saving dietary review…";
      controls();
      changed();
      void save(review!, captured)
        .then(() => {
          dirty = false;
          selected = nextId;
          drawSignature = "";
          draw();
          feedback.textContent =
            "Dietary review saved. Counts and export updated.";
        })
        .catch((error: unknown) => {
          feedback.textContent = message(error);
        })
        .finally(() => {
          saving = false;
          controls();
          changed();
          editor.querySelector("select")?.focus();
        });
    });
    append(editor, form);
    controls();
  }
  return {
    panel,
    render(
      nextPeople: CateringPerson[],
      nextSnapshot: Snapshot,
      disabled: boolean,
    ) {
      people = nextPeople.filter((person) => person.status === "active");
      snapshot = nextSnapshot;
      busy = disabled;
      draw();
    },
    setBusy(disabled: boolean) {
      busy = disabled;
      controls();
    },
    hasDrafts: () => dirty || saving,
    openResponses(responses: string[]) {
      if (dirty || busy || saving) return;
      const matching = people.filter((person) =>
        responses.includes(person.diet ?? ""),
      );
      const person = matching.find(isOpen) ?? matching[0];
      if (!person) return;
      filter.value = isOpen(person) ? "open" : "all";
      selected = person.id;
      panel.open = true;
      drawSignature = "";
      draw();
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      editor.querySelector("select")?.focus({ preventScroll: true });
    },
  };
}
