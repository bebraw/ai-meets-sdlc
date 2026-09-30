import { append } from "./admin-toolkit.ts";
import "./index.ts";
import type { Organizer } from "../../worker/organizers.ts";
import { el, button, field, api, message } from "./admin-toolkit.ts";
const root = document.querySelector<HTMLElement>("[data-admin-organizers]");
if (root) setup(root);
function setup(root: HTMLElement): void {
  const status = el("p", "Loading organizers…", "my-5 font-bold");
  status.setAttribute("role", "status");
  const list = el("div", "", "grid gap-5 md:grid-cols-2");
  let busy = false;
  const request = (method = "GET", body?: unknown) =>
    api<{ organizers: Organizer[] }>(
      "/api/admin/organizers",
      "manage-organizers",
      method,
      body,
    );
  const run = async (method = "GET", body?: unknown) => {
    if (busy) return;
    busy = true;
    root.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const result = await request(method, body);
      render(
        method === "DELETE" ? (await request()).organizers : result.organizers,
      );
      status.textContent =
        method === "GET"
          ? "Homepage visibility and badge inclusion are independent."
          : "Organizer saved. Homepage changes are live.";
    } catch (error) {
      status.textContent = message(error);
    } finally {
      busy = false;
      root.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
  function card(person?: Organizer): HTMLElement {
    const form = el("form", "", "grid gap-4 border border-ink p-5");
    append(
      form,
      el(
        "h2",
        person?.name ?? "Add organizer",
        "font-headline text-2xl uppercase",
      ),
    );
    const fields = [
      field("Name", person?.name),
      field("Company (optional)", person?.company),
      field("Photo path (optional, /assets/…)", person?.photo),
      field("Homepage order", String(person?.position ?? 0), "number"),
    ];
    fields[0]!.input.required = true;
    fields[0]!.input.maxLength = 200;
    fields[1]!.input.maxLength = 200;
    fields[3]!.input.min = "0";
    fields[3]!.input.max = "1000";
    fields.forEach((f) => append(form, f.label));
    const visible = field("Show on homepage", "", "checkbox");
    visible.input.checked = Boolean(person?.visible);
    const badge = field("Attending — include in badge source", "", "checkbox");
    badge.input.checked = Boolean(person?.badge);
    for (const f of [visible, badge]) {
      f.input.className = "h-5 w-5";
      append(form, f.label);
    }
    const save = button(person ? "Save organizer" : "Add organizer", () => {});
    save.type = "submit";
    append(form, save);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(person ? "PUT" : "POST", {
        id: person?.id,
        revision: person?.revision,
        name: fields[0]!.input.value,
        company: fields[1]!.input.value,
        photo: fields[2]!.input.value,
        position: Number(fields[3]!.input.value),
        visible: visible.input.checked,
        badge: badge.input.checked,
      });
    });
    if (person)
      append(
        form,
        button("Remove organizer", () => {
          if (
            confirm(`Remove ${person.name} from organizers and the homepage?`)
          )
            void run("DELETE", { id: person.id, revision: person.revision });
        }),
      );
    return form;
  }
  function render(people: Organizer[]) {
    list.replaceChildren(...people.map((person) => card(person)), card());
  }
  append(
    root,
    button("Reload organizers", () => {
      if (confirm("Discard unsaved organizer edits and reload?")) void run();
    }),
    status,
    list,
  );
  void run();
}
