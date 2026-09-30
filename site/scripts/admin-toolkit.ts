export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}
export const buttonClass =
  "border border-ink px-4 py-3 text-sm font-bold uppercase hover:bg-ink hover:text-paper disabled:opacity-50";
export function button(text: string, action: () => void): HTMLButtonElement {
  const b = el("button", text, buttonClass);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}
export function field(
  label: string,
  value = "",
  type = "text",
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const node = el("label", "", "grid gap-2 text-sm font-bold");
  append(node, el("span", label));
  const input = el(
    "input",
    "",
    "min-w-0 w-full border border-ink bg-paper px-3 py-2 font-normal",
  );
  input.type = type;
  input.value = value;
  append(node, input);
  return { label: node, input };
}
export async function api<T>(
  url: string,
  action: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-admin-action": action },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 401)
    throw new Error("Your admin session expired. Sign in again.");
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}
export const message = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to reach the server.";

export function append(parent: Node, ...children: Node[]): void {
  for (const child of children) parent.appendChild(child);
}
