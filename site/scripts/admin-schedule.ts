import "./index.ts";
import type { ScheduleGroup } from "../../worker/schedule-order.ts";

interface ScheduleData {
  revision: number;
  groups: ScheduleGroup[];
  sessions: { id: string; title: string; time: string }[];
  talks: { id: string; title: string; speakers: string }[];
}

const root = document.querySelector<HTMLElement>("[data-admin-schedule]");
if (root) initialize(root);

function initialize(root: HTMLElement): void {
  const board = root.querySelector<HTMLElement>("[data-schedule-board]")!;
  const status = root.querySelector<HTMLElement>("[data-schedule-status]")!;
  const save = root.querySelector<HTMLButtonElement>("[data-schedule-save]")!;
  const reload = root.querySelector<HTMLButtonElement>(
    "[data-schedule-reload]",
  )!;
  let data: ScheduleData | undefined;
  let draft: ScheduleGroup[] = [];
  let published = "";
  let busy = false;
  let conflict = false;
  let dragged: string | null = null;
  const dirty = () => Boolean(data && JSON.stringify(draft) !== published);

  function controls(): void {
    save.disabled = busy || !dirty() || conflict;
    reload.disabled = busy;
    board.querySelectorAll<HTMLElement>("button, select").forEach((control) => {
      (control as HTMLButtonElement | HTMLSelectElement).disabled =
        busy || control.dataset.boundary === "true";
    });
    board.querySelectorAll<HTMLElement>("[data-draft-talk]").forEach((card) => {
      card.draggable = !busy;
    });
  }
  function clearDrop(): void {
    board
      .querySelectorAll<HTMLElement>("[data-drop-target]")
      .forEach((element) => {
        element.removeAttribute("data-drop-target");
        element.classList.remove("ring-2", "ring-signal", "bg-signal/10");
      });
  }
  function move(id: string, sessionId: string, before?: string): void {
    if (busy || id === before) return;
    const old = draft.find((group) => group.talkIds.includes(id));
    const target = draft.find((group) => group.id === sessionId);
    if (!old || !target) return;
    old.talkIds = old.talkIds.filter((item) => item !== id);
    const index = before ? target.talkIds.indexOf(before) : -1;
    target.talkIds.splice(index < 0 ? target.talkIds.length : index, 0, id);
    render();
    status.textContent = conflict
      ? "Published schedule changed. Reload before saving this draft."
      : dirty()
        ? "Unsaved changes"
        : "Matches the published schedule";
    board
      .querySelector<HTMLButtonElement>(`[data-draft-talk="${id}"] button`)
      ?.focus();
  }
  function render(): void {
    if (!data) return;
    board.replaceChildren();
    for (const group of draft) {
      const session = data.sessions.find((item) => item.id === group.id)!;
      const section = el("section", "min-w-0 border border-ink");
      const header = el(
        "div",
        "grid gap-2 border-b border-ink bg-ink p-5 text-paper",
      );
      header.appendChild(el("p", "text-sm font-bold uppercase", session.time));
      header.appendChild(
        el("h2", "font-headline text-3xl font-black uppercase", session.title),
      );
      header.appendChild(
        el(
          "p",
          "text-sm",
          `${group.talkIds.length} talk${group.talkIds.length === 1 ? "" : "s"}`,
        ),
      );
      section.appendChild(header);
      const zone = el("div", "grid min-h-24 gap-3 p-4");
      zone.dataset.dropSession = group.id;
      zone.setAttribute("aria-label", session.title);
      zone.addEventListener("dragover", (event) => {
        if (!dragged || busy) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        clearDrop();
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-draft-talk]")
            : null;
        const highlight = target ?? zone;
        highlight.dataset.dropTarget = "true";
        highlight.classList.add("ring-2", "ring-signal", "bg-signal/10");
      });
      zone.addEventListener("drop", (event) => {
        event.preventDefault();
        clearDrop();
        if (!dragged || busy) return;
        const target =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-draft-talk]")
            : null;
        let before = target?.dataset.draftTalk;
        if (
          target &&
          event.clientY >
            target.getBoundingClientRect().top +
              target.getBoundingClientRect().height / 2
        ) {
          before = group.talkIds[group.talkIds.indexOf(before!) + 1];
        }
        const id = dragged;
        dragged = null;
        move(id, group.id, before);
      });
      if (!group.talkIds.length)
        zone.appendChild(el("p", "p-3 text-sm text-muted", "Drop a talk here"));
      for (const [index, id] of group.talkIds.entries()) {
        const talk = data.talks.find((item) => item.id === id)!;
        const card = el(
          "article",
          "grid min-w-0 gap-3 border border-ink bg-paper p-4",
        );
        card.dataset.draftTalk = id;
        card.draggable = true;
        card.addEventListener("dragstart", (event) => {
          if (busy) {
            event.preventDefault();
            return;
          }
          dragged = id;
          event.dataTransfer?.setData("text/plain", id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          card.classList.add("opacity-50");
        });
        card.addEventListener("dragend", () => {
          dragged = null;
          card.classList.remove("opacity-50");
          clearDrop();
        });
        const top = el("div", "flex items-start justify-between gap-3");
        top.appendChild(
          el("p", "min-w-0 break-words font-bold", talk.speakers),
        );
        top.appendChild(
          el(
            "span",
            "shrink-0 cursor-grab text-xs font-bold uppercase text-muted",
            `${index + 1} / Drag`,
          ),
        );
        card.appendChild(top);
        card.appendChild(el("h3", "break-words text-lg leading-6", talk.title));
        const actions = el("div", "flex flex-wrap gap-2");
        const up = button("Up", `Move ${talk.speakers} up`);
        up.dataset.boundary = String(index === 0);
        up.addEventListener("click", () =>
          move(id, group.id, group.talkIds[index - 1]),
        );
        const down = button("Down", `Move ${talk.speakers} down`);
        down.dataset.boundary = String(index === group.talkIds.length - 1);
        down.addEventListener("click", () =>
          move(id, group.id, group.talkIds[index + 2]),
        );
        actions.appendChild(up);
        actions.appendChild(down);
        const select = el(
          "select",
          "min-w-0 max-w-full flex-1 border border-ink bg-paper px-3 py-3 text-sm",
        );
        select.setAttribute("aria-label", `Session for ${talk.speakers}`);
        for (const item of data.sessions) {
          const option = el("option", "", item.title);
          option.value = item.id;
          option.selected = item.id === group.id;
          select.appendChild(option);
        }
        select.addEventListener("change", () => move(id, select.value));
        actions.appendChild(select);
        card.appendChild(actions);
        zone.appendChild(card);
      }
      section.appendChild(zone);
      board.appendChild(section);
    }
    controls();
  }
  async function load(): Promise<void> {
    busy = true;
    controls();
    board.setAttribute("aria-busy", "true");
    try {
      data = await api();
      draft = structuredClone(data.groups);
      published = JSON.stringify(draft);
      conflict = false;
      render();
      status.textContent = "Published schedule loaded";
    } catch (error) {
      status.textContent = message(error);
    } finally {
      busy = false;
      controls();
      board.setAttribute("aria-busy", "false");
    }
  }
  reload.addEventListener("click", () => {
    if (
      busy ||
      (dirty() &&
        !confirm("Discard unsaved changes and reload the published schedule?"))
    )
      return;
    void load();
  });
  save.addEventListener("click", async () => {
    if (busy || !data || !dirty() || conflict) return;
    busy = true;
    controls();
    status.textContent = "Saving schedule…";
    try {
      const saved = await api(
        new URLSearchParams({
          revision: String(data.revision),
          groups: JSON.stringify(draft),
        }),
      );
      data.revision = saved.revision;
      published = JSON.stringify(draft);
      status.textContent = "Schedule saved and published";
    } catch (error) {
      if (error instanceof ScheduleConflict) conflict = true;
      status.textContent = message(error);
    } finally {
      busy = false;
      controls();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  void load();
}

class ScheduleConflict extends Error {}
async function api(body?: URLSearchParams): Promise<ScheduleData> {
  const response = await fetch("/api/admin/schedule", {
    method: body ? "PUT" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-admin-action": "save-schedule-order" },
    ...(body ? { body } : {}),
  });
  if (response.status === 401)
    throw new Error(
      "Your admin session expired. Sign in again; your unsaved draft is still here.",
    );
  const result = (await response.json()) as ScheduleData & { error?: string };
  if (!response.ok)
    throw new (response.status === 409 ? ScheduleConflict : Error)(
      result.error || "Unable to load or save the schedule. Please try again.",
    );
  return result;
}
function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to reach the server. Your draft has not been saved.";
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}
function button(text: string, label: string): HTMLButtonElement {
  const node = el(
    "button",
    "border border-ink px-3 py-3 text-sm font-bold uppercase disabled:opacity-40",
    text,
  );
  node.type = "button";
  node.setAttribute("aria-label", label);
  return node;
}
