import { append, button, el, field, message } from "./admin-toolkit.ts";
import { cateringSummaryText } from "./attendee-diets.ts";
import type { Attendee } from "./attendee-model.ts";
import { appendDietDetails } from "./catering-summary.ts";
import {
  buildCateringRoster,
  maxReservedMeals,
  summarizeCateringPlan,
  type CateringData,
  type CateringMapping,
} from "./attendee-catering-model.ts";

export function createAttendeeCateringPanel(
  saveMappings: (
    mappings: CateringMapping[],
    revision: number,
    version: string,
    reservedMeals: number,
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
      "Active Tito and Webropol registrations, accepted poster presenters and volunteers, plus speakers and mapped dinner guests. Cancelled registrations are excluded. This summary uses the complete list, regardless of the search filters below.",
      "mt-3 max-w-3xl leading-7 text-muted",
    ),
    el(
      "p",
      "Speaker dietary responses come from dinner registration. Dinner attendance does not determine daytime attendance. Exact email or unique name matches count a person once; Poster presenters are attendees and volunteers are organizers. Their dinner responses are matched to registrations below; review aliases and ambiguous matches before exporting.",
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
  let reservedDraft: string | undefined;
  let draftRevision: { revision: number; version: string } | undefined;
  const reservePanel = el(
    "div",
    "",
    "mt-6 grid gap-3 border border-ink/40 p-4",
  );
  const reserve = field("Reserved meals", "0", "number");
  reserve.input.min = "0";
  reserve.input.max = String(maxReservedMeals);
  reserve.input.step = "1";
  reserve.input.required = true;
  reserve.input.disabled = true;
  reserve.input.addEventListener("input", () => {
    if (!cateringData) return;
    draftRevision ??= {
      revision: cateringData.revision,
      version: cateringData.version,
    };
    reservedDraft = reserve.input.value;
    status.textContent =
      "Meal reserve changes are unsaved. Save or discard them before exporting.";
    updateControls();
  });
  const mappingsRoot = el("details", "", "mt-8 border-t border-ink/20 pt-5");
  const mappingTitle = el(
    "summary",
    "Catering mappings",
    "cursor-pointer font-bold uppercase",
  );
  const mappingRows = el("div", "", "mt-4 grid gap-3 lg:grid-cols-2");
  const save = button("Save catering mappings", () => {
    if (!cateringData || !draftRevision || saving) return;
    if (!reserve.input.checkValidity()) {
      reserve.input.reportValidity();
      return;
    }
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
    const reservedMeals = Number(
      reservedDraft ?? cateringData.reservedMeals ?? 0,
    );
    const reserveChanged = reservedDraft !== undefined;
    saving = true;
    updateControls();
    void saveMappings(
      [...base].map(([sourceId, target]) => ({ sourceId, target })),
      revision.revision,
      revision.version,
      reservedMeals,
    )
      .then(() => {
        drafts.clear();
        reservedDraft = undefined;
        draftRevision = undefined;
        mappingSignature = "";
        render(attendees, cateringData, loadError);
        status.textContent = reserveChanged
          ? "Reserved meals saved."
          : "Catering mappings saved.";
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
    if (reservedDraft === undefined) draftRevision = undefined;
    mappingSignature = "";
    render(attendees, cateringData, loadError);
    status.textContent = "Unsaved mapping changes discarded.";
  });
  const saveReserve = button("Save reserved meals", () => save.click());
  const discardReserve = button("Discard reserved meal changes", () => {
    reservedDraft = undefined;
    if (!drafts.size) draftRevision = undefined;
    render(attendees, cateringData, loadError);
    status.textContent = "Unsaved meal reserve changes discarded.";
  });
  const reserveActions = el("div", "", "flex flex-wrap gap-3");
  append(reserveActions, saveReserve, discardReserve);
  append(
    reservePanel,
    el("h3", "Meal reserve", "text-lg font-bold uppercase"),
    el(
      "p",
      "Reserve meals for unassigned tickets or additional guests. These meals have no dietary answers. Reduce the reserve as ticket holders join the named attendee list. Spare badge quantity is managed separately in Badge studio.",
      "max-w-3xl text-sm leading-6 text-muted",
    ),
    reserve.label,
    reserveActions,
  );
  append(
    mappingsRoot,
    mappingTitle,
    el(
      "p",
      "Use Automatic for exact matches. Match poster presenters and volunteers to an imported registration when needed; these links also apply at check-in. Map dinner aliases to an organizer or existing attendee. Choose Additional person only when they need their own meal. Saved links survive attendee reimports; unmatched or ambiguous responses are not counted until mapped.",
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
      summarizeCateringPlan(roster(), cateringData?.reservedMeals ?? 0),
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
        reservedMeals: cateringData?.reservedMeals ?? 0,
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
  append(panel, reservePanel, content, mappingsRoot, actions, status, fallback);

  function updateControls(): void {
    reserve.input.disabled = locked || saving || !cateringData;
    copy.disabled = download.disabled =
      locked ||
      saving ||
      !cateringData ||
      drafts.size > 0 ||
      reservedDraft !== undefined;
    save.disabled =
      locked ||
      saving ||
      (!drafts.size && reservedDraft === undefined) ||
      !cateringData ||
      !reserve.input.checkValidity();
    discard.disabled = locked || saving || !drafts.size || !cateringData;
    saveReserve.disabled =
      locked ||
      saving ||
      !cateringData ||
      reservedDraft === undefined ||
      !reserve.input.checkValidity();
    discardReserve.disabled =
      locked || saving || !cateringData || reservedDraft === undefined;
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
          error || "Loading registration and dinner sources…",
          "font-bold leading-7",
        ),
      );
      mappingsRoot.hidden = true;
      reservePanel.hidden = true;
      fallback.hidden = true;
      return;
    }
    mappingsRoot.hidden = false;
    reservePanel.hidden = false;
    reserve.input.value = reservedDraft ?? String(data.reservedMeals ?? 0);
    if (!fallback.hidden) text.value = report();
    const combined = roster();
    const summary = summarizeCateringPlan(combined, data.reservedMeals ?? 0);
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
        const member =
          row.source.kind === "poster-presenter" ||
          row.source.kind === "volunteer";
        const options: [string, string][] = [
          ["Automatic", ""],
          ["Additional person", "separate"],
          ...(!member
            ? [["Exclude from daytime catering", "exclude"] as [string, string]]
            : []),
          ...(!member ? data.organizers : []).map(
            (person): [string, string] => [
              `Organizer: ${person.name}`,
              `organizer:${person.id}`,
            ],
          ),
          ...people
            .filter(
              (person) =>
                person.status === "active" &&
                (!member ||
                  person.source === "tito" ||
                  person.source === "webropol"),
            )
            .map((person): [string, string] => [
              ` ${person.type === "organizer" ? "Organizer" : "Attendee"}: ${person.name} · ${person.ticketCode || person.email}`.trim(),
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
            member
              ? `Diet from dinner: ${row.source.registrationId ? combined.attendeeDiets[row.source.registrationId] || "No dietary answer" : "Match registration first"}`
              : `Dinner diet: ${row.source.diet || "No dietary answer"}`,
            "mt-2 whitespace-pre-wrap text-sm leading-6 text-muted",
          ),
          label,
        );
        append(mappingRows, card);
      }
      mappingTitle.textContent = `Catering mappings · ${combined.pending} to review`;
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
        `${people.filter((person) => person.status === "active").length} active registrations + ${combined.additional} additional speakers, organizers, and guests${data.reservedMeals ? ` + ${data.reservedMeals} reserved meals` : ""}.`,
        "mt-4 text-sm leading-6",
      ),
    );
    if (combined.pending)
      append(
        content,
        el(
          "p",
          `${combined.pending} catering source${combined.pending === 1 ? " needs" : "s need"} mapping and ${combined.pending === 1 ? "is" : "are"} not included in the headcount. Review Catering mappings below.`,
          "mt-4 border-l-2 border-ink pl-4 font-bold leading-7",
        ),
      );
    appendDietDetails(
      content,
      summary,
      "No people included in catering yet. Import registrations or review catering mappings.",
    );
  }
  return {
    panel,
    render,
    setBusy(value: boolean) {
      locked = value;
      updateControls();
    },
    hasDrafts: () => drafts.size > 0 || reservedDraft !== undefined || saving,
  };
}
