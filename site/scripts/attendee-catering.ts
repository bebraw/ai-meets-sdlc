import { append, button, el, message } from "./admin-toolkit.ts";
import {
  cateringSummaryText,
  summarizeAttendeeDiets,
} from "./attendee-diets.ts";
import type { Attendee } from "./attendee-model.ts";
import {
  buildCateringRoster,
  type CateringData,
  type CateringMapping,
} from "./attendee-catering-model.ts";

export function createAttendeeCateringPanel(
  saveMappings: (
    mappings: CateringMapping[],
    revision: number,
    version: string,
  ) => Promise<void>,
) {
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
      "Active Tito and Webropol registrations plus speakers and mapped dinner guests. Cancelled registrations are excluded. This summary uses the complete list, regardless of the search filters below.",
      "mt-3 max-w-3xl leading-7 text-muted",
    ),
    el(
      "p",
      "Speaker dietary responses come from dinner registration. Dinner attendance does not determine daytime attendance. Exact email or unique name matches count a person once; review the dinner mappings below for organizers and other guests. Volunteers and guests without a mapped response still need to be added separately.",
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
  let cateringData: CateringData | undefined;
  let loadError = "";
  let locked = false;
  let saving = false;
  let mappingSignature = "";
  const drafts = new Map<string, string>();
  let draftRevision: { revision: number; version: string } | undefined;
  const mappingsRoot = el("details", "", "mt-8 border-t border-ink/20 pt-5");
  const mappingTitle = el(
    "summary",
    "Dinner mappings",
    "cursor-pointer font-bold uppercase",
  );
  const mappingRows = el("div", "", "mt-4 grid gap-3 lg:grid-cols-2");
  const save = button("Save dinner mappings", () => {
    if (!cateringData || !draftRevision || saving) return;
    const base = new Map(
      cateringData.mappings
        .filter((item) =>
          cateringData!.sources.some((source) => source.id === item.sourceId),
        )
        .map((item) => [item.sourceId, item.target]),
    );
    for (const [sourceId, target] of drafts) {
      if (target) base.set(sourceId, target);
      else base.delete(sourceId);
    }
    const revision = draftRevision;
    saving = true;
    updateControls();
    void saveMappings(
      [...base].map(([sourceId, target]) => ({ sourceId, target })),
      revision.revision,
      revision.version,
    )
      .then(() => {
        drafts.clear();
        draftRevision = undefined;
        mappingSignature = "";
        render(attendees, cateringData, loadError);
        status.textContent = "Dinner mappings saved.";
      })
      .catch((error: unknown) => {
        status.textContent = message(error);
      })
      .finally(() => {
        saving = false;
        updateControls();
      });
  });
  const discard = button("Discard mapping changes", () => {
    drafts.clear();
    draftRevision = undefined;
    mappingSignature = "";
    render(attendees, cateringData, loadError);
    status.textContent = "Unsaved mapping changes discarded.";
  });
  append(
    mappingsRoot,
    mappingTitle,
    el(
      "p",
      "Use Automatic for exact matches. Map a dinner name to an organizer or existing attendee when it differs. Choose Additional person only when they need their own meal. Saved links survive attendee reimports; unmatched or ambiguous responses are not counted until mapped.",
      "mt-3 max-w-3xl text-sm leading-6 text-muted",
    ),
    mappingRows,
  );
  const mappingActions = el("div", "", "mt-4 flex flex-wrap gap-3");
  append(mappingActions, save, discard);
  append(mappingsRoot, mappingActions);
  const roster = () => buildCateringRoster(attendees, cateringData!);
  const report = () =>
    cateringSummaryText(
      summarizeAttendeeDiets(roster().people),
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()) + " (Helsinki time)",
      {
        registrations: attendees.filter((person) => person.status === "active")
          .length,
        additional: roster().additional,
        pending: roster().pending,
      },
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
  append(panel, content, mappingsRoot, actions, status, fallback);

  function updateControls(): void {
    copy.disabled = download.disabled =
      locked || saving || !cateringData || drafts.size > 0;
    save.disabled = discard.disabled =
      locked || saving || !drafts.size || !cateringData;
    mappingRows.querySelectorAll("select").forEach((select) => {
      select.disabled = locked || saving || !cateringData;
    });
  }
  function render(
    people: readonly Attendee[],
    data?: CateringData,
    error = "",
  ): void {
    attendees = people;
    cateringData = data;
    loadError = error;
    updateControls();
    if (!data) {
      content.replaceChildren(
        el(
          "p",
          error || "Loading speaker and dinner responses…",
          "font-bold leading-7",
        ),
      );
      mappingsRoot.hidden = true;
      fallback.hidden = true;
      return;
    }
    mappingsRoot.hidden = false;
    if (!fallback.hidden) text.value = report();
    const combined = roster();
    const summary = summarizeAttendeeDiets(combined.people);
    const signature = JSON.stringify([people, data]);
    if (signature !== mappingSignature) {
      mappingSignature = signature;
      mappingRows.replaceChildren();
      const saved = new Map(
        data.mappings.map((item) => [item.sourceId, item.target]),
      );
      for (const row of combined.rows) {
        const card = el(
          "div",
          "",
          "min-w-0 break-words border border-ink/40 p-4",
        );
        card.dataset.cateringSource = row.source.id;
        const label = el("label", "", "mt-3 grid gap-2 text-sm font-bold");
        const select = el(
          "select",
          "",
          "min-w-0 w-full border border-ink bg-paper px-3 py-2 font-normal",
        );
        select.setAttribute(
          "aria-label",
          `Catering mapping for ${row.source.name}`,
        );
        const options: [string, string][] = [
          ["Automatic", ""],
          ["Additional person", "separate"],
          ["Exclude from daytime catering", "exclude"],
          ...data.organizers.map((person): [string, string] => [
            `Organizer: ${person.name}`,
            `organizer:${person.id}`,
          ]),
          ...people
            .filter((person) => person.status === "active")
            .map((person): [string, string] => [
              `Attendee: ${person.name} · ${person.ticketCode || person.email}`,
              `attendee:${person.id}`,
            ]),
        ];
        const value =
          drafts.get(row.source.id) ?? saved.get(row.source.id) ?? "";
        if (value && !options.some(([, target]) => target === value))
          options.push(["Previous person unavailable — choose again", value]);
        for (const [text, value] of options) {
          const option = el("option", text);
          option.value = value;
          append(select, option);
        }
        select.value = value;
        select.addEventListener("change", () => {
          draftRevision ??= { revision: data.revision, version: data.version };
          drafts.set(row.source.id, select.value);
          status.textContent =
            "Mapping changes are unsaved. Save or discard them before exporting.";
          updateControls();
        });
        append(
          label,
          el("span", `Catering mapping for ${row.source.name}`),
          select,
        );
        append(
          card,
          el("h3", row.source.name, "font-bold"),
          el("p", row.label, "mt-1 text-sm leading-6"),
          el(
            "p",
            `Dinner diet: ${row.source.diet || "No dietary answer"}`,
            "mt-2 whitespace-pre-wrap text-sm leading-6 text-muted",
          ),
          label,
        );
        append(mappingRows, card);
      }
      mappingTitle.textContent = `Dinner mappings · ${combined.pending} to review`;
    }
    updateControls();
    content.replaceChildren();
    const counts = el(
      "dl",
      "",
      "grid gap-5 border-y border-ink/20 py-5 sm:grid-cols-2 lg:grid-cols-5",
    );
    for (const [label, count] of [
      ["Catering headcount", summary.active],
      [
        "Active registrations",
        people.filter((person) => person.status === "active").length,
      ],
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
    append(
      content,
      el(
        "p",
        `${people.filter((person) => person.status === "active").length} active registrations + ${combined.additional} additional speakers, organizers, and guests.`,
        "mt-4 text-sm leading-6",
      ),
    );
    if (combined.pending)
      append(
        content,
        el(
          "p",
          `${combined.pending} dinner response${combined.pending === 1 ? " needs" : "s need"} mapping and ${combined.pending === 1 ? "is" : "are"} not included in the headcount. Review Dinner mappings below.`,
          "mt-4 border-l-2 border-ink pl-4 font-bold leading-7",
        ),
      );
    if (summary.needsReview)
      append(
        content,
        el(
          "p",
          `${summary.needsReview} person${summary.needsReview === 1 ? " has" : "s have"} specific details or ambiguous wording. Review the marked groups and original responses before sending the summary.`,
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
          "No people included in catering yet. Import registrations or review dinner mappings.",
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
          "No dietary requirements reported by the people included in catering.",
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
        "Each person with reported requirements appears in one group. Original responses below each group preserve the details, including specific allergies and alternatives.",
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
  return {
    panel,
    render,
    setBusy(value: boolean) {
      locked = value;
      updateControls();
    },
    hasDrafts: () => drafts.size > 0 || saving,
  };
}
