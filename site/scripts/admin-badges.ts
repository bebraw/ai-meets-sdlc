import { append } from "./admin-toolkit.ts";
import "./index.ts";
import { el, button, field, api, message } from "./admin-toolkit.ts";
import {
  defaultSettings,
  badgeCompany,
  parseWorkspace,
  parseCsv,
  importCsv,
  duplicateIds,
  type BadgePerson,
  type BadgeRole,
  type BadgeWorkspace,
  type CsvRecord,
} from "./badge-model.ts";
import { loadBadgeFont, renderBadge, type BadgeFont } from "./badge-layout.ts";
import type { Organizer } from "../../worker/organizers.ts";
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
  let font: BadgeFont | undefined;
  const layoutIssues = new Map<string, string[]>();
  let records: CsvRecord[] = [];
  let csvName = "CSV";
  let csvText = "";
  const status = el(
    "p",
    "Loading saved badges and print font…",
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
  append(
    proof,
    el("h2", "Print proof", "font-headline text-3xl uppercase"),
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
      "Unsaved changes. Save the list before leaving this page.";
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
  function showPreview() {
    const person =
      workspace.people.find((p) => p.id === selected) ?? workspace.people[0];
    preview.replaceChildren();
    if (!person || !font) return;
    selected = person.id;
    const result = renderBadge(person, workspace.settings, font);
    append(preview, result.svg);
    previewStatus.textContent = result.issues.length
      ? result.issues.join(" ")
      : `${person.name}: fits the safe area. Grey guides are preview only unless trim guide is enabled.`;
  }
  function renderList() {
    const duplicate = duplicateIds(workspace.people);
    const term = filter.input.value.toLocaleLowerCase();
    count.textContent = `${workspace.people.filter((p) => p.included).length} included / ${workspace.people.length} total · ${duplicate.size} unresolved duplicate rows`;
    const visible = workspace.people.filter((p) =>
      `${p.name} ${p.email} ${p.source}`.toLocaleLowerCase().includes(term),
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
        "Name (line breaks allowed)",
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
      const company = field("Company", person.company);
      company.input.maxLength = 300;
      const email = field(
        "Attendee email — never printed",
        person.email,
        "email",
      );
      email.input.maxLength = 254;
      const roleLabel = el(
        "label",
        "Badge type",
        "grid gap-2 text-sm font-bold",
      );
      const role = el("select", "", "border border-ink bg-paper p-2");
      for (const r of ["attendee", "speaker", "organizer"] as const) {
        const o = el("option", r);
        o.value = r;
        append(role, o);
      }
      role.value = person.role;
      append(roleLabel, role);
      const include = field("Include in print run", "", "checkbox");
      include.input.checked = person.included;
      include.input.className = "h-5 w-5";
      const edit = () => {
        person.name = name.value;
        person.company = badgeCompany(email.input.value, company.input.value);
        company.input.value = person.company;
        if (person.email !== email.input.value)
          person.duplicateReviewed = false;
        person.email = email.input.value;
        person.role = role.value as BadgeRole;
        person.included = include.input.checked;
        selected = person.id;
        invalidate();
        showPreview();
        count.textContent = `${workspace.people.filter((p) => p.included).length} included / ${workspace.people.length} total`;
      };
      [name, company.input, email.input, role, include.input].forEach((n) =>
        n.addEventListener("change", () => {
          edit();
        }),
      );
      append(
        main,
        nameLabel,
        company.label,
        email.label,
        el("p", person.source, "text-xs text-muted break-words"),
      );
      append(
        actions,
        include.label,
        roleLabel,
        button("Preview", () => {
          selected = person.id;
          showPreview();
          preview.scrollIntoView({ block: "center", behavior: "smooth" });
        }),
        button("Remove badge", () => {
          workspace.people = workspace.people.filter((p) => p.id !== person.id);
          invalidate();
          renderList();
          showPreview();
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
            "Matching email: exclude the extra badge, or explicitly keep both people.",
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
          "No matching badges. Import a CSV or add people from the site.",
        ),
      );
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
        showPreview();
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
        showPreview();
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
  const importPanel = el("section", "", "border border-ink p-5 grid gap-4");
  append(
    importPanel,
    el("h2", "01 / Import attendees", "font-headline text-2xl uppercase"),
    el(
      "p",
      "Import Tito and Webropol separately. Review mappings before appending rows. Map the attendee email, not the ticket purchaser’s address.",
      "text-sm leading-6",
    ),
  );
  const file = field("CSV file (UTF-8, up to 2 MB)", "", "file");
  file.input.accept = ".csv,text/csv";
  const delimiterLabel = el(
    "label",
    "Delimiter",
    "grid gap-2 text-sm font-bold",
  );
  const delimiter = el("select", "", "border border-ink bg-paper p-2");
  for (const [label, value] of [
    ["Comma", ","],
    ["Semicolon", ";"],
    ["Tab", "\t"],
  ]) {
    const o = el("option", label);
    o.value = value!;
    append(delimiter, o);
  }
  append(delimiterLabel, delimiter);
  const mapping = el("div", "", "grid gap-3 sm:grid-cols-2");
  const columns = new Map<string, HTMLSelectElement>();
  function mapCsv() {
    records = [];
    mapping.replaceChildren();
    columns.clear();
    if (!csvText) return;
    records = parseCsv(csvText, delimiter.value);
    const aliases: Record<string, string[]> = {
      name: ["name", "full name", "ticket full name", "nimi"],
      company: [
        "company",
        "company name",
        "ticket company name",
        "organisaatio",
        "yritys",
      ],
      email: [
        "email",
        "email address",
        "ticket email",
        "ticket email address",
        "sähköposti",
      ],
      first: ["first name", "ticket first name", "etunimi"],
      last: ["last name", "ticket last name", "sukunimi"],
    };
    for (const key of ["name", "company", "email", "first", "last"]) {
      const label = el(
        "label",
        key === "email" ? "Attendee email" : key === "name" ? "Full name" : key,
        "grid gap-2 text-sm font-bold",
      );
      const select = el("select", "", "min-w-0 border border-ink bg-paper p-2");
      const empty = el("option", "Not mapped");
      empty.value = "-1";
      append(select, empty);
      records[0]!.cells.forEach((header, index) => {
        const o = el("option", header || `Column ${index + 1}`);
        o.value = String(index);
        append(select, o);
      });
      const index = records[0]!.cells.findIndex((h) =>
        aliases[key]!.includes(h.trim().toLowerCase()),
      );
      select.value = String(index);
      columns.set(key, select);
      append(label, select);
      append(mapping, label);
    }
    status.textContent = `${records.length - 1} CSV rows read. Check column mappings before import.`;
  }
  file.input.addEventListener(
    "change",
    () =>
      void work(async () => {
        records = [];
        csvText = "";
        mapping.replaceChildren();
        columns.clear();
        const f = file.input.files?.[0];
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) throw new Error("CSV exceeds 2 MB.");
        csvName = f.name.slice(0, 150);
        csvText = new TextDecoder("utf-8", { fatal: true }).decode(
          await f.arrayBuffer(),
        );
        mapCsv();
      }),
  );
  delimiter.addEventListener("change", () => {
    try {
      mapCsv();
    } catch (error) {
      status.textContent = message(error);
    }
  });
  append(
    importPanel,
    file.label,
    delimiterLabel,
    mapping,
    button("Append CSV rows", () => {
      try {
        const get = (key: string) => Number(columns.get(key)?.value ?? -1);
        const people = importCsv(
          records,
          {
            name: get("name"),
            company: get("company"),
            email: get("email"),
            first: get("first"),
            last: get("last"),
          },
          csvName,
        );
        if (workspace.people.length + people.length > 2000)
          throw new Error("Maximum 2,000 badges per workspace.");
        workspace.people.push(...people);
        invalidate();
        renderList();
        showPreview();
        status.textContent = `${people.length} rows appended. Matching emails must be reviewed before printing.`;
      } catch (error) {
        status.textContent = message(error);
      }
    }),
  );
  async function source(kind: "speakers" | "organizers" | "volunteers") {
    let people: BadgePerson[] = [];
    const make = (
      id: string,
      name: string,
      company: string,
      email: string,
      role: BadgeRole,
    ): BadgePerson => ({
      id: `${kind}:${id}`,
      name,
      company: badgeCompany(email, company),
      email,
      role,
      source: kind,
      included: true,
      duplicateReviewed: false,
    });
    if (kind === "organizers") {
      const data = await api<{ organizers: Organizer[] }>(
        "/api/admin/organizers",
        "",
      );
      people = data.organizers
        .filter((p) => p.badge)
        .map((p) => make(p.id, p.name, p.company, "", "organizer"));
    }
    if (kind === "volunteers") {
      const data = await api<{
        volunteers: { id: string; name: string; email: string }[];
      }>("/api/admin/volunteers", "");
      people = data.volunteers.map((p) =>
        make(p.id, p.name, "", p.email, "organizer"),
      );
    }
    if (kind === "speakers") {
      const data = await api<{
        speakers: {
          speaker_id: string;
          workspace_only: boolean;
          canonical: { profile: { name: string; company?: string } };
          contact: { email?: string } | null;
        }[];
      }>("/api/admin/speakers", "");
      people = data.speakers
        .filter((p) => !p.workspace_only)
        .map((p) =>
          make(
            p.speaker_id,
            p.canonical.profile.name,
            p.canonical.profile.company ?? "",
            p.contact?.email ?? "",
            "speaker",
          ),
        );
    }
    const existing = new Map(workspace.people.map((p) => [p.id, p]));
    const refreshed = [
      ...workspace.people.filter((p) => !p.id.startsWith(`${kind}:`)),
      ...people.map((p) => ({
        ...p,
        included: existing.get(p.id)?.included ?? true,
      })),
    ];
    if (refreshed.length > 2000)
      throw new Error("Maximum 2,000 badges per workspace.");
    workspace.people = refreshed;
    invalidate();
    renderList();
    showPreview();
    status.textContent = `${kind} refreshed. Badge text now matches the source; people no longer selected there were removed.`;
  }
  const sources = el("section", "", "grid gap-3 border border-ink p-5");
  append(
    sources,
    el("h2", "02 / Add the team", "font-headline text-2xl uppercase"),
    el(
      "p",
      "Refresh replaces badge text for that source. Organizers include only people marked as attending. Volunteers use orange organizer badges; exclude anyone who will not attend.",
      "text-sm leading-6",
    ),
  );
  for (const kind of ["speakers", "organizers", "volunteers"] as const)
    append(
      sources,
      button(`Refresh ${kind}`, () => {
        if (
          workspace.people.some((p) => p.id.startsWith(`${kind}:`)) &&
          !confirm(`Replace badge edits from ${kind} with current source data?`)
        )
          return;
        void work(() => source(kind));
      }),
    );
  append(
    sources,
    button("Add a manual badge", () => {
      if (workspace.people.length >= 2000) {
        status.textContent = "Maximum 2,000 badges per workspace.";
        return;
      }
      workspace.people.push({
        id: crypto.randomUUID(),
        name: "",
        company: "",
        email: "",
        role: "attendee",
        source: "Manual",
        included: true,
        duplicateReviewed: false,
      });
      selected = workspace.people.at(-1)!.id;
      invalidate();
      renderList();
      showPreview();
    }),
  );
  async function check(role: BadgeRole | "all", print: boolean) {
    printRoot.removeAttribute("data-ready");
    printRoot.replaceChildren();
    if (!font) throw new Error("The badge font has not loaded.");
    const people = workspace.people.filter(
      (p) => p.included && (role === "all" || p.role === role),
    );
    if (!people.length)
      throw new Error("No badges selected for this print run.");
    const duplicates = duplicateIds(workspace.people);
    layoutIssues.clear();
    const errors: string[] = [];
    const sheets: HTMLElement[] = [];
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
      const sheet = el("section", "", "badge-print-sheet");
      append(sheet, rendered.svg);
      sheets.push(sheet);
      if (workspace.settings.doubleSided)
        sheets.push(sheet.cloneNode(true) as HTMLElement);
      if (i % 50 === 0) {
        status.textContent = `Checking badge ${i + 1} of ${people.length}…`;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    renderList();
    if (errors.length) {
      status.textContent = `${errors.length} badges need attention. See the notes beside each badge below. ${errors.slice(0, 3).join(" | ")}`;
      return;
    }
    const size = workspace.settings.diameter + 2 * workspace.settings.bleed;
    pageStyle.textContent = `@media print{@page{size:${size}mm ${size}mm;margin:0}.badge-print-sheet{width:${size}mm;height:${size}mm}}`;
    status.textContent = `${people.length} badges passed layout and duplicate checks. ${sheets.length} PDF pages at ${size} × ${size} mm.${dirty ? " Save to keep these edits." : ""}`;
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
    el("h2", "03 / Preflight & print", "font-headline text-2xl uppercase"),
    button(
      "Check all included badges",
      () => void work(() => check("all", false)),
    ),
  );
  for (const role of ["all", "attendee", "speaker", "organizer"] as const)
    append(
      output,
      button(
        `Print / save PDF — ${role}`,
        () => void work(() => check(role, true)),
      ),
    );
  const save = button(
    "Save badge list",
    () =>
      void work(async () => {
        if (!loaded) throw new Error("Load the saved workspace before saving.");
        const result = await api<{ revision: number }>(
          "/api/admin/badges",
          "manage-badges",
          "PUT",
          { revision, workspace },
        );
        revision = result.revision;
        dirty = false;
        status.textContent = "Badge list and printer settings saved.";
      }),
  );
  function download() {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = "sdlcai-badge-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function load() {
    const result = await api<{ revision: number; workspace: BadgeWorkspace }>(
      "/api/admin/badges",
      "",
    );
    workspace = parseWorkspace(result.workspace);
    revision = result.revision;
    loaded = true;
    dirty = false;
    printRoot.removeAttribute("data-ready");
    renderSettings();
    renderList();
    showPreview();
    status.textContent = "Saved badge list loaded.";
  }
  const restore = field("Restore a downloaded draft", "", "file");
  restore.input.accept = ".json";
  restore.input.addEventListener(
    "change",
    () =>
      void work(async () => {
        const f = restore.input.files?.[0];
        if (!f) return;
        if (f.size > 1800 * 1024) throw new Error("Draft is too large.");
        const data = parseWorkspace(JSON.parse(await f.text()));
        if (!confirm("Replace this tab’s badge list with the draft?")) return;
        workspace = data;
        invalidate();
        renderSettings();
        renderList();
        showPreview();
      }),
  );
  append(
    toolbar,
    save,
    button("Reload saved list", () => {
      if (!dirty || confirm("Discard unsaved badge edits?")) void work(load);
    }),
    button("Download draft backup", download),
  );
  append(controls, importPanel, sources, settingsPanel, output, restore.label);
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
