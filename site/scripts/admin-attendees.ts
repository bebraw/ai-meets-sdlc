import "./index.ts";
import {
  append,
  button,
  buttonClass,
  el,
  field,
  message,
} from "./admin-toolkit.ts";
import type { CsvRecord } from "./badge-model.ts";
import {
  attendeeColumnAliases,
  detectAttendeeMapping,
  importAttendeeCsv,
  mergeAttendeeImport,
  prepareAttendeeCsv,
  type Attendee,
  type AttendeeInput,
  type AttendeeList,
  type AttendeeMapping,
  type AttendeeType,
  type RegistrationGrant,
} from "./attendee-model.ts";
import { createAttendeeCateringPanel } from "./attendee-catering.ts";

const action = "manage-attendees";
async function api<T>(
  url: string,
  action: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-admin-action": action },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    if (
      response.status === 401 &&
      location.pathname === "/registration/" &&
      url !== "/api/registration/session"
    ) {
      root?.replaceChildren();
      location.replace("/registration/access/");
    }
    throw new Error(result.error ?? "Unable to save. Reload and try again.");
  }
  return result;
}
const accessRoot = document.querySelector<HTMLElement>(
  "[data-registration-access]",
);
if (accessRoot) setupAccess(accessRoot);
const root = document.querySelector<HTMLElement>(
  "[data-admin-attendees], [data-registration-list]",
);
if (root) setupList(root);

