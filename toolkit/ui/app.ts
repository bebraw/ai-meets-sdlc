import { printFonts, type PrintFontId } from "../blocks/print-fonts.mjs";
import { prepareEngagementForm, renderEngagementResult } from "./engagement.js";
import { prepareWorkflowForm, renderWorkflowResult } from "./workflows.js";
import { attachBadgeProof } from "./badge-proof.js";
import type { Block, JsonSchema, Role } from "../contracts.mjs";
import {
  element as node,
  message,
  type UiOperation,
  type Inputs,
  type Call,
  type Navigate,
} from "./types.js";

function $<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K];
function $(id: string): HTMLElement;
function $(id: string, tag?: keyof HTMLElementTagNameMap): HTMLElement {
  const el = document.querySelector<HTMLElement>((tag ?? "") + "#" + id);
  if (!el) throw Error("Missing workspace element " + id);
  return el;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
interface Profile {
  eventLabel: string;
  role: Role;
  blocks: (Omit<Block, "operations"> & { operations: UiOperation[] })[];
  challengeSiteKey: string;
}
interface RunResult<T = unknown> {
  data: T;
  artifact?: { name: string; mimeType: string; url: string };
}
interface ChallengeWidget {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
    },
  ): string;
  remove(id: string): void;
  reset(id: string): void;
}
declare global {
  interface Window {
    turnstile?: ChallengeWidget;
  }
}
const human = (s: string) =>
  String(s)
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
const params = () => new URLSearchParams(location.hash.slice(1));
let profile: Profile;
let block: Profile["blocks"][number] | undefined;
let op: UiOperation | undefined;
let reader: (() => Inputs) | undefined;
let badgeProof: ReturnType<typeof attachBadgeProof> | undefined;
let serial = 0;
let widget: string | undefined;
const lastInputs = new Map<string, Inputs>();
async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await response.json();
  if (!response.ok)
    throw Error(
      isRecord(data) && typeof data.error === "string"
        ? data.error
        : response.statusText,
    );
  return data as T;
}
const call: Call = async <T>(name: string, input: Inputs) =>
  (await api<RunResult<T>>("/api/run/" + encodeURIComponent(name), input)).data;
