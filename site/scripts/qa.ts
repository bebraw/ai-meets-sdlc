const root = document.querySelector<HTMLElement>("[data-qa-content]");
const connection = document.querySelector<HTMLElement>("[data-qa-connection]");
let generation = 0;
let pending = 0;
let polling: ReturnType<typeof setInterval> | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const busyForms = new WeakSet<HTMLFormElement>();

function message(text: string): void {
  const notice = root?.querySelector<HTMLElement>("[data-qa-notice]");
  if (notice) notice.textContent = text;
  else if (connection) connection.textContent = text;
}
function editing(): boolean {
  return [
    ...(root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input:not([type=hidden]):not([readonly]), textarea:not(#qa-question)",
    ) ?? []),
  ].some((field) => field.value !== field.defaultValue);
}
function apply(html: string, allowRoomChange = false): void {
  if (!root) return;
  const next = document.createElement("div");
  next.innerHTML = html;
  const draft = root.querySelector<HTMLTextAreaElement>("#qa-question");
  const requestId =
    root.querySelector<HTMLInputElement>("[name=requestId]")?.value;
  const changedRoom =
    root.querySelector<HTMLElement>("[data-qa-state]")?.dataset.roomId !==
    next.querySelector<HTMLElement>("[data-qa-state]")?.dataset.roomId;
  if (draft?.value && changedRoom && !allowRoomChange) {
    message(
      "The active session changed. Your draft is still here. Review the new session before sending it.",
    );
    const notice = root.querySelector("[data-qa-notice]");
    if (notice && !notice.querySelector("button")) {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        "ml-3 border border-ink px-4 py-3 text-sm font-bold uppercase";
      button.textContent = "Review new session";
      button.addEventListener("click", () => apply(html, true));
      notice.appendChild(button);
    }
    return;
  }
  const open = new Set(
    [...root.querySelectorAll("details[open]")].map(
      (detail) =>
        `${detail.closest<HTMLElement>("[data-qa-question]")?.dataset.qaQuestion ?? ""}:${detail.querySelector("summary")?.textContent}`,
    ),
  );
  const nextDraft = next.querySelector<HTMLTextAreaElement>("#qa-question");
  if (draft?.value && nextDraft) {
    nextDraft.value = draft.value;
    if (!changedRoom && requestId)
      next.querySelector<HTMLInputElement>("[name=requestId]")!.value =
        requestId;
  }
  const focused =
    document.activeElement instanceof HTMLElement &&
    root.contains(document.activeElement)
      ? document.activeElement.id
      : "";
  root.replaceChildren(...next.childNodes);
  for (const detail of root.querySelectorAll<HTMLDetailsElement>("details"))
    detail.open = open.has(
      `${detail.closest<HTMLElement>("[data-qa-question]")?.dataset.qaQuestion ?? ""}:${detail.querySelector("summary")?.textContent}`,
    );
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
}
async function refresh(): Promise<void> {
  if (!root || pending || editing() || document.hidden) return;
  const version = ++generation;
  const url = new URL(location.href);
  url.hash = "";
  url.searchParams.delete("notice");
  try {
    const response = await fetch(url, {
      headers: { "x-qa-fragment": "1" },
      cache: "no-store",
      credentials: "same-origin",
    });
    if (
      response.redirected &&
      new URL(response.url).pathname === "/qa/access/"
    ) {
      location.assign(response.url);
      return;
    }
    if (!response.ok || response.headers.get("x-qa-fragment") !== "1") {
      if (connection)
        connection.textContent =
          "Connection interrupted. Your draft stays here.";
      return;
    }
    const html = await response.text();
    if (version === generation && !pending && !editing()) apply(html);
  } catch {
    if (connection)
      connection.textContent = "Reconnecting. Your draft stays here.";
  }
}
function scheduleRefresh(): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refresh();
  }, 150);
}
root?.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches("[data-qa-action]"))
    return;
  event.preventDefault();
  if (busyForms.has(form)) return;
  busyForms.add(form);
  pending++;
  generation++;
  const body = new FormData(form);
  const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")].map(
    (button) => ({ button, disabled: button.disabled }),
  );
  for (const { button } of buttons) button.disabled = true;
  let notice = "";
  try {
    // The hidden `action` field masks HTMLFormElement.action in browsers.
    const response = await fetch(form.getAttribute("action") || location.href, {
      method: "POST",
      body,
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const result = (await response.json()) as {
      ok?: boolean;
      message?: string;
      error?: string;
    };
    notice =
      result.message || result.error || "Unable to save. Please try again.";
    if (result.ok) {
      if (body.get("action") === "add") {
        const field = form.querySelector<HTMLTextAreaElement>("textarea");
        if (field) field.value = "";
        const requestId =
          form.querySelector<HTMLInputElement>("[name=requestId]");
        if (requestId) requestId.value = crypto.randomUUID();
      } else form.reset();
    }
    if (
      response.status === 403 &&
      location.pathname.startsWith("/qa/") &&
      location.pathname !== "/qa/"
    ) {
      const url = new URL("/qa/access/", location.origin);
      url.searchParams.set("notice", notice);
      location.assign(url.href);
    }
  } catch {
    notice =
      "The connection was interrupted. Your input is still here; try again.";
  } finally {
    pending--;
    busyForms.delete(form);
    for (const { button, disabled } of buttons) button.disabled = disabled;
  }
  await refresh();
  message(notice);
});
root?.addEventListener("click", async (event) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-qa-copy]")
      : null;
  if (!button?.dataset.qaCopy) return;
  const field = document.getElementById(button.dataset.qaCopy);
  if (!(field instanceof HTMLInputElement)) return;
  try {
    await navigator.clipboard.writeText(field.value);
    message("Access link copied.");
  } catch {
    field.focus();
    field.select();
    message("Access link selected. Copy it using your browser or keyboard.");
  }
});

const accessInput =
  document.querySelector<HTMLInputElement>("#qa-access-token");
if (location.pathname === "/qa/access/" && accessInput) {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token && /^[A-Za-z0-9_-]{43}$/u.test(token)) accessInput.value = token;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
} else if (root) {
  let events: EventSource | undefined;
  const poll = () => {
    polling ??= setInterval(() => {
      void refresh();
    }, 10_000);
  };
  const connect = () => {
    if (typeof EventSource === "undefined") {
      poll();
      return;
    }
    if (events) return;
    events = new EventSource("/api/qa/events");
    events.addEventListener("qa-change", scheduleRefresh);
    events.onopen = () => {
      clearInterval(polling);
      polling = undefined;
      if (connection) connection.textContent = "Live updates connected.";
      void refresh();
    };
    events.onerror = () => {
      if (connection)
        connection.textContent =
          "Reconnecting. Updates continue while you wait.";
      poll();
    };
  };
  connect();
  window.addEventListener("pagehide", () => {
    events?.close();
    events = undefined;
    clearInterval(polling);
    polling = undefined;
    clearTimeout(refreshTimer);
  });
  window.addEventListener("pageshow", () => {
    connect();
    void refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
}