function selectField(label: string, options: [string, string][]) {
  const node = el("label", label, "grid gap-2 text-sm font-bold");
  const input = el(
    "select",
    "",
    "min-w-0 w-full border border-ink bg-paper px-3 py-2 font-normal",
  );
  input.setAttribute("aria-label", label);
  for (const [text, value] of options) {
    const option = el("option", text);
    option.value = value;
    append(input, option);
  }
  append(node, input);
  return { label: node, input };
}
function setupAccess(root: HTMLElement) {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("token") ?? "";
  // Tokens never enter a request URL or remain in browser history.
  if (location.hash) history.replaceState(null, "", location.pathname);
  const status = el("p", "", "mb-4 font-bold");
  status.setAttribute("role", "status");
  const form = el("form", "", "grid gap-4 border border-ink p-5");
  const input = field("Staff access token", token, "password");
  input.input.required = true;
  input.input.maxLength = 43;
  input.input.autocomplete = "off";
  window.addEventListener("hashchange", () => {
    input.input.value =
      new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
    if (location.hash) history.replaceState(null, "", location.pathname);
    status.textContent = "";
  });
  const submit = el("button", "Open registration desk", buttonClass);
  submit.type = "submit";
  append(form, input.label, submit);
  append(root, status, form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void api("/api/registration/session", action, "POST", {
      token: input.input.value.trim(),
    })
      .then(() => location.assign("/registration/"))
      .catch((error: unknown) => {
        status.textContent = message(error);
        submit.disabled = false;
      });
  });
}
function setupList(root: HTMLElement) {
  const admin = root.hasAttribute("data-admin-attendees");
  const endpoint = admin
    ? "/api/admin/attendees"
    : "/api/registration/attendees";
  let data: AttendeeList = {
    revision: 0,
    attendees: [],
    role: admin ? "admin" : "registration",
  };
  let loaded = false;
  let busy = false;
  const drafts = new Map<
    string,
    { form: HTMLFormElement; revision: number; original: string }
  >();
  let signOut: HTMLButtonElement | undefined;
  const catering = admin ? createAttendeeCateringPanel() : undefined;
  const status = el(
    "p",
    "Loading registrations…",
    "border border-ink p-4 font-bold break-words",
  );
  status.setAttribute("role", "status");
  const toolbar = el("div", "", "my-5 flex flex-wrap gap-3");
  const counts = el("p", "", "my-5 font-headline text-xl font-black uppercase");
  const search = field("Find an attendee", "", "search");
  search.input.placeholder = "Name, email, or ticket code";
  const lookup = selectField("Search by", [
    ["Name or email", "person"],
    ["Exact ticket code", "ticket"],
  ]);
  const state = selectField("Show registrations", [
    ["All registrations", "all"],
    ["Not arrived", "waiting"],
    ["Arrived", "arrived"],
    ["Cancelled", "cancelled"],
  ]);
  const attendeeType = selectField("Registration type", [
    ["All types", "all"],
    ["Attendee", "attendee"],
    ["Sponsor", "sponsor"],
  ]);
  const filters = el(
    "div",
    "",
    "my-5 grid gap-4 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]",
  );
  append(filters, search.label, lookup.label, state.label, attendeeType.label);
  const list = el("div", "", "grid gap-3");
  const results = el("p", "", "my-3 text-sm font-bold");
  results.setAttribute("role", "status");
  const reload = button(
    "Reload registrations",
    () =>
      void work(async () => {
        await load();
        status.textContent = "Registrations updated.";
      }),
  );
  append(toolbar, reload);
  if (admin) {
    const badges = el("a", "Open badge studio →", buttonClass);
    badges.href = "/admin/badges/";
    append(
      toolbar,
      badges,
      button("Download attendee list", () => {
        if (!loaded) return;
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(data, null, 2)], {
            type: "application/json",
          }),
        );
        const link = el("a");
        link.href = url;
        link.download = "sdlcai-attendees.json";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }),
    );
  } else {
    signOut = button(
      "Sign out",
      () =>
        void work(async () => {
          await api("/api/registration/session", action, "DELETE");
          location.assign("/registration/access/");
        }),
    );
    append(toolbar, signOut);
  }
  append(root, status, toolbar);
  if (admin) {
    const panels = el("div", "", "my-8 grid gap-6 lg:grid-cols-2");
    append(panels, importPanel(), accessPanel());
    append(root, panels);
    if (catering) append(root, catering.panel);
  }
  append(root, counts, filters, results, list);
  for (const input of [
    search.input,
    lookup.input,
    state.input,
    attendeeType.input,
  ])
    input.addEventListener("input", render);
  async function work(task: () => Promise<void>) {
    if (busy) return;
    busy = true;
    lock(true);
    try {
      await task();
    } catch (error) {
      status.textContent = message(error);
    } finally {
      busy = false;
      lock(false);
    }
  }
  function lock(value: boolean) {
    root.querySelectorAll("input,button,select,textarea").forEach((input) => {
      if (
        input instanceof HTMLInputElement ||
        input instanceof HTMLButtonElement ||
        input instanceof HTMLSelectElement ||
        input instanceof HTMLTextAreaElement
      )
        input.disabled = value || !loaded;
    });
    reload.disabled = value;
    if (signOut) signOut.disabled = value;
  }
  function editSource(person: Attendee): string {
    return JSON.stringify([
      person.source,
      person.sourceKey,
      person.name,
      person.company,
      person.email,
      person.ticketCode,
      person.status,
      person.badge,
      person.type,
      person.diet,
    ]);
  }
  async function load() {
    const next = await api<AttendeeList>(endpoint, action);
    const changed = !loaded || JSON.stringify(next) !== JSON.stringify(data);
    for (const person of next.attendees) {
      const draft = drafts.get(person.id);
      // Only advance a draft past unrelated writes; changed attendee details
      // must still fail the server's revision check rather than be overwritten.
      if (draft && draft.original === editSource(person))
        draft.revision = next.revision;
    }
    data = next;
    loaded = true;
    if (changed) render();
  }
  function render() {
    catering?.render(data.attendees);
    counts.textContent = `${data.attendees.filter((p) => p.arrivedAt).length} arrived / ${data.attendees.filter((p) => p.status === "active").length} active · ${data.attendees.length} total`;
    const term = search.input.value.trim().toLowerCase();
    const visible = data.attendees.filter((p) => {
      const matches =
        lookup.input.value === "ticket"
          ? Boolean(term && p.ticketCode.toLowerCase() === term)
          : `${p.name} ${p.email} ${p.ticketCode}`.toLowerCase().includes(term);
      return (
        matches &&
        (attendeeType.input.value === "all" ||
          p.type === attendeeType.input.value) &&
        (state.input.value === "all" ||
          (state.input.value === "waiting" &&
            p.status === "active" &&
            !p.arrivedAt) ||
          (state.input.value === "arrived" && p.arrivedAt) ||
          (state.input.value === "cancelled" && p.status === "cancelled"))
      );
    });
    results.textContent =
      lookup.input.value === "ticket" && !term
        ? "Enter the complete ticket code, or paste it from a scanner."
        : `${visible.length} matching registration${visible.length === 1 ? "" : "s"}${lookup.input.value === "ticket" && visible.length > 1 ? ". Multiple matches: verify the attendee and registration source." : "."}`;
    const displayed = visible.slice(0, 100);
    const displayedIds = new Set(displayed.map((person) => person.id));
    const hiddenEdits = [...drafts.keys()].filter(
      (id) => !displayedIds.has(id),
    ).length;
    if (hiddenEdits)
      results.textContent += ` ${hiddenEdits} unfinished edit${hiddenEdits === 1 ? " is" : "s are"} hidden. Adjust the filters to continue editing.`;
    list.replaceChildren();
    for (const person of displayed) {
      const card = el(
        "article",
        "",
        "grid min-w-0 gap-4 border border-ink p-4 md:grid-cols-[1fr_auto]",
      );
      card.dataset.attendeeId = person.id;
      const draft = drafts.get(person.id);
      if (draft) {
        append(card, draft.form);
        append(list, card);
        continue;
      }
      const details = el("div", "", "min-w-0 break-words");
      append(
        details,
        el("h2", person.name, "font-headline text-2xl font-black"),
        el(
          "p",
          [person.company, person.email].filter(Boolean).join(" · "),
          "mt-1 text-sm",
        ),
        el(
          "p",
          `${person.type.toUpperCase()} · ${person.source.toUpperCase()} · ${person.ticketCode ? `Ticket ${person.ticketCode}` : "No ticket code"}`,
          "mt-2 text-sm font-bold",
        ),
      );
      if (admin)
        append(
          details,
          el(
            "p",
            `Diet: ${person.diet || "No answer / not imported"}`,
            "mt-2 whitespace-pre-wrap text-sm leading-6",
          ),
        );
      const attendance = person.arrivedAt
        ? `Arrived ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(person.arrivedAt))} · ${person.arrivedBy ?? "Staff"}`
        : "Not arrived";
      append(
        details,
        el(
          "p",
          `${person.status === "cancelled" ? "CANCELLED · " : ""}${attendance}`,
          "mt-3 font-bold",
        ),
      );
      const controls = el(
        "div",
        "",
        "flex flex-wrap items-start gap-2 md:max-w-64",
      );
      if (person.status === "active" && !person.arrivedAt)
        append(
          controls,
          button("Mark arrived", () => void arrive(person, "arrived")),
        );
      if (admin) {
        if (person.arrivedAt)
          append(
            controls,
            button("Undo arrival", () => void arrive(person, "undo")),
          );
        append(
          controls,
          button("Edit attendee", () => edit(card, person)),
        );
      }
      append(card, details, controls);
      append(list, card);
    }
    if (visible.length > 100)
      append(
        list,
        el(
          "p",
          "Showing the first 100 matches. Narrow your search to find an attendee.",
          "p-4 font-bold",
        ),
      );
    if (!visible.length)
      append(
        list,
        el(
          "p",
          data.attendees.length
            ? "No registration found. Check the spelling or ask an organizer to verify the ticket."
            : "No registrations imported yet.",
          "border border-ink p-5",
        ),
      );
    lock(busy);
  }
  async function arrive(person: Attendee, command: "arrived" | "undo") {
    await work(async () => {
      try {
        await api("/api/registration/arrival", action, "POST", {
          id: person.id,
          revision: person.arrivalRevision,
          rosterRevision: data.revision,
          action: command,
        });
      } catch (error) {
        await load();
        throw error;
      }
      await load();
      status.textContent =
        command === "arrived"
          ? `${person.name} marked as arrived.`
          : `Arrival undone for ${person.name}.`;
    });
  }
  function edit(card: HTMLElement, person: Attendee) {
    const form = el("form", "", "grid gap-3 md:col-span-2");
    const draft = {
      form,
      revision: data.revision,
      original: editSource(person),
    };
    const dietLabel = el("label", "", "grid gap-2 text-sm font-bold");
    const dietInput = el(
      "textarea",
      "",
      "w-full border border-ink bg-paper p-3 font-normal leading-6",
    );
    dietInput.value = person.diet ?? "";
    dietInput.rows = 3;
    append(
      dietLabel,
      el("span", "Dietary requirements (original response)"),
      dietInput,
    );
    const fields = {
      name: field("Name", person.name),
      company: field("Company", person.company),
      email: field("Attendee email", person.email, "email"),
      ticketCode: field("Ticket code", person.ticketCode),
      diet: { label: dietLabel, input: dietInput },
    };
    fields.name.input.required = true;
    for (const [key, value] of Object.entries(fields)) {
      value.input.maxLength =
        key === "diet"
          ? 2000
          : key === "email"
            ? 254
            : key === "ticketCode"
              ? 100
              : 300;
      append(form, value.label);
    }
    const ticketState = selectField("Ticket status", [
      ["Active", "active"],
      ["Cancelled", "cancelled"],
    ]);
    ticketState.input.value = person.status;
    const type = selectField("Attendee type", [
      ["Attendee", "attendee"],
      ["Sponsor", "sponsor"],
    ]);
    type.input.value = person.type;
    const badge = field("Include in badge run", "", "checkbox");
    badge.input.checked = person.badge;
    badge.input.className = "h-5 w-5";
    const save = el("button", "Save attendee", buttonClass);
    save.type = "submit";
    append(
      form,
      ticketState.label,
      type.label,
      badge.label,
      save,
      button("Cancel editing", () => {
        drafts.delete(person.id);
        render();
      }),
    );
    drafts.set(person.id, draft);
    card.replaceChildren(form);
    fields.name.input.focus();
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void work(async () => {
        await api(endpoint, action, "PUT", {
          id: person.id,
          revision: draft.revision,
          attendee: {
            name: fields.name.input.value,
            company: fields.company.input.value,
            email: fields.email.input.value,
            ticketCode: fields.ticketCode.input.value,
            status: ticketState.input.value,
            badge: badge.input.checked,
            type: type.input.value,
            diet: fields.diet.input.value,
          },
        });
        drafts.delete(person.id);
        render();
        await load();
        status.textContent = "Attendee saved.";
      });
    });
  }
  function importPanel() {
    const panel = el(
      "section",
      "",
      "grid content-start gap-4 border border-ink p-5",
    );
    append(
      panel,
      el("h2", "01 / Import attendees", "font-headline text-2xl uppercase"),
      el(
        "p",
        "Import Tito and Webropol separately. Choose Sponsor for a separate Tito sponsor export. Map the attendee email, individual ticket code, and dietary response. Refreshes preserve arrivals and badge choices; missing rows stay in the list. An unmapped diet column keeps earlier dietary responses.",
        "text-sm leading-6",
      ),
    );
    const file = field("CSV file (UTF-8, up to 2 MB)", "", "file");
    file.input.accept = ".csv,text/csv";
    const source = selectField("Registration source", [
      ["Tito", "tito"],
      ["Webropol", "webropol"],
    ]);
    const type = selectField("Import attendee type", [
      ["Keep existing types; new rows are attendees", ""],
      ["Attendee", "attendee"],
      ["Sponsor", "sponsor"],
    ]);
    const delimiter = selectField("Delimiter", [
      ["Detect automatically", "auto"],
      ["Comma", ","],
      ["Semicolon", ";"],
      ["Tab", "\t"],
    ]);
    const mappingRoot = el("div", "", "grid gap-3 sm:grid-cols-2");
    const preview = el("div", "", "grid gap-2 text-sm break-words");
    const formatNote = el("p", "", "text-sm leading-6 text-muted");
    const columns = new Map<keyof AttendeeMapping, HTMLSelectElement>();
    let csv = "";
    let records: CsvRecord[] = [];
    const labels: Record<keyof AttendeeMapping, string> = {
      name: "Full name",
      company: "Company",
      email: "Attendee email",
      first: "First name",
      last: "Last name",
      ticketCode: "Ticket code",
      status: "Ticket status",
      diet: "Dietary requirements column",
    };
    function parseFile() {
      records = [];
      columns.clear();
      mappingRoot.replaceChildren();
      preview.replaceChildren();
      formatNote.textContent = "";
      if (!csv) return;
      const prepared = prepareAttendeeCsv(csv, delimiter.input.value);
      records = prepared.records;
      const detected = detectAttendeeMapping(records[0]!.cells);
      formatNote.textContent = `Detected ${prepared.delimiter === ";" ? "semicolon" : prepared.delimiter === "\t" ? "tab" : "comma"} delimiter.${prepared.ignoredRows ? ` Skipped ${prepared.ignoredRows} introductory/header rows; column labels use CSV line ${records[0]!.row}.` : ""} Review the detected columns below.`;
      for (const key of Object.keys(
        attendeeColumnAliases,
      ) as (keyof AttendeeMapping)[]) {
        const select = selectField(labels[key], [
          [
            key === "status"
              ? "No status column — all imported tickets active"
              : "Not mapped",
            "-1",
          ],
          ...records[0]!.cells.map((label, i): [string, string] => [
            label,
            String(i),
          ]),
        ]);
        select.input.value = String(detected[key]);
        columns.set(key, select.input);
        append(mappingRoot, select.label);
      }
    }
    function rows(): AttendeeInput[] {
      const mapping: AttendeeMapping = {
        name: -1,
        company: -1,
        email: -1,
        first: -1,
        last: -1,
        ticketCode: -1,
        status: -1,
        diet: -1,
      };
      for (const [key, input] of columns) mapping[key] = Number(input.value);
      const imported = importAttendeeCsv(
        records,
        mapping,
        type.input.value ? (type.input.value as AttendeeType) : undefined,
      );
      mergeAttendeeImport(
        data.attendees,
        source.input.value as "tito" | "webropol",
        imported,
      );
      return imported;
    }
    file.input.addEventListener(
      "change",
      () =>
        void work(async () => {
          csv = "";
          parseFile();
          const selected = file.input.files?.[0];
          if (!selected) return;
          if (/webropol/iu.test(selected.name)) source.input.value = "webropol";
          else if (/tito/iu.test(selected.name)) source.input.value = "tito";
          if (selected.size > 2 * 1024 * 1024)
            throw new Error("CSV must be under 2 MB.");
          try {
            csv = new TextDecoder("utf-8", { fatal: true }).decode(
              await selected.arrayBuffer(),
            );
          } catch {
            throw new Error(
              "CSV is not valid UTF-8. Export or save it as UTF-8 and try again.",
            );
          }
          parseFile();
          status.textContent =
            "CSV loaded. Review column mappings and preview before importing.";
        }),
    );
    delimiter.input.addEventListener("change", () => {
      try {
        parseFile();
      } catch (error) {
        status.textContent = message(error);
      }
    });
    const previewRows = button("Preview import", () => {
      try {
        const imported = rows();
        preview.replaceChildren(
          el(
            "p",
            `${imported.length} registrations · ${imported.filter((p) => p.status === "cancelled").length} cancelled`,
            "font-bold",
          ),
        );
        for (const person of imported.slice(0, 5))
          append(
            preview,
            el(
              "p",
              `${person.name} · ${person.email} · ${person.ticketCode || "No ticket code"} · ${person.type ?? "Keep existing type / new attendee"} · ${person.status} · Diet: ${person.diet ?? "Not mapped"}`,
            ),
          );
      } catch (error) {
        status.textContent = message(error);
      }
    });
    const importRows = button(
      "Import registrations",
      () =>
        void work(async () => {
          const imported = rows();
          await api(endpoint, action, "POST", {
            revision: data.revision,
            source: source.input.value,
            attendees: imported,
          });
          await load();
          status.textContent = `${imported.length} registrations imported. Existing arrival records preserved.`;
        }),
    );
    append(
      panel,
      file.label,
      source.label,
      type.label,
      delimiter.label,
      formatNote,
      mappingRoot,
      el(
        "p",
        "Without ticket codes, matching uses attendee email within the selected source. Filter cancelled or refunded tickets out first if your CSV has no status column.",
        "text-sm leading-6",
      ),
      previewRows,
      preview,
      importRows,
    );
    return panel;
  }
  function accessPanel() {
    const panel = el(
      "section",
      "",
      "grid content-start gap-4 border border-ink p-5",
    );
    append(
      panel,
      el("h2", "02 / Registration staff", "font-headline text-2xl uppercase"),
      el(
        "p",
        "Create one named link for each person at the desk. They can look up registrations and mark arrivals. Links work until revoked; signing in lasts 14 days.",
        "text-sm leading-6",
      ),
    );
    const name = field("Staff name");
    name.input.maxLength = 100;
    const grantsRoot = el("div", "", "grid gap-3");
    function show(grants: RegistrationGrant[]) {
      grantsRoot.replaceChildren();
      for (const grant of grants) {
        const card = el(
          "div",
          "",
          "grid min-w-0 gap-2 border border-ink p-3 break-words",
        );
        append(
          card,
          el(
            "h3",
            `${grant.label}${grant.revoked_at ? " · Revoked" : ""}`,
            "font-bold",
          ),
        );
        if (grant.link) {
          const link = field("Private staff link", grant.link);
          link.input.readOnly = true;
          link.input.addEventListener("focus", () => link.input.select());
          append(
            card,
            link.label,
            button(
              "Copy link",
              () =>
                void work(async () => {
                  await navigator.clipboard.writeText(grant.link!);
                  status.textContent = "Staff link copied.";
                }),
            ),
            button(
              "Revoke access",
              () =>
                void work(async () => {
                  const result = await api<{ grants: RegistrationGrant[] }>(
                    "/api/admin/attendees/access",
                    action,
                    "POST",
                    { action: "revoke", id: grant.id },
                  );
                  show(result.grants);
                  status.textContent = `Access revoked for ${grant.label} on every device.`;
                }),
            ),
          );
        }
        append(grantsRoot, card);
      }
      lock(busy);
    }
    append(
      panel,
      name.label,
      button(
        "Create staff link",
        () =>
          void work(async () => {
            const result = await api<{ grants: RegistrationGrant[] }>(
              "/api/admin/attendees/access",
              action,
              "POST",
              { action: "create", label: name.input.value },
            );
            show(result.grants);
            name.input.value = "";
            status.textContent = "Staff access link created.";
          }),
      ),
      grantsRoot,
    );
    void api<{ grants: RegistrationGrant[] }>(
      "/api/admin/attendees/access",
      action,
    )
      .then((result) => show(result.grants))
      .catch((error: unknown) => {
        status.textContent = message(error);
      });
    return panel;
  }
  void work(async () => {
    await load();
    status.textContent =
      "Registrations loaded. Changes and arrivals are saved immediately.";
  });
  setInterval(() => {
    if (busy || drafts.size || document.hidden || !loaded) return;
    void work(async () => {
      await load();
    });
  }, 15000);
  window.addEventListener("beforeunload", (event) => {
    if (!drafts.size) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
