import "./index.ts";

const root = document.querySelector<HTMLElement>("[data-content-inventory]");
if (root) setup(root);

function setup(root: HTMLElement): void {
  const get = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const cards = [
    ...root.querySelectorAll<HTMLElement>("[data-inventory-item]"),
  ];
  const byId = new Map(cards.map((card) => [card.id, card]));
  const picks = [
    ...root.querySelectorAll<HTMLInputElement>("[data-inventory-pick]"),
  ];
  const filters = get<HTMLFormElement>("[data-inventory-filters]");
  const search = get<HTMLInputElement>("[data-inventory-search]");
  const select = (selector: string) => {
    const element = root.querySelector(selector);
    if (!(element instanceof HTMLSelectElement))
      throw new Error(`Missing inventory filter: ${selector}`);
    return element;
  };
  const kind = select("[data-inventory-kind]");
  const state = select("[data-inventory-state]");
  const person = select("[data-inventory-person]");
  const visible = get<HTMLElement>("[data-inventory-visible]");
  const notice = get<HTMLElement>("[data-inventory-notice]");
  const storage = get<HTMLElement>("[data-inventory-storage]");
  const selectedList = get<HTMLOListElement>("[data-inventory-shortlist]");
  const selectedCount = get<HTMLElement>("[data-inventory-selected]");
  const copy = get<HTMLButtonElement>("[data-inventory-copy]");
  const download = get<HTMLButtonElement>("[data-inventory-download]");
  const clear = get<HTMLButtonElement>("[data-inventory-clear]");
  const fallback = get<HTMLElement>("[data-inventory-fallback]");
  const handoff = get<HTMLTextAreaElement>("#inventory-handoff");
  const storageKey = "sdlcai-2026-content-shortlist";
  let selected = new Set<string>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(saved))
      selected = new Set(
        saved.filter(
          (id): id is string => typeof id === "string" && byId.has(id),
        ),
      );
  } catch {
    storage.textContent =
      "Browser storage is unavailable. Download a copy to keep your shortlist.";
  }
  const normalize = (text: string) =>
    text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const searchIndex = new Map(
    cards.map((card) => [card.id, normalize(card.textContent ?? "")]),
  );
  function filter(): void {
    const query = normalize(search.value.trim());
    let count = 0;
    for (const card of cards) {
      const show =
        (kind.value === "all" || card.dataset.kind === kind.value) &&
        (state.value === "all" || card.dataset.state === state.value) &&
        (person.value === "all" ||
          card.dataset.people?.split("|").includes(person.value)) &&
        (!query || searchIndex.get(card.id)?.includes(query));
      card.hidden = !show;
      if (show) count++;
    }
    visible.textContent = `Showing ${count} of ${cards.length} items`;
    get<HTMLElement>("[data-inventory-empty]").hidden = count > 0;
  }
  function render(): void {
    for (const pick of picks) pick.checked = selected.has(pick.value);
    selectedCount.textContent = `${selected.size} selected`;
    for (const button of [copy, download, clear])
      button.disabled = !selected.size;
    selectedList.replaceChildren();
    for (const id of selected) {
      const li = document.createElement("li");
      li.textContent =
        byId.get(id)?.querySelector("[data-item-title]")?.textContent ?? id;
      selectedList.appendChild(li);
    }
    fallback.hidden = true;
  }
  function save(): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...selected]));
    } catch {
      storage.textContent =
        "Your shortlist could not be saved in this browser. Download a copy to keep it.";
    }
    notice.textContent = "";
    render();
  }
  function text(): string {
    return [
      "SDLCAI 2026 editorial shortlist",
      "Audience: senior engineers and software delivery leaders, with research context.",
      "Selections are working notes. Review excerpts and edit positioning before publication.",
      ...[...selected].map((id, index) => {
        const card = byId.get(id)!;
        const content = [
          "[data-item-title]",
          "[data-item-context]",
          "[data-item-summary]",
        ].map(
          (selector) => card.querySelector(selector)?.textContent?.trim() ?? "",
        );
        const links = [
          ...card.querySelectorAll<HTMLAnchorElement>("[data-item-links] a"),
        ].map((link) => `${link.textContent?.trim()}: ${link.href}`);
        const notes = [
          ...card.querySelectorAll<HTMLElement>("[data-item-notes] li"),
        ].map((note) => note.textContent?.trim() ?? "");
        return `${index + 1}. ${content.join("\n")}\n${links.join("\n")}\n${notes.join("\n")}`;
      }),
    ].join("\n\n");
  }
  filters.hidden = false;
  get<HTMLElement>("[data-inventory-actions]").hidden = false;
  filters.addEventListener("submit", (event) => event.preventDefault());
  filters.addEventListener("input", filter);
  filters.addEventListener("change", filter);
  filters.addEventListener("reset", (event) => {
    event.preventDefault();
    search.value = "";
    kind.value = state.value = person.value = "all";
    filter();
  });
  for (const pick of picks) {
    pick.disabled = false;
    pick.addEventListener("change", () => {
      if (pick.checked) selected.add(pick.value);
      else selected.delete(pick.value);
      save();
    });
  }
  clear.addEventListener("click", () => {
    selected.clear();
    save();
  });
  get<HTMLButtonElement>("[data-inventory-starter]").addEventListener(
    "click",
    () => {
      for (const id of (root.dataset.starter ?? "").split(" "))
        if (byId.has(id)) selected.add(id);
      save();
    },
  );
  copy.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text());
        notice.textContent = "Editorial handoff copied.";
      } catch {
        fallback.hidden = false;
        handoff.value = text();
        handoff.focus();
        handoff.select();
        notice.textContent = "Select and copy the handoff below.";
      }
    })();
  });
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(
      new Blob([text()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "sdlcai-2026-editorial-shortlist.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice.textContent = "Editorial handoff downloaded.";
  });
  filter();
  render();
}
