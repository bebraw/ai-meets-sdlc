interface ReceiptItem {
  receipt_id: string;
  speaker_id: string;
  speaker_name: string;
  description: string;
  amount: string;
  currency: string;
  expense_date: string;
  note: string;
  organizer_note: string;
  filename: string;
  byte_size: number;
  status: "submitted" | "processed";
  revision: number;
  created_at: string;
  processed_at: string | null;
  download_url: string;
}

interface ReceiptAccess {
  speaker_id: string;
  name: string;
  enabled: boolean;
}
interface ReceiptResponse {
  receipts: ReceiptItem[];
  enabled?: boolean;
  upload_until?: string;
  speakers?: ReceiptAccess[];
}

const adminRoot = document.querySelector<HTMLElement>("[data-admin-receipts]");
const speakerList = document.querySelector<HTMLElement>(
  "[data-speaker-receipts]",
);
const uploadForm = document.querySelector<HTMLFormElement>(
  "[data-receipt-upload]",
);
const status = document.querySelector<HTMLElement>("[data-receipt-status]");
const statusFilterElement = document.querySelector("[data-receipt-filter]");
const statusFilter =
  statusFilterElement instanceof HTMLSelectElement ? statusFilterElement : null;
const speakerFilterElement = document.querySelector(
  "[data-receipt-speaker-filter]",
);
const speakerFilter =
  speakerFilterElement instanceof HTMLSelectElement
    ? speakerFilterElement
    : null;
let adminReceipts: ReceiptItem[] = [];

if (adminRoot) void loadAdminReceipts();
statusFilter?.addEventListener("change", renderAdminList);
speakerFilter?.addEventListener("change", renderAdminList);
document
  .querySelector("[data-receipt-refresh]")
  ?.addEventListener("click", () => {
    void (adminRoot ? loadAdminReceipts() : loadSpeakerReceipts());
  });

uploadForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!uploadForm.reportValidity()) return;
  const form = new FormData(uploadForm);
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) {
    setStatus("Choose a receipt file up to 10 MB.", true);
    return;
  }
  const button = uploadForm.querySelector("button");
  if (button) button.disabled = true;
  setStatus("Uploading your receipt…");
  try {
    await request("/api/speaker/receipts", { method: "POST", body: form });
    uploadForm.reset();
    await loadSpeakerReceipts();
    setStatus(
      "Receipt submitted. The organizer will process it after the event.",
    );
  } catch (error) {
    showError(error);
  } finally {
    if (button) button.disabled = false;
  }
});

export async function loadSpeakerReceipts(): Promise<void> {
  if (!speakerList) return;
  try {
    const data = await request<ReceiptResponse>("/api/speaker/receipts");
    const canUpload = Boolean(data.enabled) && data.receipts.length < 30;
    if (uploadForm) uploadForm.hidden = !canUpload;
    const access = document.querySelector<HTMLElement>("[data-receipt-access]");
    if (access)
      access.textContent = !data.enabled
        ? "Receipt uploads are available when enabled by the organizer. Contact info@sdlcai.org if you expect to submit travel expenses."
        : data.receipts.length >= 30
          ? "You have reached the 30-receipt limit. Contact the organizer if you need to submit more."
          : `Uploads are open${data.upload_until ? ` until ${formatDate(data.upload_until)}` : ""}. You can remove an unprocessed receipt and upload a correction.`;
    speakerList.replaceChildren(
      ...data.receipts.map((receipt) => receiptCard(receipt, false)),
    );
    if (!data.receipts.length)
      append(
        speakerList,
        node(
          "p",
          "border border-ink p-5 text-muted",
          "You have not submitted any receipts yet.",
        ),
      );
  } catch (error) {
    showError(error);
  }
}

