import "./index.ts";

interface ActivityEvent {
  event_id: number;
  occurred_at: string;
  actor_type: "admin" | "speaker";
  actor_id: string;
  subject_speaker_id: string | null;
  speaker_name: string | null;
  category: string;
  action: string;
}

const root = document.querySelector<HTMLElement>("[data-admin-activity]");
if (root) {
  const form = root.querySelector<HTMLFormElement>("[data-activity-filters]")!;
  const list = root.querySelector<HTMLOListElement>("[data-activity-list]")!;
  const status = root.querySelector<HTMLElement>("[data-activity-status]")!;
  const more = root.querySelector<HTMLButtonElement>("[data-activity-more]")!;
  let nextBefore: number | null = null;

  async function load(append = false): Promise<void> {
    const data = new FormData(form);
    const params = new URLSearchParams();
    const actor = String(data.get("actor") ?? "");
    const speaker = String(data.get("speaker") ?? "")
      .trim()
      .toLowerCase();
    if (actor) params.set("actor", actor);
    if (speaker) params.set("speaker", speaker);
    if (append && nextBefore) params.set("before", String(nextBefore));
    status.textContent = "Loading activity…";
    more.disabled = true;
    try {
      const response = await fetch(`/api/admin/activity?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Activity could not be loaded.");
      const result = (await response.json()) as {
        events: ActivityEvent[];
        next_before: number | null;
      };
      if (!append) list.replaceChildren();
      for (const event of result.events) {
        const item = document.createElement("li");
        item.className =
          "grid gap-2 border-b border-ink p-5 md:grid-cols-[11rem_1fr_auto] md:items-start md:gap-6 md:p-6";
        const time = document.createElement("time");
        time.dateTime = event.occurred_at;
        time.className = "text-sm font-bold tabular-nums text-muted";
        time.textContent = new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(event.occurred_at));
        const description = document.createElement("div");
        const title = document.createElement("p");
        title.className = "text-lg font-bold";
        title.textContent = `${event.category} ${event.action}`;
        const detail = document.createElement("p");
        detail.className = "mt-1 text-sm text-muted";
        const actorName =
          event.actor_type === "speaker"
            ? event.speaker_name || event.actor_id
            : event.actor_id;
        detail.textContent =
          event.subject_speaker_id && event.actor_type === "admin"
            ? `${actorName} · ${event.speaker_name || event.subject_speaker_id}`
            : actorName;
        const type = document.createElement("span");
        type.className =
          "w-fit border border-ink px-2 py-1 text-xs font-bold uppercase";
        type.textContent =
          event.actor_type === "speaker" ? "Speaker" : "Organizer";
        description.appendChild(title);
        description.appendChild(detail);
        item.appendChild(time);
        item.appendChild(description);
        item.appendChild(type);
        list.appendChild(item);
      }
      nextBefore = result.next_before;
      more.hidden = nextBefore === null;
      status.textContent = list.children.length
        ? `Showing ${list.children.length} events, newest first.`
        : "No activity matches these filters yet. The log starts with changes made after this feature was added.";
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Activity could not be loaded.";
    } finally {
      more.disabled = false;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (form.reportValidity()) void load();
  });
  more.addEventListener("click", () => void load(true));
  void load();
}
