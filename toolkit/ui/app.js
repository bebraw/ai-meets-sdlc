import { prepareEngagementForm, renderEngagementResult } from "./engagement.js";
import { prepareWorkflowForm, renderWorkflowResult } from "./workflows.js";
import { attachBadgeProof } from "./badge-proof.js";
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const human = (s) =>
  String(s)
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
const params = () => new URLSearchParams(location.hash.slice(1));
let profile,
  block,
  op,
  reader,
  badgeProof,
  serial = 0,
  widget;
const lastInputs = new Map();
async function api(path, body) {
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
  const data = await response.json();
  if (!response.ok) throw Error(data.error || response.statusText);
  return data;
}
const call = async (name, input) =>
  (await api("/api/run/" + encodeURIComponent(name), input)).data;
function nav() {
  const list = $("catalog");
  list.replaceChildren();
  const term = $("search").value.trim().toLowerCase();
  for (const [label, match] of [
    ["Tools", (b) => b.storage === "none"],
    ["Workspaces", (b) => b.storage !== "none"],
  ]) {
    const group = profile.blocks.filter(
      (b) =>
        match(b) &&
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
function newButton(text, callback) {
  const b = node("button", text);
  b.type = "button";
  b.addEventListener("click", callback);
  return b;
}
let fieldCount = 0;
function makeControl(parent, key, schema, value, path, required = false) {
  const title = schema.title || human(key);
  if (schema.type === "array") {
    const group = node("fieldset", undefined, "array"),
      rows = node("div", undefined, "rows");
    group.append(node("legend", title), rows);
    if (schema.description) group.append(node("small", schema.description));
    const get = [];
    const add = (v) => {
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
        }),
      );
    };
    for (const entry of value ?? []) add(entry);
    group.append(newButton("Add item", () => add(undefined)));
    parent.append(group);
    return () =>
      get.length || Array.isArray(value)
        ? get.map((read) => read())
        : undefined;
  }
  if (schema.type === "object" && schema.properties) {
    const group = path ? node("fieldset", undefined, "group") : parent;
    if (path) {
      group.append(node("legend", title));
      parent.append(group);
    }
    const fields = node("div", undefined, "fields");
    group.append(fields);
    if (schema.description) fields.append(node("small", schema.description));
    const reads = Object.entries(schema.properties).map(([k, s]) => [
      k,
      makeControl(
        fields,
        k,
        s,
        value?.[k],
        path ? path + "." + k : k,
        schema.required?.includes(k),
      ),
    ]);
    const additional =
      schema.additionalProperties === false
        ? []
        : Object.entries(value ?? {}).filter(
            ([key]) => !Object.hasOwn(schema.properties, key),
          );
    return () => {
      const result = Object.fromEntries([
        ...additional,
        ...reads
          .map(([k, read]) => [k, read()])
          .filter(([, v]) => v !== undefined),
      ]);
      return path && !Object.keys(result).length && value === undefined
        ? undefined
        : result;
    };
  }
  const wrapper = node("div", undefined, "field");
  const label = node("label", title);
  const generic =
    !schema.enum &&
    (!schema.type ||
      schema.type === "object" ||
      (Array.isArray(schema.type) && !schema.type.includes("string")));
  let field;
  if (schema.enum) {
    field = node("select");
    field.append(new Option("Choose…", ""));
    for (const v of schema.enum) field.append(new Option(String(v), String(v)));
  } else if (
    generic ||
    key === "csv" ||
    (schema.maxLength > 1200 &&
      !schema.contentEncoding &&
      !["logo", "portrait", "challenge", "challengeToken"].includes(key))
  )
    field = node("textarea");
  else field = node("input");
  const type = Array.isArray(schema.type)
    ? schema.type.find((t) => t !== "null")
    : schema.type;
  if (field.tagName === "INPUT")
    field.type =
      type === "boolean"
        ? "checkbox"
        : ["integer", "number"].includes(type)
          ? "number"
          : "text";
  if (field.type === "number") {
    field.step = type === "integer" ? "1" : "any";
    if (schema.minimum !== undefined) field.min = schema.minimum;
    if (schema.maximum !== undefined) field.max = schema.maximum;
  }
  if (field.tagName === "TEXTAREA") field.rows = generic ? 4 : 3;
  if (schema.readOnly) field.readOnly = true;
  field.id = "field-" + ++fieldCount;
  field.dataset.path = path;
  label.htmlFor = field.id;
  let changed = false;
  if (field.type === "checkbox") {
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
  if (schema.maxLength) field.maxLength = schema.maxLength;
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
        const f = file.files[0];
        if (!f) return;
        if (f.size > 9 * 1024 * 1024) throw Error("File exceeds 9 MiB.");
        if (image || schema.contentEncoding) {
          const url = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(Error("Could not read file"));
            r.readAsDataURL(f);
          });
          field.value = image ? url : url.split(",")[1];
        } else field.value = await f.text();
        field.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
        notice(e.message);
      }
    };
    wrapper.append(file);
  }
  parent.append(wrapper);
  return () => {
    if (field.type === "checkbox")
      return changed ||
        required ||
        value !== undefined ||
        schema.default !== undefined ||
        schema.const !== undefined
        ? field.checked
        : undefined;
    if (!field.value)
      return value === "" ? "" : value === null ? null : undefined;
    if (schema.enum)
      return schema.enum.find((choice) => String(choice) === field.value);
    if (generic) {
      try {
        return JSON.parse(field.value);
      } catch {
        throw Error("Enter valid JSON for " + title);
      }
    }
    if (["number", "integer"].includes(type)) return Number(field.value);
    return field.value;
  };
}
function notice(text) {
  $("notice").textContent = text;
}
function form(value = {}) {
  badgeProof?.dispose();
  badgeProof = undefined;
  const target = $("fields");
  target.replaceChildren();
  fieldCount = 0;
  reader = makeControl(target, "Input", op.inputSchema, value, "");
  if (block?.id === "badges") badgeProof = attachBadgeProof(target, reader);
  $("input-json").value = JSON.stringify(value, null, 2);
  $("result").replaceChildren();
  notice("");
}
async function action(name, initial) {
  const current = ++serial;
  badgeProof?.dispose();
  badgeProof = undefined;
  op = block?.operations.find((o) => o.name === name) || block?.operations[0];
  if (!op) return;
  $("operation").value = op.name;
  $("purpose").textContent = op.description;
  $("run").disabled = true;
  $("fields").replaceChildren();
  $("result").replaceChildren();
  reader = null;
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
    $("run").textContent = op.title || human(op.name.replace(/^[^_]+_/, ""));
    setupChallenge();
  } catch (error) {
    if (current === serial) notice(error.message);
  } finally {
    if (current === serial) $("run").disabled = !reader;
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
  const select = $("operation");
  select.replaceChildren();
  for (const o of block.operations)
    select.add(
      new Option(o.title || human(o.name.replace(/^[^_]+_/, "")), o.name),
    );
  let initial;
  if (p.has("input")) {
    try {
      initial = JSON.parse(p.get("input"));
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
  profile = await api("/api/catalog");
  $("event-name").textContent = profile.eventLabel;
  $("account").textContent =
    profile.role === "public" ? "Sign in" : "Sign out · " + human(profile.role);
  await route();
}
function showData(data, depth = 0) {
  if (data === null || data === undefined) return node("span", "—");
  if (Array.isArray(data)) {
    if (!data.length) return node("span", "None");
    if (
      data.every((v) => v && typeof v === "object" && !Array.isArray(v)) &&
      depth <= 2
    ) {
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
let challengePromise;
function setupChallenge() {
  const c = $("challenge");
  c.replaceChildren();
  if (widget !== undefined && window.turnstile) {
    window.turnstile.remove(widget);
    widget = undefined;
  }
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
      if (serial === current)
        widget = window.turnstile.render(c, {
          sitekey: profile.challengeSiteKey,
          action: key === "challengeToken" ? "poster-submission" : op.name,
          callback: (token) => {
            const f = $("fields").querySelector('[data-path="' + key + '"]');
            if (f) f.value = token;
          },
        });
    })
    .catch((e) => notice(e.message));
}
$("inputs").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("run"),
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
    const { data, artifact } = await api("/api/run/" + op.name, input);
    if (current !== serial) return;
    if (submittedProof === badgeProof)
      badgeProof?.check(data.issues, proofRevision);
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
    const navigate = (name, input) => {
      lastInputs.set(name, input);
      history.pushState(
        null,
        "",
        "#" + new URLSearchParams({ operation: name }),
      );
      route().catch((error) => notice(error.message));
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
      result.append(node("p", error.message, "error"));
      notice("");
    }
  } finally {
    if (current === serial) {
      button.disabled = false;
      if (widget !== undefined) window.turnstile?.reset(widget);
    }
  }
};
$("example").onclick = () => form(structuredClone(op.example || {}));
$("advanced").ontoggle = () => {
  if ($("advanced").open && reader)
    try {
      $("input-json").value = JSON.stringify(reader(), null, 2);
    } catch (e) {
      notice(e.message);
    }
};
$("apply-json").onclick = () => {
  try {
    form(JSON.parse($("input-json").value));
    $("advanced").open = false;
  } catch {
    notice("Enter a valid JSON object.");
  }
};
$("operation").onchange = () => {
  location.hash = new URLSearchParams({
    block: block.id,
    operation: $("operation").value,
  });
};
$("search").oninput = nav;
$("account").onclick = async () => {
  if (profile.role !== "public") {
    await api("/api/logout", {});
    lastInputs.clear();
    history.replaceState(null, "", "/");
    await refresh();
  } else $("access-dialog").showModal();
};
$("cancel").onclick = () => $("access-dialog").close();
$("access-form").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/api/session", { token: $("credential").value });
    $("credential").value = "";
    $("access-dialog").close();
    await refresh();
  } catch (error) {
    $("login-error").textContent = error.message;
  }
};
window.addEventListener("hashchange", () =>
  route().catch((e) => notice(e.message)),
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
  notice(error.message);
}