async function loadAdminReceipts(): Promise<void> {
  if (!adminRoot) return;
  setStatus("Loading receipts…");
  try {
    const data = await request<ReceiptResponse>("/api/admin/receipts");
    adminReceipts = data.receipts;
    const summary = document.querySelector("[data-receipt-summary]");
    const pending = data.receipts.filter(
      (receipt) => receipt.status === "submitted",
    ).length;
    if (summary)
      summary.textContent = `${pending} awaiting processing / ${data.receipts.length - pending} processed / ${data.receipts.length} total`;
    const accessList = document.querySelector("[data-receipt-speakers]");
    accessList?.replaceChildren(...(data.speakers ?? []).map(accessControl));
    if (speakerFilter) {
      const selected = speakerFilter.value;
      const names = new Map(
        (data.speakers ?? []).map((speaker) => [
          speaker.speaker_id,
          speaker.name,
        ]),
      );
      for (const receipt of data.receipts)
        if (!names.has(receipt.speaker_id))
          names.set(receipt.speaker_id, receipt.speaker_name);
      const all = node("option", "", "All speakers");
      all.value = "all";
      speakerFilter.replaceChildren(
        all,
        ...[...names].map(([id, name]) => {
          const option = node("option", "", name);
          option.value = id;
          return option;
        }),
      );
      speakerFilter.value = names.has(selected) ? selected : "all";
    }
    renderAdminList();
    setStatus("");
  } catch (error) {
    showError(error);
  }
}

function accessControl(speaker: ReceiptAccess): HTMLElement {
  const label = node("label", "flex items-start gap-3 border border-ink p-4");
  const checkbox = node("input", "mt-1 h-5 w-5 shrink-0 accent-current");
  checkbox.type = "checkbox";
  checkbox.checked = speaker.enabled;
  checkbox.addEventListener("change", async () => {
    checkbox.disabled = true;
    try {
      await mutation("/api/admin/receipts/access", "POST", {
        speaker_id: speaker.speaker_id,
        enabled: checkbox.checked,
      });
      setStatus(
        `Receipt uploads ${checkbox.checked ? "enabled" : "disabled"} for ${speaker.name}.`,
      );
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      showError(error);
    } finally {
      checkbox.disabled = false;
    }
  });
  append(
    label,
    checkbox,
    node("span", "min-w-0 break-words font-bold", speaker.name),
  );
  return label;
}

function renderAdminList(): void {
  const list = document.querySelector("[data-receipt-list]");
  if (!list) return;
  const receipts = adminReceipts.filter(
    (receipt) =>
      (statusFilter?.value === "all" ||
        receipt.status === statusFilter?.value) &&
      (speakerFilter?.value === "all" ||
        receipt.speaker_id === speakerFilter?.value),
  );
  list.replaceChildren(
    ...receipts.map((receipt) => receiptCard(receipt, true)),
  );
  if (!receipts.length)
    append(
      list,
      node(
        "p",
        "border border-ink p-5 text-muted",
        "No receipts match these filters.",
      ),
    );
}