function nav() {
  const list = $("catalog");
  list.replaceChildren();
  const term = $("search", "input").value.trim().toLowerCase();
  for (const label of ["Tools", "Workspaces"]) {
    const group = profile.blocks.filter(
      (b) =>
        (label === "Tools" ? b.storage === "none" : b.storage !== "none") &&
        (b.title + " " + b.description).toLowerCase().includes(term),
    );
    if (group.length) list.append(node("h2", label));
    for (const b of group) {
      const a = node("a", b.title);
      a.href = "#block=" + b.id;
      if (b.id === block?.id) a.setAttribute("aria-current", "page");
      list.append(a);
    }
  }
}
function newButton(text: string, callback: () => void) {
  const b = node("button", text);
  b.type = "button";
  b.addEventListener("click", callback);
  return b;
}
let fieldCount = 0;
function makeControl(
  parent: HTMLElement,
  key: string,
  schema: JsonSchema,
  value: unknown,
  path: string,
  required = false,
): () => unknown {
  const title = schema.title || human(key);
  if (schema.type === "array") {
    const group = node("fieldset", undefined, "array"),
      rows = node("div", undefined, "rows");
    group.append(node("legend", title), rows);
    if (schema.description) group.append(node("small", schema.description));
    const get: (() => unknown)[] = [];
    const add = (v: unknown) => {
      const cell = node("div", undefined, "row");
      const read = makeControl(
        cell,
        "Item",
        schema.items || {},
        v,
        path + "." + get.length,
      );
      get.push(read);
      rows.append(cell);
      cell.append(
        newButton("Remove", () => {
          get.splice(get.indexOf(read), 1);
          cell.remove();
          group.dispatchEvent(new Event("input", { bubbles: true }));
        }),
      );
    };
    if (Array.isArray(value)) for (const entry of value) add(entry);
    group.append(
      newButton("Add item", () => {
        add(undefined);
        group.dispatchEvent(new Event("input", { bubbles: true }));
      }),
    );
    parent.append(group);
    return () =>
      get.length || required || Array.isArray(value)
        ? get.map((read) => read())
        : undefined;
  }
  if (schema.type === "object" && schema.properties) {
    const group = path ? node("fieldset", undefined, "group") : parent;
    // Required children supply defaults only when this parent is present.
    let present = !path || required || value !== undefined;
    if (!present) {
      const markPresent = () => {
        present = true;
      };
      group.addEventListener("input", markPresent, { once: true });
      group.addEventListener("change", markPresent, { once: true });
    }
    if (path) {
      group.append(node("legend", title));
      parent.append(group);
    }
    const fields = node("div", undefined, "fields");
    group.append(fields);
    if (schema.description) fields.append(node("small", schema.description));
    const input = isRecord(value) ? value : {};
    const properties = schema.properties;
    const reads = Object.entries(properties).map(
      ([k, s]) =>
        [
          k,
          makeControl(
            fields,
            k,
            s,
            input[k],
            path ? path + "." + k : k,
            schema.required?.includes(k),
          ),
        ] as const,
    );
    const additional =
      schema.additionalProperties === false
        ? []
        : Object.entries(input).filter(
            ([key]) => !Object.hasOwn(properties, key),
          );
    return () => {
      if (!present) return undefined;
      const result = Object.fromEntries([
        ...additional,
        ...reads
          .map(([k, read]) => [k, read()])
          .filter(([, v]) => v !== undefined),
      ]);
      return path &&
        !required &&
        !Object.keys(result).length &&
        value === undefined
        ? undefined
        : result;
    };
  }
  const wrapper = node("div", undefined, "field");
  const label = node("label", title);
  // A union of string formats (such as date or date-time) is still a text input.
  const types =
    schema.type ?? schema.anyOf?.flatMap((branch) => branch.type ?? []);
  const nullable = Array.isArray(types) && types.includes("null");
  const scalarTypes =
    typeof types === "string"
      ? [types]
      : [...new Set(types ?? [])].filter((t) => t !== "null");
  const type = scalarTypes.length === 1 ? scalarTypes[0] : undefined;
  const generic =
    !schema.enum && (!type || type === "object" || type === "array");
  let field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (schema.enum) {
    field = node("select");
    const placeholder =
      key === "shape"
        ? "Default (Circle)"
        : key === "font"
          ? "Default (Noto Sans)"
          : "Choose…";
    field.append(new Option(placeholder, ""));
    for (const value of schema.enum) {
      const id = String(value);
      let label = id;
      if (key === "font" && Object.hasOwn(printFonts, id))
        label = printFonts[id as PrintFontId].label;
      if (key === "shape") label = human(id.replaceAll("-", " "));
      field.append(new Option(label, id));
    }
  } else if (
    generic ||
    key === "csv" ||
    ((schema.maxLength ?? 0) > 1200 &&
      !schema.contentEncoding &&
      !["logo", "portrait", "challenge", "challengeToken"].includes(key))
  )
    field = node("textarea");
  else field = node("input");
  if (field instanceof HTMLInputElement)
    field.type =
      type === "boolean"
        ? "checkbox"
        : type === "integer" || type === "number"
          ? "number"
          : "text";
  if (field instanceof HTMLInputElement && field.type === "number") {
    field.step = type === "integer" ? "1" : "any";
    if (schema.minimum !== undefined) field.min = String(schema.minimum);
    if (schema.maximum !== undefined) field.max = String(schema.maximum);
  }
  if (field instanceof HTMLTextAreaElement) field.rows = generic ? 4 : 3;
  if (schema.readOnly && !(field instanceof HTMLSelectElement))
    field.readOnly = true;
  field.id = "field-" + ++fieldCount;
  field.dataset.path = path;
  label.htmlFor = field.id;
  let changed = false;
  if (field instanceof HTMLInputElement && field.type === "checkbox") {
    field.checked = (value ?? schema.default) === true;
    field.addEventListener("change", () => {
      changed = true;
    });
  } else
    field.value =
      value === undefined
        ? ""
        : generic
          ? JSON.stringify(value, null, 2)
          : String(value ?? "");
  if (schema.maxLength && !(field instanceof HTMLSelectElement))
    field.maxLength = schema.maxLength;
  wrapper.append(label, field);
  if (schema.description) wrapper.append(node("small", schema.description));
  const image =
    /^\^data:image/.test(schema.pattern ?? "") ||
    ["portrait", "logo"].includes(key);
  if (
    schema.contentEncoding === "base64" ||
    image ||
    (key.toLowerCase().includes("csv") && type === "string")
  ) {
    const file = node("input");
    file.type = "file";
    file.setAttribute("aria-label", "Load " + title + " from file");
    file.accept =
      schema.contentMediaType ||
      (image
        ? "image/png,image/jpeg,image/webp,image/svg+xml"
        : ".csv,text/csv");
    file.onchange = async () => {
      try {
        const f = file.files?.[0];
        if (!f) return;
        if (f.size > 9 * 1024 * 1024) throw Error("File exceeds 9 MiB.");
        if (image || schema.contentEncoding) {
          const url = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () =>
              typeof r.result === "string"
                ? resolve(r.result)
                : reject(Error("Could not read file"));
            r.onerror = () => reject(Error("Could not read file"));
            r.readAsDataURL(f);
          });
          field.value = image ? url : url.split(",")[1];
        } else field.value = await f.text();
        field.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
        notice(message(e));
      }
    };
    wrapper.append(file);
  }
  parent.append(wrapper);
  return () => {
    if (field instanceof HTMLInputElement && field.type === "checkbox")
      return changed ||
        required ||
        value !== undefined ||
        schema.default !== undefined ||
        schema.const !== undefined
        ? field.checked
        : undefined;
    if (!field.value) {
      if (value === "") return "";
      if (value === null || (required && nullable)) return null;
      if (required && type === "string" && !schema.minLength && !schema.enum)
        return "";
      return undefined;
    }
    if (schema.enum)
      return schema.enum.find((choice) => String(choice) === field.value);
    if (generic) {
      try {
        return JSON.parse(field.value);
      } catch {
        throw Error("Enter valid JSON for " + title);
      }
    }
    if (type === "integer" || type === "number") return Number(field.value);
    return field.value;
  };
}
function notice(text: string) {
  $("notice").textContent = text;
}
function form(value: unknown = {}) {
  if (!op) return;
  if (!isRecord(value)) throw Error("Enter a valid JSON object.");
  badgeProof?.dispose();
  badgeProof = undefined;
  const target = $("fields");
  target.replaceChildren();
  fieldCount = 0;
  const read = makeControl(target, "Input", op.inputSchema, value, "");
  reader = () => {
    const input = read();
    if (!isRecord(input)) throw Error("The input must be an object.");
    return input;
  };
  if (block?.id === "badges") badgeProof = attachBadgeProof(target, reader);
  $("input-json", "textarea").value = JSON.stringify(value, null, 2);
  $("result").replaceChildren();
  notice("");
}
async function action(name: string | null, initial?: Inputs) {
  const current = ++serial;
  badgeProof?.dispose();
  badgeProof = undefined;
  op = block?.operations.find((o) => o.name === name) || block?.operations[0];
  if (!op) return;
  $("operation", "select").value = op.name;
  $("purpose").textContent = op.description;
  $("run", "button").disabled = true;
  $("fields").replaceChildren();
  $("result").replaceChildren();
  reader = undefined;
  notice("");
  try {
    const previous = initial || lastInputs.get(op.name) || {};
    const prepared =
      (await prepareEngagementForm(op, call, previous)) ||
      (await prepareWorkflowForm(op, call, previous));
    if (current !== serial) return;
    if (prepared?.unavailable) {
      $("fields").replaceChildren();
      notice(prepared.unavailable);
      return;
    }
    op = prepared || op;
    $("purpose").textContent = op.description;
    form({ ...previous, ...op.initial });
    $("run", "button").textContent =
      op.title || human(op.name.replace(/^[^_]+_/, ""));
    setupChallenge();
  } catch (error) {
    if (current === serial) notice(message(error));
  } finally {
    if (current === serial) $("run", "button").disabled = !reader;
  }
}
async function route() {
  const p = params();
  const requested = p.get("operation");
  block =
    profile.blocks.find((b) =>
      requested
        ? b.operations.some((o) => o.name === requested)
        : b.id === p.get("block"),
    ) || profile.blocks[0];
  nav();
  $("tool").hidden = !block;
  if (!block) {
    $("title").textContent = "Event workspace";
    $("description").textContent = "Sign in to use the installed tools.";
    return;
  }
  $("title").textContent = block.title;
  $("description").textContent = block.description;
  document.title = block.title + " · Event toolkit";
  const select = $("operation", "select");
  select.replaceChildren();
  for (const o of block.operations)
    select.add(
      new Option(o.title || human(o.name.replace(/^[^_]+_/, "")), o.name),
    );
  let initial: Inputs | undefined;
  if (p.has("input")) {
    try {
      const value: unknown = JSON.parse(p.get("input")!);
      if (!isRecord(value)) throw Error("Invalid action link.");
      initial = value;
    } catch {
      notice("Invalid action link.");
      return;
    }
  }
  if (requested && !block.operations.some((o) => o.name === requested)) {
    notice("Sign in with access to the requested action.");
    return;
  }
  await action(requested, initial);
}
async function refresh() {
  profile = await api<Profile>("/api/catalog");
  $("event-name").textContent = profile.eventLabel;
  $("account").textContent =
    profile.role === "public" ? "Sign in" : "Sign out · " + human(profile.role);
  await route();
}
function showData(data: unknown, depth = 0): HTMLElement {
  if (data === null || data === undefined) return node("span", "—");
  if (Array.isArray(data)) {
    if (!data.length) return node("span", "None");
    if (data.every(isRecord) && depth <= 2) {
      const area = node("div", undefined, "output"),
        table = node("table"),
        thead = node("thead"),
        head = node("tr"),
        body = node("tbody");
      const keys = [...new Set(data.flatMap((row) => Object.keys(row)))];
      for (const k of keys) head.append(node("th", human(k)));
      thead.append(head);
      table.append(thead, body);
      for (const row of data.slice(0, 100)) {
        const tr = node("tr");
        for (const k of keys) {
          const td = node("td");
          td.append(showData(row[k], depth + 1));
          tr.append(td);
        }
        body.append(tr);
      }
      area.append(table);
      if (data.length > 100)
        area.append(
          node(
            "small",
            "Showing 100 of " +
              data.length +
              " rows. All rows are in the JSON result.",
          ),
        );
      return area;
    }
    return node(
      "span",
      data
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : v))
        .join(", "),
    );
  }
  if (typeof data === "object") {
    if (depth > 2) return node("code", JSON.stringify(data));
    const dl = node("dl");
    for (const [k, v] of Object.entries(data)) {
      const dd = node("dd");
      dd.append(showData(v, depth + 1));
      dl.append(node("dt", human(k)), dd);
    }
    return dl;
  }
  if (typeof data === "string" && /^https?:\/\//.test(data)) {
    const a = node("a", data);
    a.href = data;
    a.rel = "noreferrer";
    return a;
  }
  return node("span", String(data));
}
let challengePromise: Promise<void> | undefined;
function setupChallenge() {
  const c = $("challenge");
  c.replaceChildren();
  if (widget !== undefined && window.turnstile) {
    window.turnstile.remove(widget);
    widget = undefined;
  }
  if (!op) return;
  const selected = op;
  const properties = op.inputSchema.properties || {};
  const key =
    "challenge" in properties
      ? "challenge"
      : "challengeToken" in properties
        ? "challengeToken"
        : null;
  if (!key || !profile.challengeSiteKey) return;
  challengePromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.onload = () => resolve();
    s.onerror = () => reject(Error("Could not load form verification."));
    document.head.append(s);
  });
  const current = serial;
  challengePromise
    .then(() => {
      if (serial === current && window.turnstile)
        widget = window.turnstile.render(c, {
          sitekey: profile.challengeSiteKey,
          action:
            key === "challengeToken" ? "poster-submission" : selected.name,
          callback: (token) => {
            const f = $("fields").querySelector<HTMLInputElement>(
              '[data-path="' + key + '"]',
            );
            if (f) f.value = token;
          },
        });
    })
    .catch((e) => notice(message(e)));
}
$("inputs").onsubmit = async (event) => {
  event.preventDefault();
  if (!reader || !op) return;
  const button = $("run", "button"),
    result = $("result"),
    current = serial;
  button.disabled = true;
  result.replaceChildren();
  notice("Working…");
  try {
    const input = reader();
    const submittedProof = badgeProof,
      proofRevision = badgeProof?.revision;
    lastInputs.set(op.name, input);
    const { data, artifact } = await api<RunResult>(
      "/api/run/" + op.name,
      input,
    );
    if (current !== serial) return;
    if (
      submittedProof &&
      submittedProof === badgeProof &&
      proofRevision !== undefined &&
      isRecord(data)
    )
      submittedProof.check(data.issues, proofRevision);
    result.append(node("h2", "Result"));
    if (artifact) {
      const link = node("a", "Download " + artifact.name);
      link.href = artifact.url + "?download";
      link.download = artifact.name;
      result.append(link);
      if (artifact.mimeType.startsWith("image/") && !badgeProof) {
        const img = node("img", undefined, "proof");
        img.src = artifact.url;
        img.alt = "Generated proof";
        result.append(img);
      }
      if (["text/html", "application/pdf"].includes(artifact.mimeType)) {
        const a = node(
          "a",
          "Open " +
            (artifact.mimeType === "application/pdf"
              ? "PDF for printing"
              : "schedule"),
        );
        a.href = artifact.url;
        a.target = "_blank";
        a.rel = "noopener";
        result.append(document.createTextNode(" · "), a);
        if (artifact.mimeType === "text/html") {
          const frame = node("iframe", undefined, "document");
          frame.title = "Schedule preview";
          frame.setAttribute("sandbox", "");
          frame.src = artifact.url;
          result.append(frame);
        }
      }
    }
    const navigate: Navigate = (name, input) => {
      lastInputs.set(name, input);
      history.pushState(
        null,
        "",
        "#" + new URLSearchParams({ operation: name }),
      );
      route().catch((error) => notice(message(error)));
    };
    if (
      !renderEngagementResult(op, data, result, call) &&
      !renderWorkflowResult(op, data, result, call, navigate, input)
    )
      result.append(showData(data));
    const raw = node("details");
    raw.append(
      node("summary", "Result as JSON"),
      node("pre", JSON.stringify(data, null, 2)),
    );
    result.append(raw);
    notice("");
    result.scrollIntoView({ block: "nearest" });
  } catch (error) {
    if (current === serial) {
      result.append(node("p", message(error), "error"));
      notice("");
    }
  } finally {
    if (current === serial) {
      button.disabled = false;
      if (widget !== undefined) window.turnstile?.reset(widget);
    }
  }
};
$("example").onclick = () => form(structuredClone(op?.example || {}));
$("advanced", "details").ontoggle = () => {
  if ($("advanced", "details").open && reader)
    try {
      $("input-json", "textarea").value = JSON.stringify(reader(), null, 2);
    } catch (e) {
      notice(message(e));
    }
};
$("apply-json").onclick = () => {
  try {
    form(JSON.parse($("input-json", "textarea").value));
    $("advanced", "details").open = false;
  } catch {
    notice("Enter a valid JSON object.");
  }
};
$("operation", "select").onchange = () => {
  if (!block) return;
  location.hash = new URLSearchParams({
    block: block.id,
    operation: $("operation", "select").value,
  }).toString();
};
$("search", "input").oninput = nav;
$("account").onclick = async () => {
  if (profile.role !== "public") {
    await api("/api/logout", {});
    lastInputs.clear();
    history.replaceState(null, "", "/");
    await refresh();
  } else $("access-dialog", "dialog").showModal();
};
$("cancel").onclick = () => $("access-dialog", "dialog").close();
$("access-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/api/session", { token: $("credential", "input").value });
    $("credential", "input").value = "";
    $("access-dialog", "dialog").close();
    await refresh();
  } catch (error) {
    $("login-error").textContent = message(error);
  }
};
window.addEventListener("hashchange", () =>
  route().catch((e) => notice(message(e))),
);
try {
  const p = params();
  if (p.has("access")) {
    const token = p.get("access");
    p.delete("access");
    history.replaceState(null, "", "/#" + p);
    await api("/api/session", { token });
  }
  await refresh();
} catch (error) {
  notice(message(error));
}
