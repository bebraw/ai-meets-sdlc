import {
  feedbackQuestions,
  type FeedbackAnswers,
} from "../../shared/feedback.ts";

export function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  classes = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  element.className = classes;
  return element;
}

export function renderFeedbackAnswers(
  root: HTMLElement,
  answers: FeedbackAnswers,
) {
  root.replaceChildren();
  for (const question of feedbackQuestions) {
    const answer = answers[question.id];
    const group = document.createElement("div");
    append(group, textElement("h3", question.label, "font-bold"));
    append(
      group,
      textElement(
        "p",
        Array.isArray(answer)
          ? answer.join("; ")
          : answer ||
              (question.kind === "text"
                ? "No comment"
                : "Not answered in this response"),
        "mt-2 whitespace-pre-wrap break-words leading-7",
      ),
    );
    append(root, group);
  }
}

export function downloadFeedbackFile(
  name: string,
  body: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function feedbackFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      result.error ?? "Unable to load feedback. Please try again.",
    );
  return result;
}

export function feedbackError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unable to reach the server. Please try again.";
}

export function append(parent: Node, ...children: Node[]) {
  for (const child of children) parent.appendChild(child);
}
