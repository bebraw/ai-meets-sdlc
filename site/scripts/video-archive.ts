import { Zip, ZipPassThrough } from "fflate";
import { is4kPng, type VideoExportManifest } from "./video-export-contract.ts";

// PNGs are already compressed. Store them in the ZIP without recompressing or
// buffering another full copy of each image in JavaScript.
export async function buildVideoArchive(
  manifest: VideoExportManifest,
  signal: AbortSignal,
  onProgress: (current: number, total: number) => void,
): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let zipError: Error | undefined;
  let complete = false;
  const zip = new Zip((error, data, final) => {
    if (error) zipError = error;
    else chunks.push(new Uint8Array(data));
    complete = final;
  });
  try {
    for (const [index, asset] of manifest.assets.entries()) {
      signal.throwIfAborted();
      onProgress(index + 1, manifest.assets.length);
      const url = new URL(asset.path, location.origin);
      url.searchParams.set("v", asset.version);
      url.searchParams.set("snapshot", "1");
      const response = await fetchSlide(url, signal);
      if (
        response.status === 409 ||
        new URL(response.url).searchParams.get("v") !== asset.version
      ) {
        await response.body?.cancel();
        throw new Error(
          "The slides changed during export. Please restart the download.",
        );
      }
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.startsWith("image/png")
      ) {
        await response.body?.cancel();
        throw new Error(
          `Could not prepare slide ${index + 1}. Please try again.`,
        );
      }

      const reader = response.body.getReader();
      const entry = new ZipPassThrough(asset.filename);
      // A fixed timestamp makes identical snapshots produce identical archives.
      entry.mtime = new Date("2026-01-01T00:00:00Z");
      zip.add(entry);
      const header = new Uint8Array(24);
      let headerBytes = 0;
      let totalBytes = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { value, done } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > 40 * 1024 * 1024)
            throw new Error(`Slide ${index + 1} exceeds the download limit.`);
          const count = Math.min(value.byteLength, header.length - headerBytes);
          header.set(value.subarray(0, count), headerBytes);
          headerBytes += count;
          if (headerBytes === 24 && !is4kPng(header))
            throw new Error(
              `Slide ${index + 1} is not a valid 4K PNG. Please try again.`,
            );
          entry.push(value);
          if (zipError) throw zipError;
        }
        if (!is4kPng(header) || headerBytes !== 24)
          throw new Error(
            `Slide ${index + 1} is incomplete. Please try again.`,
          );
        entry.push(new Uint8Array(), true);
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    zip.end();
    if (zipError) throw zipError;
    if (!complete)
      throw new Error("Could not finish the slide archive. Please try again.");
    return new Blob(chunks, { type: "application/zip" });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

async function fetchSlide(url: URL, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    if (![429, 503].includes(response.status) || attempt >= 2) return response;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 2000);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
