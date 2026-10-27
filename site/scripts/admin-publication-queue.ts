import "./index.ts";
import "./admin-navigation.ts";
import { append, button, el, message } from "./admin-toolkit.ts";
import {
  publicationChannels,
  publicationStatuses,
  type PublicationItem,
} from "./publication-model.ts";

type Edit = Pick<
  PublicationItem,
  | "id"
  | "revision"
  | "title"
  | "subtitle"
  | "summary"
  | "body"
  | "altText"
  | "notes"
  | "status"
  | "publicationDate"
  | "publicationUrl"
  | "graphicFormat"
>;
const endpoint = "/api/admin/publication-queue";
const controlClass =
  "h-11 min-h-11 min-w-0 w-full border border-ink bg-paper px-3 py-2 font-normal text-ink";
class QueueConflict extends Error {
  constructor(
    message: string,
    readonly current: PublicationItem | null,
  ) {
    super(message);
  }
}
async function request<T>(body?: Edit): Promise<T> {
  const response = await fetch(endpoint, {
    method: body ? "PUT" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-admin-action": "manage-publications",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401)
    throw new Error(
      "Your admin session expired. Sign in again; copy or download your edits first.",
    );
  const data = (await response.json()) as T & {
    error?: string;
    current?: PublicationItem | null;
  };
  if (response.status === 409)
    throw new QueueConflict(
      data.error ?? "A newer saved version is available.",
      data.current ?? null,
    );
  if (!response.ok)
    throw new Error(
      data.error ?? "Unable to save the draft. Your edits are still here.",
    );
  return data;
}
function editable(item: PublicationItem): Edit {
  const {
    id,
    revision,
    title,
    subtitle,
    summary,
    body,
    altText,
    notes,
    status,
    publicationDate,
    publicationUrl,
    graphicFormat,
  } = item;
  return {
    id,
    revision,
    title,
    subtitle,
    summary,
    body,
    altText,
    notes,
    status,
    publicationDate,
    publicationUrl,
    graphicFormat,
  };
}
function externalLink(label: string, url: string) {
  const link = el(
    "a",
    label,
    "inline-flex min-h-11 items-center break-words font-bold underline underline-offset-4",
  );
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error("Invalid publication resource URL.");
  link.href = resourceUrl(parsed.href);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
function resourceUrl(value: string): string {
  const url = new URL(value);
  return url.origin === "https://sdlcai.org"
    ? `${url.pathname}${url.search}${url.hash}`
    : url.href;
}
function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const root = document.querySelector<HTMLElement>("[data-publication-queue]");
if (root) {
  const notice = el("p", "Loading the prepared drafts…", "mb-6 leading-7");
  notice.setAttribute("role", "status");
  notice.dataset.publicationNotice = "";
  const layout = el(
    "div",
    "",
    "grid min-w-0 gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10",
  );
  const sidebar = el("aside", "", "min-w-0");
  sidebar.setAttribute("aria-label", "Publication drafts");
  const editor = el("div", "", "min-w-0");
  editor.dataset.publicationEditor = "";
  const list = el(
    "div",
    "",
    "mt-5 grid max-h-[36rem] gap-3 overflow-y-auto pr-1",
  );
  const channelFilter = el("select", "", controlClass);
  channelFilter.id = "publication-channel-filter";
  const statusFilter = el("select", "", controlClass);
  statusFilter.id = "publication-status-filter";
  const channelLabel = el("label", "Channel", "grid gap-2 text-sm font-bold");
  channelLabel.htmlFor = channelFilter.id;
  const statusLabel = el(
    "label",
    "Review status",
    "mt-4 grid gap-2 text-sm font-bold",
  );
  statusLabel.htmlFor = statusFilter.id;
  const option = (value: string, label: string) => {
    const node = el("option", label);
    node.value = value;
    return node;
  };
  append(
    channelFilter,
    option("all", "All channels"),
    ...Object.entries(publicationChannels).map(([value, label]) =>
      option(value, label),
    ),
  );
  append(
    statusFilter,
    option("all", "All statuses"),
    ...publicationStatuses.map((status) => option(status.value, status.label)),
  );
  append(
    sidebar,
    el("h2", "The queue", "mb-5 font-headline text-3xl font-black uppercase"),
    channelLabel,
    channelFilter,
    statusLabel,
    statusFilter,
    list,
  );
  append(layout, sidebar, editor);
  root.replaceChildren(notice, layout);
  let items: PublicationItem[] = [],
    active: PublicationItem | null = null;
  let dirty = false,
    busy = false,
    conflicted = false;
  let form: HTMLFormElement | null = null;
  let save: HTMLButtonElement | null = null;
  let saveState: HTMLParagraphElement | null = null;
  let fields = new Map<
    string,
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >();
  let count: HTMLParagraphElement | null = null;
  let preview: HTMLImageElement | null = null;
  function readEdit(): Edit {
    if (!active) throw new Error("Choose a draft first.");
    const values = editable(active);
    for (const key of [
      "title",
      "subtitle",
      "summary",
      "body",
      "altText",
      "notes",
      "publicationDate",
      "publicationUrl",
    ] as const)
      values[key] = fields.get(key)?.value ?? values[key];
    values.status = fields.get("status")!.value as Edit["status"];
    values.graphicFormat =
      (fields.get("graphicFormat")?.value as Edit["graphicFormat"]) ??
      active.graphicFormat;
    return values;
  }
  function announce(text: string) {
    notice.textContent = text;
  }
  function checkDirty() {
    if (!active || !form) return;
    dirty = JSON.stringify(readEdit()) !== JSON.stringify(editable(active));
    if (save) save.disabled = busy || !dirty || conflicted;
    if (saveState)
      saveState.textContent = busy
        ? "Saving…"
        : dirty
          ? "Unsaved changes"
          : active.updatedAt
            ? `Saved ${new Date(active.updatedAt).toLocaleString("en-GB", { timeZone: "Europe/Helsinki" })} (Helsinki)`
            : "Original prepared draft";
    if (count)
      count.textContent = `${fields.get("body")!.value.length.toLocaleString()} characters`;
    const status = fields.get("status")!.value;
    fields.get("publicationDate")!.required = [
      "scheduled",
      "published",
    ].includes(status);
    fields.get("publicationUrl")!.required =
      status === "published" && active.channel !== "newsletter";
    const asset = active.assets.find(
      (asset) => asset.format === fields.get("graphicFormat")?.value,
    );
    if (preview && asset) {
      preview.src = resourceUrl(asset.url);
      preview.width = asset.width;
      preview.height = asset.height;
      preview.alt = fields.get("altText")!.value;
    }
  }
  function renderList() {
    list.replaceChildren();
    const shown = items.filter(
      (item) =>
        (channelFilter.value === "all" ||
          channelFilter.value === item.channel) &&
        (statusFilter.value === "all" || statusFilter.value === item.status),
    );
    const tally = el(
      "p",
      `${shown.length} of ${items.length} drafts`,
      "text-sm text-muted",
    );
    append(list, tally);
    for (const item of shown) {
      const entry = button("", () => select(item));
      entry.className = `grid min-w-0 gap-2 border border-ink p-4 text-left transition hover:bg-ink hover:text-paper ${active?.id === item.id ? "bg-ink text-paper" : "bg-paper text-ink"}`;
      entry.disabled = busy;
      entry.dataset.publicationItem = item.id;
      entry.setAttribute("aria-pressed", String(active?.id === item.id));
      append(
        entry,
        el(
          "span",
          `${String(item.position).padStart(2, "0")} / ${publicationChannels[item.channel]}`,
          "text-xs font-bold uppercase",
        ),
        el("span", item.title, "break-words font-bold leading-6"),
        el(
          "span",
          publicationStatuses.find((status) => status.value === item.status)!
            .label,
          "text-sm",
        ),
      );
      if (item.publicationDate)
        append(entry, el("span", item.publicationDate, "text-xs"));
      append(list, entry);
    }
    if (!shown.length)
      append(
        list,
        el("p", "No drafts match these filters.", "leading-7 text-muted"),
      );
  }
  function select(item: PublicationItem) {
    if (
      busy ||
      (dirty && !confirm("Discard your unsaved edits and open this draft?"))
    )
      return;
    active = item;
    dirty = false;
    conflicted = false;
    history.replaceState(null, "", `#${item.id}`);
    renderList();
    renderEditor();
  }
  function addField(
    parent: HTMLElement,
    key: string,
    label: string,
    value: string,
    multiline = false,
    type = "text",
  ) {
    const wrapper = el("div", "", "grid min-w-0 gap-2");
    const labelNode = el("label", label, "text-sm font-bold");
    labelNode.htmlFor = `publication-${key}`;
    const input = multiline
      ? el(
          "textarea",
          "",
          "min-w-0 w-full resize-y border border-ink bg-paper px-3 py-3 font-normal leading-7 text-ink",
        )
      : el("input", "", controlClass);
    input.id = labelNode.htmlFor;
    input.name = key;
    input.value = value;
    if (input instanceof HTMLInputElement) input.type = type;
    if (input instanceof HTMLTextAreaElement)
      input.rows = key === "body" ? 16 : 4;
    input.maxLength =
      key === "body"
        ? 20000
        : key === "notes"
          ? 4000
          : key === "altText"
            ? 2000
            : key === "title"
              ? 300
              : key === "publicationUrl"
                ? 2048
                : 1200;
    input.required = ["title", "body"].includes(key);
    fields.set(key, input);
    append(wrapper, labelNode, input);
    append(parent, wrapper);
    return wrapper;
  }
  async function copyBody() {
    const body = readEdit().body;
    try {
      await navigator.clipboard.writeText(body);
      announce("Draft copy copied.");
    } catch {
      const input = fields.get("body") as HTMLTextAreaElement;
      input.focus();
      input.select();
      announce(
        "Copy access is unavailable. The draft text is selected; use your browser’s Copy command.",
      );
    }
  }
  function download() {
    if (!active) return;
    const draft = readEdit();
    saveFile(
      `sdlcai-2026-${active.id}.txt`,
      `${publicationChannels[active.channel]} / SDLCAI 2026\n\n${draft.title}\n${draft.subtitle ? `\n${draft.subtitle}\n` : ""}${draft.summary ? `\nSUMMARY\n${draft.summary}\n` : ""}\n${draft.body}\n${draft.altText ? `\nIMAGE ALT TEXT\n${draft.altText}\n` : ""}\nSTATUS: ${draft.status}\nPUBLICATION DATE: ${draft.publicationDate}\nPUBLICATION URL: ${draft.publicationUrl}\n${active.assets.length ? `\nGRAPHICS\n${active.assets.map((asset) => `${asset.format}: ${asset.url}`).join("\n")}\n` : ""}${active.sources.length ? `\nSOURCES\n${active.sources.map((source) => `${source.label}: ${source.url}`).join("\n")}\n` : ""}${draft.notes ? `\nEDITORIAL NOTES\n${draft.notes}\n` : ""}`,
    );
  }
  function renderEditor() {
    editor.replaceChildren();
    fields = new Map();
    preview = null;
    count = null;
    if (!active) return;
    append(
      editor,
      el(
        "p",
        `SDLCAI 2026 / ${publicationChannels[active.channel]} / ${String(active.position).padStart(2, "0")}`,
        "text-sm font-bold uppercase text-muted",
      ),
    );
    const heading = el(
      "h2",
      active.title,
      "mt-3 break-words font-headline text-3xl font-black uppercase leading-tight md:text-4xl",
    );
    append(editor, heading);
    form = el("form", "", "mt-7 grid min-w-0 gap-6");
    form.dataset.publicationForm = "";
    const editableFields = el("fieldset", "", "grid min-w-0 gap-6");
    editableFields.dataset.publicationFields = "";
    const legend = el("legend", "Draft copy", "sr-only");
    append(editableFields, legend);
    addField(
      editableFields,
      "title",
      active.channel === "newsletter"
        ? "Email subject"
        : active.channel === "linkedin"
          ? "Working title"
          : "Announcement title",
      active.title,
    );
    const subtitle = addField(
      editableFields,
      "subtitle",
      active.channel === "newsletter" ? "Email preheader" : "Subtitle",
      active.subtitle,
    );
    subtitle.hidden = active.channel === "linkedin";
    const summary = addField(
      editableFields,
      "summary",
      "Listing summary",
      active.summary,
      true,
    );
    summary.hidden = active.channel !== "website";
    addField(
      editableFields,
      "body",
      active.channel === "linkedin" ? "Post copy" : "Body (Markdown)",
      active.body,
      true,
    );
    count = el("p", "", "-mt-4 text-sm text-muted");
    append(editableFields, count);
    const copyControls = el("div", "", "flex flex-wrap gap-3");
    append(
      copyControls,
      button("Copy draft text", () => void copyBody()),
      button("Download draft", download),
    );
    append(editableFields, copyControls);
    if (active.assets.length) {
      const graphics = el(
        "section",
        "",
        "grid min-w-0 gap-5 border-y border-ink py-6",
      );
      append(
        graphics,
        el(
          "h3",
          "Graphics and alt text",
          "font-headline text-2xl font-black uppercase",
        ),
      );
      const formatLabel = el(
        "label",
        "Graphic format",
        "grid gap-2 text-sm font-bold",
      );
      formatLabel.htmlFor = "publication-graphicFormat";
      const format = el("select", "", controlClass);
      format.id = formatLabel.htmlFor;
      format.name = "graphicFormat";
      append(
        format,
        option("portrait", "Portrait · 1080 x 1350"),
        option("landscape", "Landscape · 1200 x 630"),
      );
      format.value = active.graphicFormat;
      fields.set("graphicFormat", format);
      preview = el("img", "", "h-auto w-full max-w-sm border border-ink");
      preview.loading = "lazy";
      preview.decoding = "async";
      preview.dataset.publicationGraphic = "";
      append(graphics, formatLabel, format, preview);
      const downloads = el("div", "", "flex flex-wrap gap-4");
      for (const asset of active.assets) {
        const link = externalLink(`Download ${asset.format} PNG`, asset.url);
        link.download = "";
        link.dataset.publicationGraphicDownload = asset.format;
        append(downloads, link);
      }
      append(graphics, downloads);
      addField(graphics, "altText", "Image alt text", active.altText, true);
      append(editableFields, graphics);
    } else {
      const alt = addField(
        editableFields,
        "altText",
        "Image alt text",
        active.altText,
        true,
      );
      alt.hidden = true;
    }
    const tracking = el(
      "section",
      "",
      "grid min-w-0 gap-5 border-t border-ink pt-6",
    );
    append(
      tracking,
      el(
        "h3",
        "Review and publication",
        "font-headline text-2xl font-black uppercase",
      ),
    );
    const statusWrapper = el("label", "Status", "grid gap-2 text-sm font-bold");
    statusWrapper.htmlFor = "publication-status";
    const status = el("select", "", controlClass);
    status.id = statusWrapper.htmlFor;
    status.name = "status";
    append(
      status,
      ...publicationStatuses.map((status) =>
        option(status.value, status.label),
      ),
    );
    status.value = active.status;
    fields.set("status", status);
    append(tracking, statusWrapper, status);
    addField(
      tracking,
      "publicationDate",
      "Publication date",
      active.publicationDate,
      false,
      "date",
    );
    append(
      tracking,
      el(
        "p",
        "For scheduled posts, use the date arranged in your publishing tool.",
        "-mt-3 text-sm leading-6 text-muted",
      ),
    );
    addField(
      tracking,
      "publicationUrl",
      active.channel === "newsletter"
        ? "Campaign or public archive URL (optional)"
        : "Published post URL",
      active.publicationUrl,
      false,
      "url",
    );
    if (active.publicationUrl)
      append(
        tracking,
        externalLink("Open recorded publication", active.publicationUrl),
      );
    addField(tracking, "notes", "Editorial notes", active.notes, true);
    append(editableFields, tracking);
    append(form, editableFields);
    const conflict = el("div", "", "grid gap-4 border border-ink p-5");
    conflict.hidden = true;
    conflict.dataset.publicationConflict = "";
    conflict.setAttribute("role", "alert");
    append(form, conflict);
    save = button("Save changes", () => form?.requestSubmit());
    save.dataset.publicationSave = "";
    saveState = el("p", "", "text-sm leading-6 text-muted");
    saveState.setAttribute("role", "status");
    const controls = el(
      "div",
      "",
      "flex flex-wrap items-center gap-4 border-t border-ink pt-6",
    );
    append(controls, save, saveState);
    append(form, controls);
    if (active.sources.length) {
      const sources = el("details", "", "border-t border-ink pt-4");
      append(
        sources,
        el(
          "summary",
          "Source passages",
          "min-h-11 cursor-pointer py-2 font-bold",
        ),
      );
      const links = el("ul", "", "mt-3 grid gap-2");
      for (const source of active.sources) {
        const li = el("li");
        append(li, externalLink(source.label, source.url));
        append(links, li);
      }
      append(sources, links);
      append(form, sources);
    }
    form.addEventListener("input", checkDirty);
    form.addEventListener("change", checkDirty);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void persist(editableFields, conflict);
    });
    append(editor, form);
    checkDirty();
  }
  async function persist(
    fieldset: HTMLFieldSetElement,
    conflict: HTMLDivElement,
  ) {
    if (busy || !dirty || conflicted) return;
    const draft = readEdit();
    busy = true;
    fieldset.disabled = true;
    checkDirty();
    renderList();
    conflict.hidden = true;
    try {
      const { item } = await request<{ item: PublicationItem }>(draft);
      items = items.map((row) => (row.id === item.id ? item : row));
      active = item;
      dirty = false;
      announce(
        "Saved. The draft and publication details are available across devices.",
      );
      renderEditor();
    } catch (error) {
      if (error instanceof QueueConflict) {
        conflicted = true;
        conflict.hidden = false;
        conflict.replaceChildren(el("p", error.message, "leading-7"));
        if (error.current) {
          const current = error.current;
          const details = el("details");
          const comparison = el("dl", "", "mt-4 grid gap-4");
          const savedFields: Array<[string, string]> = [
            [
              current.channel === "newsletter" ? "Email subject" : "Title",
              current.title,
            ],
            [
              current.channel === "newsletter" ? "Email preheader" : "Subtitle",
              current.subtitle,
            ],
            ["Listing summary", current.summary],
            ["Draft copy", current.body],
            ["Image alt text", current.altText],
            ["Editorial notes", current.notes],
            [
              "Status",
              publicationStatuses.find(
                (status) => status.value === current.status,
              )!.label,
            ],
            ["Publication date", current.publicationDate],
            ["Publication URL", current.publicationUrl],
          ];
          if (current.assets.length)
            savedFields.push([
              "Graphic format",
              current.graphicFormat === "portrait" ? "Portrait" : "Landscape",
            ]);
          for (const [label, value] of savedFields) {
            if (!value) continue;
            const row = el("div", "", "min-w-0");
            append(
              row,
              el("dt", label, "text-sm font-bold"),
              el(
                "dd",
                value,
                "mt-1 whitespace-pre-wrap break-words text-sm leading-6",
              ),
            );
            append(comparison, row);
          }
          append(
            details,
            el(
              "summary",
              "Compare the saved version",
              "min-h-11 cursor-pointer py-2 font-bold",
            ),
            comparison,
          );
          append(
            conflict,
            details,
            button("Load saved version", () => {
              if (
                confirm(
                  "Replace your unsaved edits with the saved version? Copy or download your version first if you need it.",
                )
              ) {
                items = items.map((item) =>
                  item.id === current.id ? current : item,
                );
                active = current;
                dirty = false;
                conflicted = false;
                renderEditor();
                renderList();
              }
            }),
          );
        }
      } else {
        conflict.hidden = false;
        conflict.replaceChildren(el("p", message(error), "leading-7"));
      }
      announce("The draft was not saved. Your edits are still in the editor.");
    } finally {
      busy = false;
      fieldset.disabled = false;
      renderList();
      checkDirty();
    }
  }
  channelFilter.addEventListener("change", renderList);
  statusFilter.addEventListener("change", renderList);
  window.addEventListener("hashchange", () => {
    const target = items.find((item) => item.id === location.hash.slice(1));
    if (!target || target.id === active?.id) return;
    select(target);
    if (active && active.id !== target.id)
      history.replaceState(null, "", `#${active.id}`);
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  void request<{ eventId: string; items: PublicationItem[] }>()
    .then((data) => {
      items = data.items;
      const counts = Object.entries(publicationChannels)
        .map(
          ([channel, label]) =>
            `${items.filter((item) => item.channel === channel).length} ${label}`,
        )
        .join(" · ");
      announce(`${items.length} prepared drafts · ${counts}`);
      const selected =
        items.find((item) => item.id === location.hash.slice(1)) ?? items[0];
      if (selected) select(selected);
      else renderList();
    })
    .catch((error) => {
      announce(message(error));
      append(
        editor,
        button("Retry loading queue", () => location.reload()),
      );
    });
}
