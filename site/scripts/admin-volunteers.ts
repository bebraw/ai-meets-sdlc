import "./index.ts";

interface Volunteer {
  id: string;
  revision: number;
  name: string;
  email: string;
  task: string;
}

const root = document.querySelector<HTMLElement>("[data-admin-volunteers]");
if (root) setup(root);

function setup(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-volunteer-form]")!;
  const fields = root.querySelector<HTMLFieldSetElement>(
    "[data-volunteer-fields]",
  )!;
  const heading = root.querySelector<HTMLElement>("#volunteer-form-heading")!;
  const status = root.querySelector<HTMLElement>("[data-volunteer-status]")!;
  const list = root.querySelector<HTMLElement>("[data-volunteer-list]")!;
  const count = root.querySelector<HTMLElement>("[data-volunteer-count]")!;
  const save = root.querySelector<HTMLButtonElement>("[data-volunteer-save]")!;
  const cancel = root.querySelector<HTMLButtonElement>(
    "[data-volunteer-cancel]",
  )!;
  const reload = root.querySelector<HTMLButtonElement>(
    "[data-volunteer-reload]",
  )!;
  const name = form.elements.namedItem("name") as HTMLInputElement;
  const email = form.elements.namedItem("email") as HTMLInputElement;
  const task = form.elements.namedItem("task") as HTMLTextAreaElement;
  let volunteers: Volunteer[] = [];
  let editing: Volunteer | null = null;
  let busy = false;

  function reset(): void {
    editing = null;
    form.reset();
    heading.textContent = "Add volunteer";
    save.textContent = "Add volunteer";
    cancel.hidden = true;
  }

  function setBusy(value: boolean): void {
    busy = value;
    fields.disabled = value;
    reload.disabled = value;
    list.querySelectorAll("button").forEach((button) => {
      button.disabled = value;
    });
  }

  function render(): void {
    count.textContent = `(${volunteers.length})`;
    list.replaceChildren();
    if (!volunteers.length) {
      const empty = document.createElement("p");
      empty.className = "border border-ink p-6 leading-7 text-muted";
      empty.textContent =
        "No volunteers yet. Add the first person using the form.";
      list.appendChild(empty);
    }
    for (const volunteer of volunteers) {
      const card = document.createElement("article");
      card.className = "grid min-w-0 gap-4 border border-ink p-5 md:p-6";
      const title = document.createElement("h3");
      title.className = "break-words text-xl font-bold";
      title.textContent = volunteer.name;
      const contact = document.createElement("a");
      contact.className = "w-fit break-all underline underline-offset-4";
      contact.href = `mailto:${encodeURIComponent(volunteer.email)}`;
      contact.textContent = volunteer.email;
      const assignment = document.createElement("p");
      assignment.className =
        "whitespace-pre-wrap break-words border-t border-ink/20 pt-4 leading-7";
      assignment.textContent = volunteer.task || "No task assigned yet.";
      const actions = document.createElement("div");
      actions.className = "flex flex-wrap gap-3";
      const edit = button("Edit");
      edit.setAttribute("aria-label", `Edit ${volunteer.name}`);
      edit.addEventListener("click", () => {
        if (busy) return;
        if (
          editing &&
          editing.id !== volunteer.id &&
          !confirm("Discard the current edit?")
        )
          return;
        editing = volunteer;
        name.value = volunteer.name;
        email.value = volunteer.email;
        task.value = volunteer.task;
        heading.textContent = "Edit volunteer";
        save.textContent = "Save changes";
        cancel.hidden = false;
        status.textContent = "";
        name.focus();
      });
      const remove = button("Remove");
      remove.setAttribute("aria-label", `Remove ${volunteer.name}`);
      remove.addEventListener("click", async () => {
        if (
          busy ||
          !confirm(`Remove ${volunteer.name} from the volunteer list?`)
        )
          return;
        setBusy(true);
        status.textContent = "Removing volunteer…";
        try {
          await request(
            `/${volunteer.id}`,
            "DELETE",
            new URLSearchParams({ revision: String(volunteer.revision) }),
          );
          volunteers = volunteers.filter(({ id }) => id !== volunteer.id);
          if (editing?.id === volunteer.id) reset();
          render();
          status.textContent = "Volunteer removed.";
          reload.focus();
        } catch (error) {
          status.textContent = errorMessage(error);
        } finally {
          setBusy(false);
        }
      });
      actions.appendChild(edit);
      actions.appendChild(remove);
      for (const child of [title, contact, assignment, actions])
        card.appendChild(child);
      list.appendChild(card);
    }
  }

  async function load(): Promise<void> {
    setBusy(true);
    list.setAttribute("aria-busy", "true");
    try {
      const result = await request();
      volunteers = result.volunteers ?? [];
      render();
      status.textContent = "";
    } catch (error) {
      status.textContent = errorMessage(error);
      if (!list.querySelector("article"))
        list.textContent =
          "Unable to load volunteers. Use Reload list to try again.";
    } finally {
      list.setAttribute("aria-busy", "false");
      setBusy(false);
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const body = new URLSearchParams({
      name: name.value,
      email: email.value,
      task: task.value,
    });
    if (editing) body.set("revision", String(editing.revision));
    setBusy(true);
    status.textContent = "Saving volunteer…";
    try {
      const result = await request(
        editing ? `/${editing.id}` : "",
        editing ? "PUT" : "POST",
        body,
      );
      const saved = result.volunteer!;
      volunteers = volunteers.filter(({ id }) => id !== saved.id);
      volunteers.push(saved);
      volunteers.sort((a, b) => a.name.localeCompare(b.name));
      reset();
      render();
      status.textContent = "Volunteer saved.";
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      setBusy(false);
    }
  });
  cancel.addEventListener("click", () => {
    reset();
    status.textContent = "";
    name.focus();
  });
  reload.addEventListener("click", () => {
    if (
      busy ||
      (editing && !confirm("Discard the current edit and reload the list?"))
    )
      return;
    reset();
    void load();
  });
  void load();
}

function button(label: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.className =
    "border border-ink px-4 py-3 text-sm font-bold uppercase transition hover:bg-ink hover:text-paper disabled:opacity-50";
  result.textContent = label;
  return result;
}

async function request(
  path = "",
  method = "GET",
  body?: URLSearchParams,
): Promise<{ volunteers?: Volunteer[]; volunteer?: Volunteer }> {
  const response = await fetch(`/api/admin/volunteers${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-admin-action": "manage-volunteers" },
    ...(body ? { body } : {}),
  });
  if (response.status === 401)
    throw new Error(
      "Your admin session has expired. Sign in again before saving.",
    );
  const result = (await response.json()) as {
    error?: string;
    volunteers?: Volunteer[];
    volunteer?: Volunteer;
  };
  if (!response.ok)
    throw new Error(
      result.error || "Unable to save changes. Please try again.",
    );
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to reach the server. Please try again.";
}
