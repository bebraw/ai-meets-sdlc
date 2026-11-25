export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

export function append(parent: Node, ...children: Node[]) {
  for (const child of children) parent.appendChild(child);
}

export function field(label: string, control: Node) {
  const wrapper = el("label");
  wrapper.replaceChildren(el("span", label), control);
  return wrapper;
}

export function select(options: readonly string[], initial?: string) {
  const control = el("select");
  for (const option of options) control.add(new Option(option, option));
  if (initial !== undefined) control.value = initial;
  return control;
}

export function input(value: string, type = "text") {
  const control = el("input");
  control.type = type;
  control.value = value;
  return control;
}

export function button(text: string, onClick: () => void) {
  const control = el("button", text);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}

export function copySetup(
  root: HTMLElement,
  operation: string,
  read: () => object,
) {
  const wrapper = el("div");
  const feedback = el("p");
  feedback.setAttribute("role", "status");
  const manual = el("textarea");
  manual.readOnly = true;
  manual.rows = 6;
  const manualField = field("Setup JSON to copy", manual);
  manualField.hidden = true;
  const instructions = `In your toolkit workspace, open ${operation}, choose Edit as JSON, paste the setup and select Apply JSON.`;
  let revision = 0;
  root.addEventListener("input", () => {
    revision++;
    manualField.hidden = true;
    feedback.textContent = "";
  });
  const action = button("Copy setup", async () => {
    const current = ++revision;
    let json: string;
    try {
      json = JSON.stringify(read(), null, 2);
    } catch (error) {
      feedback.textContent =
        error instanceof Error
          ? error.message
          : "Check the settings before copying.";
      return;
    }
    try {
      await navigator.clipboard.writeText(json);
      if (current !== revision) return;
      manualField.hidden = true;
      feedback.textContent = "Setup copied. " + instructions;
    } catch {
      if (current !== revision) return;
      manual.value = json;
      manualField.hidden = false;
      manual.focus();
      manual.select();
      feedback.textContent = "Copy the selected JSON. " + instructions;
    }
  });
  append(wrapper, action, manualField, feedback);
  return wrapper;
}

export function panel(title: string) {
  const panel = el("section");
  panel.className = "demo-result";
  const body = el("div");
  panel.replaceChildren(el("h3", title), body);
  return { panel, body };
}
