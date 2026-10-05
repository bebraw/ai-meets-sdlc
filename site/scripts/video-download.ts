import { buildVideoArchive } from "./video-archive.ts";
import {
  parseVideoExportManifest,
  videoExportManifestPath,
} from "./video-export-contract.ts";

for (const root of document.querySelectorAll<HTMLElement>(
  "[data-video-download]",
)) {
  const button = root.querySelector<HTMLButtonElement>(
    "[data-video-download-start]",
  );
  const cancel = root.querySelector<HTMLButtonElement>(
    "[data-video-download-cancel]",
  );
  const status = root.querySelector<HTMLElement>(
    "[data-video-download-status]",
  );
  if (!button || !cancel || !status) continue;
  button.hidden = false;
  let controller: AbortController | undefined;
  cancel.addEventListener("click", () => controller?.abort());
  button.addEventListener("click", async () => {
    if (controller) return;
    controller = new AbortController();
    const signal = controller.signal;
    button.disabled = true;
    cancel.hidden = false;
    status.textContent = "Preparing your 4K slides. Keep this page open.";
    try {
      const response = await fetch(videoExportManifestPath, {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok)
        throw new Error(
          "Slides are temporarily unavailable. Please try again.",
        );
      const manifest = parseVideoExportManifest(await response.json());
      const blob = await buildVideoArchive(
        manifest,
        signal,
        (current, total) => {
          status.textContent = `Preparing slide ${current} of ${total}. Keep this page open.`;
        },
      );
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = manifest.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = `${manifest.assets.length} slides ready. Your ZIP download has started.`;
    } catch (error) {
      status.textContent = signal.aborted
        ? "Download cancelled. You can start again."
        : error instanceof Error
          ? error.message
          : "Could not download the slides. Please try again.";
    } finally {
      controller = undefined;
      button.disabled = false;
      cancel.hidden = true;
      if (signal.aborted) button.focus();
    }
  });
}
