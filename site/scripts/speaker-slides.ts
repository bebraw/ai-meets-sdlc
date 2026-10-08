import {
  maxSlideFileBytes,
  slideFormatFromFilename,
  slideFormatLabel,
  type SpeakerSlideFile,
} from "./speaker-slides-model.ts";

interface SlideResponse {
  error?: string;
  message?: string;
  slides?: SpeakerSlideFile[];
}

export async function loadSpeakerSlides(
  talks: readonly { id: string; title: string }[],
): Promise<void> {
  const container = document.querySelector<HTMLElement>(
    "[data-speaker-slide-files]",
  );
  const status = document.querySelector<HTMLElement>(
    "[data-speaker-slides-status]",
  );
  if (!container) return;
  const response = await requestSlides("/api/speaker/slides");
  if (!response.ok || !response.data.slides) {
    setStatus(
      status,
      response.data.error ?? "Slides could not be loaded.",
      true,
    );
    return;
  }
  const files = response.data.slides;
  container.replaceChildren(
    ...talks.map((talk) => renderTalk(talk, files, talks)),
  );
}

function renderTalk(
  talk: { id: string; title: string },
  files: SpeakerSlideFile[],
  talks: readonly { id: string; title: string }[],
): HTMLElement {
  const card = node(
    "article",
    "grid min-w-0 gap-5 border border-ink p-5 md:p-7",
  );
  card.dataset.slideTalk = talk.id;
  card.appendChild(
    node("h3", "font-headline text-2xl font-black uppercase", talk.title),
  );
  const talkFiles = files.filter((file) => file.talk_id === talk.id);
  const list = node("div", "grid gap-3");
  for (const format of ["pdf", "powerpoint"] as const) {
    const file = talkFiles.find((item) => item.format === format);
    const item = node("div", "grid min-w-0 gap-2 border-l-4 border-ink pl-4");
    item.appendChild(node("strong", "uppercase", slideFormatLabel(format)));
    if (!file) {
      item.appendChild(node("p", "text-sm text-muted", "No file uploaded."));
    } else {
      item.appendChild(
        node(
          "p",
          "break-words text-sm text-muted",
          `${file.filename} · ${(file.byte_size / (1024 * 1024)).toFixed(1)} MB`,
        ),
      );
      item.appendChild(
        node(
          "p",
          "text-sm font-bold",
          file.published_at
            ? "Published on the schedule"
            : file.may_publish
              ? "Private · PDF publication allowed"
              : "Private · venue use only",
        ),
      );
      const actions = node("div", "flex flex-wrap gap-3");
      const download = node(
        "a",
        "border border-ink px-3 py-2 text-sm font-bold uppercase",
        `Download ${slideFormatLabel(format)}`,
      );
      download.href = file.download_url;
      const remove = node(
        "button",
        "border border-ink px-3 py-2 text-sm font-bold uppercase disabled:opacity-50",
        `Remove ${slideFormatLabel(format)}`,
      );
      remove.type = "button";
      remove.addEventListener("click", async () => {
        if (
          !window.confirm(
            `Remove ${file.filename}? Any public schedule link will also be removed.`,
          )
        )
          return;
        remove.disabled = true;
        const response = await requestSlides(file.download_url, {
          method: "DELETE",
        });
        remove.disabled = false;
        setGlobalStatus(
          response.data.message ??
            response.data.error ??
            "Slides could not be removed.",
          !response.ok,
        );
        if (response.ok) await loadSpeakerSlides(talks);
      });
      actions.appendChild(download);
      actions.appendChild(remove);
      item.appendChild(actions);
    }
    list.appendChild(item);
  }
  card.appendChild(list);

  const form = node("form", "grid gap-4 border-t border-ink pt-5");
  const label = node(
    "label",
    "grid gap-2 font-bold uppercase",
    "Presentation file (PDF or .pptx, up to 25 MB)",
  );
  const input = node(
    "input",
    "min-w-0 w-full border border-ink bg-paper p-3 text-sm font-normal normal-case",
  );
  input.type = "file";
  input.accept =
    ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";
  input.required = true;
  label.appendChild(input);
  form.appendChild(label);
  const permissionLabel = node(
    "label",
    "grid grid-cols-[auto_1fr] items-start gap-3 border border-ink p-4",
  );
  const permission = node("input", "mt-1 h-5 w-5");
  permission.type = "checkbox";
  const permissionText = node("span", "grid gap-1");
  permissionText.appendChild(
    node("strong", "uppercase", "Allow this PDF to be published with my talk"),
  );
  permissionText.appendChild(
    node(
      "span",
      "text-sm leading-6 text-muted",
      "Optional. Organizers can add it to the public schedule after review. Leave unchecked for venue use only. PowerPoint files remain private.",
    ),
  );
  permissionLabel.appendChild(permission);
  permissionLabel.appendChild(permissionText);
  form.appendChild(permissionLabel);
  const hint = node(
    "p",
    "text-sm leading-6 text-muted",
    "Uploading the same format replaces its existing file. A replacement PDF stays private until an organizer publishes it again.",
  );
  form.appendChild(hint);
  const actions = node(
    "div",
    "grid gap-3 sm:grid-cols-[auto_1fr] sm:items-center",
  );
  const upload = node(
    "button",
    "border border-ink bg-ink px-5 py-3 font-bold uppercase text-paper disabled:opacity-50",
    "Upload slides",
  );
  upload.type = "submit";
  const status = node("p", "min-h-6 text-sm font-bold");
  status.setAttribute("aria-live", "polite");
  actions.appendChild(upload);
  actions.appendChild(status);
  form.appendChild(actions);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    const format = file ? slideFormatFromFilename(file.name) : null;
    permissionLabel.hidden = format === "powerpoint";
    permission.disabled = format === "powerpoint";
    if (format !== "pdf") permission.checked = false;
    upload.textContent =
      format && talkFiles.some((item) => item.format === format)
        ? `Replace ${slideFormatLabel(format)}`
        : "Upload slides";
    setStatus(status, "");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const file = input.files?.[0];
    const format = file ? slideFormatFromFilename(file.name) : null;
    if (!file || !format) {
      setStatus(status, "Choose a PDF or PowerPoint (.pptx) file.", true);
      return;
    }
    if (file.size === 0 || file.size > maxSlideFileBytes) {
      setStatus(
        status,
        "Choose a non-empty file that is 25 MB or smaller.",
        true,
      );
      return;
    }
    const existing = talkFiles.find((item) => item.format === format);
    const params = new URLSearchParams({
      talk_id: talk.id,
      filename: file.name,
      replaces_slide_id: existing?.slide_id ?? "",
      may_publish: format === "pdf" && permission.checked ? "1" : "0",
    });
    upload.disabled = true;
    input.disabled = true;
    permission.disabled = true;
    setStatus(status, "Uploading slides…");
    const response = await requestSlides(`/api/speaker/slides?${params}`, {
      method: "POST",
      body: file,
      headers: {
        "content-type":
          format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      },
    });
    upload.disabled = false;
    input.disabled = false;
    permission.disabled = format === "powerpoint";
    if (!response.ok) {
      setStatus(
        status,
        response.data.error ?? "Slides could not be uploaded.",
        true,
      );
      return;
    }
    setGlobalStatus(response.data.message ?? "Slides uploaded privately.");
    await loadSpeakerSlides(talks);
  });
  card.appendChild(form);
  return card;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function setStatus(
  element: HTMLElement | null,
  message: string,
  error = false,
): void {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("text-signal", error);
}

function setGlobalStatus(message: string, error = false): void {
  setStatus(
    document.querySelector("[data-speaker-slides-status]"),
    message,
    error,
  );
}

async function requestSlides(
  url: string,
  options: RequestInit = {},
): Promise<{ ok: boolean; data: SlideResponse }> {
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
    });
    return { ok: response.ok, data: (await response.json()) as SlideResponse };
  } catch {
    return {
      ok: false,
      data: { error: "Unable to reach the slides service. Try again." },
    };
  }
}
