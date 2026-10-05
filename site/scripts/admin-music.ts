import "./index.ts";
import music from "../data/music.json" with { type: "json" };
import {
  formatMusicDuration,
  musicHandoff,
  restoreMusicSelection,
} from "./music-selection.ts";

const root = document.querySelector<HTMLElement>("[data-admin-music]");
if (root) setup(root);

function setup(root: HTMLElement): void {
  const storageKey = "sdlcai-2026-music-shortlist";
  const tracks = music.tracks;
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const picks = root.querySelectorAll<HTMLInputElement>("[data-music-pick]");
  const shortlist = root.querySelector<HTMLOListElement>(
    "[data-music-shortlist]",
  )!;
  const summary = root.querySelector<HTMLElement>("[data-music-summary]")!;
  const storage = root.querySelector<HTMLElement>("[data-music-storage]")!;
  const empty = root.querySelector<HTMLElement>("[data-music-empty]")!;
  const status = root.querySelector<HTMLElement>("[data-music-status]")!;
  const starter = root.querySelector<HTMLButtonElement>(
    "[data-music-starter]",
  )!;
  const clear = root.querySelector<HTMLButtonElement>("[data-music-clear]")!;
  const copy = root.querySelector<HTMLButtonElement>("[data-music-copy]")!;
  const download = root.querySelector<HTMLButtonElement>(
    "[data-music-download]",
  )!;
  const fallback = root.querySelector<HTMLElement>(
    "[data-music-copy-fallback]",
  )!;
  const handoff = root.querySelector<HTMLTextAreaElement>(
    "[data-music-handoff]",
  )!;
  const filter = root.querySelector(
    "[data-music-filter]",
  ) as unknown as HTMLSelectElement;
  const visible = root.querySelector<HTMLElement>("[data-music-visible]")!;
  let selected: string[] = [];

  try {
    selected = restoreMusicSelection(localStorage.getItem(storageKey), tracks);
  } catch {
    storage.textContent =
      "Browser storage is unavailable. Download your list to keep it.";
  }

  function selectedTracks() {
    return selected.flatMap((id) => {
      const track = tracksById.get(id);
      return track ? [track] : [];
    });
  }

  function save(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(selected));
      storage.textContent = "Saved automatically in this browser.";
    } catch {
      storage.textContent =
        "Your selection could not be saved. Download your list to keep it.";
    }
    status.textContent = "";
    render();
  }

  function render(): void {
    const chosen = selectedTracks();
    const total = chosen.reduce((seconds, track) => seconds + track.seconds, 0);
    summary.textContent = `${chosen.length} ${chosen.length === 1 ? "track" : "tracks"} / ${formatMusicDuration(total)}`;
    empty.hidden = chosen.length > 0;
    for (const action of [copy, download, clear])
      action.disabled = !chosen.length;
    starter.disabled = tracks
      .filter((track) => track.starter)
      .every((track) => selected.includes(track.id));
    handoff.value = musicHandoff(chosen);
    for (const pick of picks) pick.checked = selected.includes(pick.value);
    shortlist.replaceChildren();
    chosen.forEach((track, index) => {
      const item = document.createElement("li");
      item.className = "border-t border-ink/20 pt-4";
      const title = document.createElement("p");
      title.className = "break-words font-bold leading-6";
      title.textContent = `${index + 1}. ${track.title}`;
      const detail = document.createElement("p");
      detail.className = "mt-1 text-sm leading-6 text-muted";
      detail.textContent = `${track.artist} / ${formatMusicDuration(track.seconds)}`;
      const links = document.createElement("div");
      links.className = "mt-1 flex flex-wrap gap-x-4 gap-y-1";
      for (const [service, url] of [
        ["YouTube Music", track.youtubeMusicUrl],
        ["Spotify", track.spotifyUrl],
      ] as const) {
        const link = document.createElement("a");
        link.className =
          "inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4";
        link.textContent = service;
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute(
          "aria-label",
          `Listen to ${track.title} by ${track.artist} on ${service} (opens in a new tab)`,
        );
        links.appendChild(link);
      }
      const actions = document.createElement("div");
      actions.className = "mt-2 flex flex-wrap gap-2";
      for (const [direction, label] of [
        [-1, "Up"],
        [1, "Down"],
      ] as const) {
        const move = button(
          label,
          `Move ${track.title} ${label.toLowerCase()}`,
        );
        move.dataset.musicMove = `${track.id}:${direction}`;
        move.disabled =
          index + direction < 0 || index + direction >= chosen.length;
        move.addEventListener("click", () => {
          const targetIndex = index + direction;
          const other = selected[targetIndex];
          if (!other) return;
          selected[targetIndex] = track.id;
          selected[index] = other;
          save();
          const moved = shortlist.querySelector<HTMLButtonElement>(
            `[data-music-move="${track.id}:${direction}"]`,
          );
          if (moved?.disabled)
            shortlist
              .querySelector<HTMLButtonElement>(
                `[data-music-remove="${track.id}"]`,
              )
              ?.focus();
          else moved?.focus();
          status.textContent = `Moved ${track.title} to position ${targetIndex + 1}.`;
        });
        actions.appendChild(move);
      }
      const remove = button("Remove", `Remove ${track.title} from shortlist`);
      remove.dataset.musicRemove = track.id;
      remove.addEventListener("click", () => {
        selected = selected.filter((id) => id !== track.id);
        save();
        const nextId = selected[index] ?? selected[index - 1];
        if (nextId)
          shortlist
            .querySelector<HTMLButtonElement>(`[data-music-remove="${nextId}"]`)
            ?.focus();
        else starter.focus();
        status.textContent = `Removed ${track.title}.`;
      });
      actions.appendChild(remove);
      item.appendChild(title);
      item.appendChild(detail);
      item.appendChild(links);
      item.appendChild(actions);
      shortlist.appendChild(item);
    });
  }

  function filterTracks(): void {
    let count = 0;
    root.querySelectorAll<HTMLElement>("[data-music-track]").forEach((card) => {
      card.hidden =
        filter.value !== "all" && card.dataset.musicGroup !== filter.value;
      if (!card.hidden) count++;
    });
    visible.textContent = `${count} of ${tracks.length} proposals`;
  }

  for (const pick of picks) {
    pick.disabled = false;
    pick.addEventListener("change", () => {
      selected = pick.checked
        ? [...selected, pick.value]
        : selected.filter((id) => id !== pick.value);
      save();
    });
  }
  starter.addEventListener("click", () => {
    selected = [
      ...new Set([
        ...selected,
        ...tracks.filter((track) => track.starter).map((track) => track.id),
      ]),
    ];
    save();
    status.textContent =
      "Calm starter tracks added. Your existing choices are kept.";
  });
  clear.addEventListener("click", () => {
    selected = [];
    fallback.hidden = true;
    save();
    starter.focus();
    status.textContent = "Selection cleared.";
  });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(musicHandoff(selectedTracks()));
      fallback.hidden = true;
      status.textContent = "Venue list copied.";
    } catch {
      fallback.hidden = false;
      handoff.focus();
      handoff.select();
      status.textContent =
        "Copy the selected text below, or download the list.";
    }
  });
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([musicHandoff(selectedTracks())], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "sdlcai-2026-break-music.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "Venue list downloaded.";
  });
  filter.addEventListener("change", filterTracks);
  root.querySelector<HTMLElement>("[data-music-filter-controls]")!.hidden =
    false;
  render();
  filterTracks();
}

function button(text: string, label: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.className =
    "min-h-11 border border-ink/40 px-3 py-2 text-xs font-bold uppercase transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-40";
  result.textContent = text;
  result.setAttribute("aria-label", label);
  return result;
}
