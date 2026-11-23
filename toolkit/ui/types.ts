import type { Operation } from "../contracts.mjs";
export type Inputs = Record<string, unknown>;
export interface UiOperation extends Operation {
  initial?: Inputs;
  unavailable?: string;
  title?: string;
}
export type Call = <T = Record<string, unknown>>(
  name: string,
  input: Inputs,
) => Promise<T>;
export type Navigate = (name: string, input: Inputs) => void;
export function element<T extends keyof HTMLElementTagNameMap>(
  tag: T,
  content?: unknown,
  className?: string,
): HTMLElementTagNameMap[T] {
  const el = document.createElement(tag);
  if (content !== undefined) el.textContent = String(content);
  if (className) el.className = className;
  return el;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