function receiptCard(receipt: ReceiptItem, admin: boolean): HTMLElement {
  const card = node(
    "article",
    "grid min-w-0 gap-5 border border-ink p-5 md:p-7",
  );
  const top = node("div", "flex flex-wrap items-start justify-between gap-4");
  const title = node("div", "grid min-w-0 gap-2");
  if (admin)
    append(
      title,
      node("p", "text-sm font-bold uppercase text-muted", receipt.speaker_name),
    );
  append(
    title,
    node(
      admin ? "h3" : "h4",
      "break-words font-headline text-2xl font-black uppercase",
      receipt.description,
    ),
  );
  append(
    top,
    title,
    node(
      "span",
      "shrink-0 border border-ink px-3 py-2 text-xs font-bold uppercase",
      receipt.status === "processed" ? "Processed" : "Awaiting processing",
    ),
  );
  append(card, top);
  append(
    card,
    node(
      "p",
      "text-lg font-bold",
      `${receipt.amount} ${receipt.currency} / ${formatDate(receipt.expense_date)}`,
    ),
  );
  append(
    card,
    node(
      "p",
      "break-words text-sm text-muted",
      `${receipt.filename} / ${Math.ceil(receipt.byte_size / 1024)} KB / Submitted ${formatDate(receipt.created_at)}`,
    ),
  );
  if (receipt.note)
    append(
      card,
      node(
        "p",
        "whitespace-pre-wrap break-words text-sm leading-6",
        `Speaker note: ${receipt.note}`,
      ),
    );
  if (receipt.organizer_note && !admin)
    append(
      card,
      node(
        "p",
        "whitespace-pre-wrap break-words border-l-2 border-ink pl-4 text-sm leading-6",
        `Organizer note: ${receipt.organizer_note}`,
      ),
    );
  if (receipt.processed_at)
    append(
      card,
      node(
        "p",
        "text-sm text-muted",
        `Processed ${formatDate(receipt.processed_at)}`,
      ),
    );
  const actions = node("div", "flex flex-wrap gap-3");
  const download = node(
    "a",
    "border border-ink px-4 py-3 text-sm font-bold uppercase",
    "Download receipt",
  );
  download.href = receipt.download_url;
  download.setAttribute("download", "");
  append(actions, download);
  if (admin || receipt.status === "submitted") {
    const remove = node(
      "button",
      "border border-ink px-4 py-3 text-sm font-bold uppercase disabled:opacity-60",
      "Delete receipt",
    );
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (
        !window.confirm(
          `Delete “${receipt.description}” and its file?${admin ? " Download any records you need first." : " You can upload a corrected receipt afterwards."}`,
        )
      )
        return;
      remove.disabled = true;
      try {
        await mutation(
          `${admin ? "/api/admin" : "/api/speaker"}/receipts/${receipt.receipt_id}`,
          "DELETE",
          { revision: receipt.revision },
        );
        await (admin ? loadAdminReceipts() : loadSpeakerReceipts());
        setStatus("Receipt removed.");
      } catch (error) {
        showError(error);
        remove.disabled = false;
      }
    });
    append(actions, remove);
  }
  append(card, actions);
  if (admin) {
    const form = node("form", "grid gap-4 border-t border-ink pt-5");
    const label = node("label", "grid gap-2");
    append(
      label,
      node(
        "span",
        "text-sm font-bold uppercase",
        "Processing note (visible to speaker)",
      ),
    );
    const note = node(
      "textarea",
      "min-h-24 min-w-0 resize-y border border-ink bg-paper p-3 text-sm",
    );
    note.maxLength = 2000;
    note.value = receipt.organizer_note;
    append(label, note);
    append(form, label);
    const row = node("div", "flex flex-wrap items-end gap-3");
    const stateLabel = node("label", "grid gap-2");
    append(
      stateLabel,
      node("span", "text-sm font-bold uppercase", "Processing status"),
    );
    const select = node(
      "select",
      "border border-ink bg-paper px-4 py-3 text-sm",
    );
    select.setAttribute("aria-label", "Processing status");
    for (const [value, text] of [
      ["submitted", "Awaiting processing"],
      ["processed", "Processed"],
    ] as const) {
      const option = node("option", "", text);
      option.value = value;
      append(select, option);
    }
    select.value = receipt.status;
    append(stateLabel, select);
    const save = node(
      "button",
      "border border-ink bg-ink px-4 py-3 text-sm font-bold uppercase text-paper disabled:opacity-60",
      "Save processing",
    );
    save.type = "submit";
    append(row, stateLabel, save);
    append(form, row);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      try {
        await mutation(`/api/admin/receipts/${receipt.receipt_id}`, "PATCH", {
          revision: receipt.revision,
          status: select.value,
          organizer_note: note.value,
        });
        await loadAdminReceipts();
        setStatus(`Processing saved for ${receipt.speaker_name}.`);
      } catch (error) {
        showError(error);
        save.disabled = false;
      }
    });
    append(card, form);
  }
  return card;
}

async function request<T = { message?: string }>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  let data: T & { error?: string };
  try {
    data = (await response.json()) as T & { error?: string };
  } catch {
    throw new Error("Receipts are unavailable. Please refresh and try again.");
  }
  if (!response.ok)
    throw new Error(
      data.error ?? "Receipt request failed. Refresh and try again.",
    );
  return data;
}

function mutation(
  url: string,
  method: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  return request(url, {
    method,
    body: JSON.stringify(data),
    headers: {
      "content-type": "application/json",
      ...(url.startsWith("/api/admin/")
        ? { "x-admin-action": "manage-speaker-receipts" }
        : {}),
    },
  });
}
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Europe/Helsinki",
  }).format(new Date(value));
}
function setStatus(message: string, error = false): void {
  if (status) {
    status.textContent = error ? `Error: ${message}` : message;
  }
}
function showError(error: unknown): void {
  setStatus(
    error instanceof Error
      ? error.message
      : "Receipts could not be loaded. Please try again.",
    true,
  );
}

function append(parent: Node, ...children: Node[]): void {
  for (const child of children) parent.appendChild(child);
}
