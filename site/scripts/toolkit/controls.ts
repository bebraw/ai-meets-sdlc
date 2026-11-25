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

export function panel(title: string) {
  const panel = el("section");
  panel.className = "demo-result";
  const body = el("div");
  panel.replaceChildren(el("h3", title), body);
  return { panel, body };
}
