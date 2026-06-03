type ScheduleEntry = {
  description?: string | null;
  ends_at?: string | null;
  entry_type: string;
  id: number;
  location?: string | null;
  organization?: string | null;
  presenter?: string | null;
  starts_at: string;
  title: string;
};

type ScheduleResponse = {
  entries?: ScheduleEntry[];
  error?: string;
};

function setTheme(theme: "dark" | "light") {
  const themeLabel = document.querySelector("[data-theme-label]");

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;

  if (themeLabel) {
    themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
  }

  try {
    localStorage.setItem("sdlcai-theme", theme);
  } catch {
    // Ignore blocked storage.
  }
}

function initThemeToggle() {
  const themeToggle = document.querySelector("[data-theme-toggle]");

  setTheme(
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  themeToggle?.addEventListener("click", () => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "light" : "dark",
    );
  });
}

function initPublicSchedule() {
  const root = document.querySelector("[data-public-schedule]");

  if (!root) return;

  void refreshSchedule(root);
}

async function refreshSchedule(root: Element) {
  try {
    const response = await fetch("/api/schedule");
    const result = (await response.json()) as ScheduleResponse;

    if (!response.ok || result.error || !result.entries) {
      throw new Error(result.error || "Schedule unavailable");
    }

    renderSchedule(root, result.entries);
  } catch {
    renderSchedule(root, []);
  }
}

function renderSchedule(root: Element, entries: ScheduleEntry[]) {
  root.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    const title = document.createElement("p");
    const text = document.createElement("p");

    empty.className = "bg-paper p-5";
    title.className = "font-headline text-2xl font-black uppercase";
    text.className = "mt-3 leading-7 text-muted";
    title.textContent = "Schedule is being planned";
    text.textContent =
      "The public seminar schedule will appear here when sessions are published.";
    empty.appendChild(title);
    empty.appendChild(text);
    root.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("article");
    const time = document.createElement("p");
    const content = document.createElement("div");
    const label = document.createElement("p");
    const title = document.createElement("h2");
    const meta = document.createElement("p");
    const description = document.createElement("p");

    row.className =
      "grid gap-5 bg-paper p-5 md:grid-cols-[10rem_1fr] md:items-start";
    time.className =
      "font-headline text-4xl font-black uppercase leading-none md:text-right";
    content.className = "min-w-0";
    label.className = "text-sm font-bold uppercase text-muted";
    title.className = "mt-2 font-headline text-4xl font-black uppercase";
    meta.className = "mt-3 text-base font-bold text-muted";
    description.className = "mt-4 max-w-3xl leading-7 text-muted";

    time.textContent = formatScheduleRange(entry);
    label.textContent = formatScheduleEntryType(entry.entry_type);
    title.textContent = entry.title;
    meta.textContent = [entry.presenter, entry.organization, entry.location]
      .filter(Boolean)
      .join(" / ");
    description.textContent = entry.description || "";

    content.appendChild(label);
    content.appendChild(title);

    if (meta.textContent) {
      content.appendChild(meta);
    }

    if (description.textContent) {
      content.appendChild(description);
    }

    row.appendChild(time);
    row.appendChild(content);
    root.appendChild(row);
  }
}

function formatScheduleRange(entry: ScheduleEntry): string {
  const start = formatTime(entry.starts_at);
  const end = formatTime(entry.ends_at ?? null);

  return end ? `${start}-${end}` : start;
}

function formatTime(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki",
  });
}

function formatScheduleEntryType(value: string): string {
  if (value === "talk") return "Talk";
  if (value === "workshop") return "Workshop";
  if (value === "panel") return "Panel";
  if (value === "poster") return "Poster";
  if (value === "break") return "Break";
  if (value === "other") return "Other";

  return value;
}

initThemeToggle();
initPublicSchedule();

export {};
