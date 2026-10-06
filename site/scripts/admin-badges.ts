import { append } from "./admin-toolkit.ts";
import "./index.ts";
import { el, button, field, api, message } from "./admin-toolkit.ts";
import {
  defaultSettings,
  parseWorkspace,
  duplicateIds,
  type BadgePerson,
  type BadgeRole,
  type BadgeWorkspace,
} from "./badge-model.ts";
import {
  applyPrintPreferences,
  parsePrintPreferences,
  isLegacyBadgeId,
  maxSpareAttendeeBadges,
  requestedSpareAttendeeBadges,
  type PrintPreferences,
  type BadgeStudioData,
} from "./badge-studio-model.ts";
import {
  loadBadgeFont,
  renderBadge,
  renderSpareAttendeeBadge,
  type BadgeFont,
} from "./badge-layout.ts";
const root = document.querySelector<HTMLElement>("[data-admin-badges]");
if (root) setup(root);
function setup(root: HTMLElement): void {
  let workspace: BadgeWorkspace = {
    people: [],
    settings: { ...defaultSettings },
  };
  let revision = 0;
  let loaded = false;
  let dirty = false;
  let busy = false;
  let selected = "";
  let previewingSpare = false;
  let spareAttendeeBadges = 0;
  const requestedSpares = requestedSpareAttendeeBadges(location.search);
  let requestedSparesApplied = false;
  let font: BadgeFont | undefined;
  const layoutIssues = new Map<string, string[]>();
  let sourcePeople: BadgePerson[] = [];
  let signatures: Record<string, string> = {};
  let legacyWorkspace: BadgeWorkspace | null = null;
  let retiredLegacyIds: string[] = [];
  const status = el(
    "p",
    "Loading people, print settings, and font…",
    "border border-ink p-4 font-bold",
  );
  status.setAttribute("role", "status");
  const toolbar = el("div", "", "flex flex-wrap gap-3 my-5");
  const stage = el(
    "div",
    "",
    "grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
  );
  const controls = el("div", "", "grid min-w-0 content-start gap-6");
  const proof = el(
    "div",
    "",
    "min-w-0 self-start lg:sticky lg:top-5 border border-ink p-5 bg-ink/5",
  );
  const preview = el("div", "", "badge-preview my-4");
  const previewStatus = el(
    "p",
    "Select a person to inspect their badge.",
    "text-sm leading-6",
  );
  const proofNavigation = el(
    "div",
    "",
    "flex flex-wrap items-center gap-3 my-4",
  );
  proofNavigation.setAttribute("role", "group");
  proofNavigation.setAttribute("aria-label", "Proof navigation");
  const previousProof = button("← Previous", () => moveProof(-1));
  const nextProof = button("Next →", () => moveProof(1));
  const proofPosition = el("span", "", "text-sm font-bold");
  proofPosition.setAttribute("role", "status");
  append(proofNavigation, previousProof, proofPosition, nextProof);
  proof.tabIndex = 0;
  proof.setAttribute("aria-label", "Print proof");
  proof.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    moveProof(event.key === "ArrowLeft" ? -1 : 1);
  });
  append(
    proof,
    el("h2", "Print proof", "font-headline text-3xl uppercase"),
    proofNavigation,
    el(
      "p",
      "Use ← / → while focused here to browse all badges.",
      "text-xs text-muted",
    ),
    preview,
    previewStatus,
  );
  const count = el("p", "", "my-5 font-bold");
  const list = el("div", "", "grid gap-4");
  const filter = field("Find a badge", "", "search");
  filter.input.addEventListener("input", renderList);
  const printRoot = el("div", "", "badge-print-root");
  append(document.body, printRoot);
  const style = el("style");
  style.textContent = `.badge-preview svg{width:100%;max-width:430px;height:auto;display:block;margin:auto;box-shadow:0 1px 8px #0002}.badge-print-root{display:none}@media print{body>*:not(.badge-print-root){display:none!important}.badge-print-root[data-ready]{display:block!important}.badge-print-sheet{break-after:page;page-break-after:always;line-height:0}.badge-print-sheet:last-child{break-after:auto;page-break-after:auto}.badge-print-sheet svg{display:block;print-color-adjust:exact;-webkit-print-color-adjust:exact}html,body{margin:0!important;padding:0!important;background:white!important}}`;
  append(document.head, style);
  const pageStyle = el("style");
  append(document.head, pageStyle);
  function invalidate() {
    dirty = true;
    layoutIssues.clear();
    printRoot.removeAttribute("data-ready");
    printRoot.replaceChildren();
    status.textContent =
      "Unsaved print settings or badge text. Save before leaving this page.";
  }
  function locked(value: boolean) {
    busy = value;
    root.querySelectorAll("button,input,select,textarea").forEach((n) => {
      if (
        n instanceof HTMLInputElement ||
        n instanceof HTMLButtonElement ||
        n instanceof HTMLSelectElement ||
        n instanceof HTMLTextAreaElement
      )
        n.disabled = value;
    });
    updateProofNavigation();
  }
  async function work(action: () => Promise<void>) {
    if (busy) return;
    locked(true);
    try {
      await action();
    } catch (error) {
      status.textContent = message(error);
    } finally {
      locked(false);
    }
  }
  function updateProofNavigation() {
    const index = workspace.people.findIndex((p) => p.id === selected);
    proofPosition.textContent = previewingSpare
      ? "Spare attendee badge"
      : workspace.people.length
        ? `${Math.max(0, index) + 1} / ${workspace.people.length}`
        : "0 / 0";
    previousProof.disabled = nextProof.disabled =
      busy ||
      !workspace.people.length ||
      (!previewingSpare && workspace.people.length < 2);
  }
  function moveProof(step: number) {
    if (
      busy ||
      !workspace.people.length ||
      (!previewingSpare && workspace.people.length < 2)
    )
      return;
    const index = previewingSpare
      ? step > 0
        ? -1
        : 0
      : Math.max(
          0,
          workspace.people.findIndex((p) => p.id === selected),
        );
    selected =
      workspace.people[
        (index + step + workspace.people.length) % workspace.people.length
      ]!.id;
    showPreview();
  }
  function showPreview(spare = false) {
    previewingSpare = spare;
    const person =
      workspace.people.find((p) => p.id === selected) ?? workspace.people[0];
    preview.replaceChildren();
    selected = person?.id ?? "";
    updateProofNavigation();
    if (spare && font) {
      const result = renderSpareAttendeeBadge(workspace.settings, font);
      append(preview, result.svg);
      previewStatus.textContent = result.issues.length
        ? result.issues.join(" ")
        : "Spare attendee badge: blank name and company areas for writing at the desk.";
      return;
    }
    if (!person || !font) {
      previewStatus.textContent = "Select a person to inspect their badge.";
      return;
    }
    const result = renderBadge(person, workspace.settings, font);
    append(preview, result.svg);
    previewStatus.textContent = result.issues.length
      ? result.issues.join(" ")
      : `${person.name}: fits the safe area. Grey guides are preview only unless trim guide is enabled.`;
  }
  function renderList() {
    const duplicate = duplicateIds(workspace.people);
    const term = filter.input.value.toLocaleLowerCase();
    count.textContent = `${workspace.people.filter((p) => p.included).length} included / ${workspace.people.length} total · ${spareAttendeeBadges} spare attendee badges · ${duplicate.size} unresolved duplicate rows`;
    const visible = workspace.people.filter((p) =>
      `${p.name} ${p.email} ${p.source} ${p.role}`
        .toLocaleLowerCase()
        .includes(term),
    );
    list.replaceChildren();
    for (const person of visible) {
      const card = el(
        "article",
        "",
        "grid gap-4 border border-ink p-4 md:grid-cols-[2fr_1fr]",
      );
      const main = el("div", "", "grid min-w-0 gap-3");
      const actions = el("div", "", "grid content-start gap-3");
      const nameLabel = el(
        "label",
        "Badge name (line breaks allowed)",
        "grid gap-2 text-sm font-bold",
      );
      const name = el(
        "textarea",
        "",
        "w-full min-w-0 border border-ink bg-paper p-2 font-normal",
      );
      name.value = person.name;
      name.rows = 2;
      name.maxLength = 300;
      append(nameLabel, name);
      const company = field("Badge company", person.company);
      company.input.maxLength = 300;
      const edit = () => {
        person.name = name.value;
        person.company = company.input.value;
        selected = person.id;
        invalidate();
        showPreview();
      };
      [name, company.input].forEach((n) => n.addEventListener("change", edit));
      append(
        main,
        nameLabel,
        company.label,
        el(
          "p",
          `${person.role} · ${person.source}`,
          "text-xs text-muted break-words",
        ),
      );
      append(
        actions,
        button("Preview", () => {
          selected = person.id;
          showPreview();
          preview.scrollIntoView({ block: "center", behavior: "smooth" });
        }),
        button("Reset badge text", () => {
          const original = sourcePeople.find((p) => p.id === person.id);
          if (!original) return;
          person.name = original.name;
          person.company = original.company;
          invalidate();
          renderList();
          showPreview();
        }),
      );
      if (isLegacyBadgeId(person.id))
        append(
          actions,
          button("Retire earlier badge", () => {
            if (busy) return;
            retiredLegacyIds.push(person.id);
            workspace.people = workspace.people.filter(
              (p) => p.id !== person.id,
            );
            invalidate();
            renderList();
            showPreview();
            status.textContent =
              "Earlier badge retired from this run. Save print settings to keep this choice.";
          }),
        );
      const issues = layoutIssues.get(person.id);
      if (issues?.length)
        append(
          main,
          el(
            "p",
            issues.join(" "),
            "border-l-4 border-signal pl-3 text-sm font-bold",
          ),
        );
      if (duplicate.has(person.id)) {
        append(
          actions,
          el(
            "p",
            "Matching email: review the attendee and team records, or confirm that both people need a badge.",
            "font-bold text-sm",
          ),
          button("Keep this duplicate", () => {
            person.duplicateReviewed = true;
            invalidate();
            renderList();
          }),
        );
      }
      append(card, main, actions);
      append(list, card);
    }
    if (!visible.length)
      append(
        list,
        el(
          "p",
          "No matching badges. Manage people in Attendees, Speakers, Organizers, or Volunteers.",
        ),
      );
    locked(busy);
  }
  const settingsPanel = el("details", "", "border border-ink p-5");
  append(
    settingsPanel,
    el(
      "summary",
      "Printer settings",
      "font-headline text-2xl uppercase cursor-pointer",
    ),
  );
  function renderSettings() {
    while (settingsPanel.children.length > 1)
      settingsPanel.lastElementChild!.remove();
    const fields = el("div", "", "grid gap-4 mt-5 sm:grid-cols-2");
    const specs = [
      ["diameter", "Diameter (mm)", 70, 150],
      ["bleed", "Bleed per edge (mm)", 0, 10],
      ["safe", "Safe inset (mm)", 3, 15],
      ["top", "Top hole exclusion (mm)", 10, 30],
      ["minName", "Minimum name size (pt)", 14, 24],
      ["maxName", "Maximum name size (pt)", 24, 40],
      ["companySize", "Company size (pt)", 9, 16],
    ] as const;
    for (const [key, label, min, max] of specs) {
      const f = field(label, String(workspace.settings[key]), "number");
      f.input.min = String(min);
      f.input.max = String(max);
      f.input.step = "0.5";
      f.input.addEventListener("change", () => {
        if (!f.input.checkValidity() || !f.input.value) {
          f.input.reportValidity();
          f.input.value = String(workspace.settings[key]);
          return;
        }
        workspace.settings[key] = Number(f.input.value);
        invalidate();
        showPreview(previewingSpare);
      });
      append(fields, f.label);
    }
    for (const [key, label] of [
      ["guides", "Print circular trim guide"],
      ["doubleSided", "Repeat each badge for an identical back"],
    ] as const) {
      const f = field(label, "", "checkbox");
      f.input.checked = workspace.settings[key];
      f.input.className = "h-5 w-5";
      f.input.addEventListener("change", () => {
        workspace.settings[key] = f.input.checked;
        invalidate();
        showPreview(previewingSpare);
      });
      append(fields, f.label);
    }
    append(
      settingsPanel,
      fields,
      el(
        "p",
        "One square PDF page per badge side. Page size = diameter + twice the bleed. Print at 100%, with background graphics on and headers/footers off. Confirm duplex order and color requirements with your printer.",
        "mt-4 text-sm leading-6",
      ),
    );
    const custom = field(
      "Optional font for additional scripts (.ttf / .otf; this tab only)",
      "",
      "file",
    );
    custom.input.accept = ".ttf,.otf";
    custom.input.addEventListener(
      "change",
      () =>
        void work(async () => {
          const file = custom.input.files?.[0];
          if (!file) return;
          if (file.size > 10 * 1024 * 1024)
            throw new Error("Font must be under 10 MB.");
          font = await loadBadgeFont(await file.arrayBuffer());
          invalidate();
          showPreview();
          status.textContent =
            "Custom font loaded for this tab. Reload it after reopening the workspace.";
        }),
    );
    append(settingsPanel, custom.label);
  }
  const sources = el("section", "", "grid gap-3 border border-ink p-5");
  append(
    sources,
    el("h2", "People for this badge run", "font-headline text-2xl uppercase"),
    el(
      "p",
      "Active attendees and sponsors selected for badges, public speakers, attending organizers, and selected volunteers load automatically. Edit people and attendance in their own workspaces; text adjustments here affect only the printed badge.",
      "text-sm leading-6",
    ),
  );
  const links = el(
    "div",
    "",
    "flex flex-wrap gap-4 text-sm font-bold underline",
  );
  for (const label of ["Attendees", "Speakers", "Organizers", "Volunteers"]) {
    const link = el("a", `Manage ${label.toLowerCase()}`);
    link.href = `/admin/${label.toLowerCase()}/`;
    append(links, link);
  }
  const legacyNotice = el("div", "", "grid gap-3 text-sm");
  append(sources, links, legacyNotice);
  const spares = el("section", "", "grid gap-3 border border-ink p-5");
  const spareCount = field("Spare attendee badges", "0", "number");
  spareCount.input.min = "0";
  spareCount.input.max = String(maxSpareAttendeeBadges);
  spareCount.input.step = "1";
  spareCount.input.required = true;
  spareCount.input.addEventListener("change", () => {
    if (!spareCount.input.checkValidity() || !spareCount.input.value) {
      spareCount.input.reportValidity();
      spareCount.input.value = String(spareAttendeeBadges);
      return;
    }
    spareAttendeeBadges = Number(spareCount.input.value);
    invalidate();
    renderList();
    showPreview(true);
  });
  append(
    spares,
    el("h2", "Spare attendee badges", "font-headline text-2xl uppercase"),
    el(
      "p",
      "Blank name and company areas for unassigned Tito tickets and walk-ins. Choose a total that covers those tickets plus any extras. Spares are included in attendee and full print runs, and can also be printed on their own. Save print settings to keep the count for reprints.",
      "text-sm leading-6",
    ),
    spareCount.label,
    button("Preview spare badge", () => showPreview(true)),
  );
  function preferences(): PrintPreferences {
    const originals = new Map(sourcePeople.map((p) => [p.id, p]));
    return parsePrintPreferences({
      settings: workspace.settings,
      spareAttendeeBadges,
      retiredLegacyIds,
      overrides: workspace.people
        .filter((p) => {
          const original = originals.get(p.id);
          return (
            original &&
            (p.name !== original.name ||
              p.company !== original.company ||
              p.duplicateReviewed !== original.duplicateReviewed)
          );
        })
        .map((p) => ({
          id: p.id,
          signature: signatures[p.id],
          name: p.name,
          company: p.company,
          duplicateReviewed: p.duplicateReviewed,
        })),
    });
  }
  async function refreshBeforePrint(): Promise<boolean> {
    const current = await api<BadgeStudioData>("/api/admin/badges", "");
    const changed =
      JSON.stringify(current.signatures) !== JSON.stringify(signatures);
    if (!changed) return true;
    const draft = preferences();
    sourcePeople = current.people;
    signatures = current.signatures;
    workspace.people = applyPrintPreferences(sourcePeople, draft, signatures);
    layoutIssues.clear();
    renderList();
    showPreview();
    status.textContent =
      "People changed since this preview. Review the updated badges, then check or print again.";
    return false;
  }
  async function check(role: BadgeRole | "all" | "spares", print: boolean) {
    printRoot.removeAttribute("data-ready");
    printRoot.replaceChildren();
    if (!font) throw new Error("The badge font has not loaded.");
    if (role !== "spares" && !(await refreshBeforePrint())) return;
    const people = workspace.people.filter(
      (p) => p.included && (role === "all" || p.role === role),
    );
    const spareCount =
      role === "all" || role === "attendee" || role === "spares"
        ? spareAttendeeBadges
        : 0;
    const total = people.length + spareCount;
    if (!total) throw new Error("No badges selected for this print run.");
    const duplicates = duplicateIds(workspace.people);
    layoutIssues.clear();
    const errors: string[] = [];
    const sheets: HTMLElement[] = [];
    function addSheet(svg: SVGSVGElement, spare = false) {
      const sheet = el("section", "", "badge-print-sheet");
      if (spare) sheet.dataset.spareBadge = "";
      append(sheet, svg);
      sheets.push(sheet);
      if (workspace.settings.doubleSided)
        sheets.push(sheet.cloneNode(true) as HTMLElement);
    }
    for (let i = 0; i < people.length; i++) {
      const person = people[i]!;
      const rendered = renderBadge(person, workspace.settings, font, false);
      if (duplicates.has(person.id))
        rendered.issues.push("Review the matching email before printing.");
      if (rendered.issues.length) layoutIssues.set(person.id, rendered.issues);
      if (rendered.issues.length)
        errors.push(
          `${person.name || "Unnamed badge"}: ${rendered.issues.join(" ")}`,
        );
      addSheet(rendered.svg);
      if (i % 50 === 0) {
        status.textContent = `Checking badge ${i + 1} of ${people.length}…`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    if (spareCount) {
      const rendered = renderSpareAttendeeBadge(
        workspace.settings,
        font,
        false,
      );
      if (rendered.issues.length)
        errors.push(`Spare attendee badges: ${rendered.issues.join(" ")}`);
      for (let i = 0; i < spareCount; i++)
        addSheet(rendered.svg.cloneNode(true) as SVGSVGElement, true);
    }
    renderList();
    if (errors.length) {
      status.textContent = `${errors.length} badges need attention. See the notes beside each badge below. ${errors.slice(0, 3).join(" | ")}`;
      return;
    }
    const size = workspace.settings.diameter + 2 * workspace.settings.bleed;
    pageStyle.textContent = `@media print{@page{size:${size}mm ${size}mm;margin:0}.badge-print-sheet{width:${size}mm;height:${size}mm}}`;
    status.textContent = `${total} badges passed layout and duplicate checks. ${sheets.length} PDF pages at ${size} × ${size} mm.${spareCount ? ` Includes ${spareCount} spare attendee badges.` : ""}${dirty ? " Save to keep these edits." : ""}`;
    if (print) {
      append(printRoot, ...sheets);
      await document.fonts.ready;
      const logo = new Image();
      logo.src = "/assets/logo.svg";
      await logo.decode();
      printRoot.setAttribute("data-ready", "true");
      window.print();
    }
  }
  const output = el("section", "", "grid gap-3 border border-ink p-5");
  append(
    output,
    el("h2", "Check & print", "font-headline text-2xl uppercase"),
    button(
      "Check all included badges",
      () => void work(() => check("all", false)),
    ),
  );
  for (const role of [
    "all",
    "attendee",
    "speaker",
    "organizer",
    "sponsor",
    "spares",
  ] as const)
    append(
      output,
      button(
        `Print / save PDF — ${role}`,
        () => void work(() => check(role, true)),
      ),
    );
  async function savePreferences() {
    if (!loaded) throw new Error("Load the saved workspace before saving.");
    const result = await api<{ revision: number }>(
      "/api/admin/badges",
      "manage-badges",
      "PUT",
      { revision, preferences: preferences() },
    );
    revision = result.revision;
    await load();
    status.textContent = "Print settings and badge text saved.";
  }
  const save = button("Save print settings", () => void work(savePreferences));
  async function load() {
    const result = await api<BadgeStudioData>("/api/admin/badges", "");
    sourcePeople = result.people;
    signatures = result.signatures;
    const saved = parsePrintPreferences(result.preferences);
    spareAttendeeBadges = saved.spareAttendeeBadges;
    retiredLegacyIds = saved.retiredLegacyIds;
    workspace = parseWorkspace({
      people: applyPrintPreferences(sourcePeople, saved, signatures),
      settings: saved.settings,
    });
    legacyWorkspace = result.legacyWorkspace;
    revision = result.revision;
    loaded = true;
    dirty = false;
    if (!requestedSparesApplied && requestedSpares !== undefined) {
      if (requestedSpares > spareAttendeeBadges) {
        spareAttendeeBadges = requestedSpares;
        dirty = true;
      }
      requestedSparesApplied = true;
      const url = new URL(location.href);
      url.searchParams.delete("spares");
      history.replaceState(null, "", url);
    }
    spareCount.input.value = String(spareAttendeeBadges);
    printRoot.removeAttribute("data-ready");
    printRoot.replaceChildren();
    legacyNotice.replaceChildren();
    if (legacyWorkspace) {
      append(
        legacyNotice,
        el(
          "p",
          `${result.legacyCount} earlier badge rows available · ${retiredLegacyIds.length} retired. Import their registration data in Attendees, or retire obsolete rows. The original list stays downloadable.`,
        ),
        button("Download earlier badge list", () => {
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(legacyWorkspace, null, 2)], {
              type: "application/json",
            }),
          );
          const link = el("a");
          link.href = url;
          link.download = "sdlcai-earlier-badge-list.json";
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
      );
      if (retiredLegacyIds.length)
        append(
          legacyNotice,
          button(
            "Restore retired earlier badges",
            () =>
              void work(async () => {
                const result = await api<{ revision: number }>(
                  "/api/admin/badges",
                  "manage-badges",
                  "PUT",
                  {
                    revision,
                    preferences: { ...preferences(), retiredLegacyIds: [] },
                  },
                );
                revision = result.revision;
                await load();
                status.textContent =
                  "Earlier badge retirement choices cleared. Current registration and team choices still apply.";
              }),
          ),
        );
    }
    renderSettings();
    renderList();
    showPreview();
    status.textContent = dirty
      ? `${spareAttendeeBadges} spare attendee badges prepared. Adjust the count and save print settings to keep it.`
      : "Badge studio ready. People are loaded from attendee and team records.";
  }
  append(
    toolbar,
    save,
    button("Reload people and settings", () => {
      if (!dirty || confirm("Discard unsaved print settings and badge text?"))
        void work(load);
    }),
  );
  append(controls, sources, spares, settingsPanel, output);
  append(stage, controls, proof);
  append(root, status, toolbar, stage, count, filter.label, list);
  window.addEventListener("afterprint", () => {
    printRoot.removeAttribute("data-ready");
    printRoot.replaceChildren();
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
  });
  void work(async () => {
    font = await loadBadgeFont();
    await load();
  });
}
