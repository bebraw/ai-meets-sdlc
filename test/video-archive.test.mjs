import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";
import { buildVideoArchive } from "../site/scripts/video-archive.ts";
import { parseVideoExportManifest } from "../site/scripts/video-export-contract.ts";

const manifest = {
  filename: "sdlcai-2026-session-slides-4k-123456789abc.zip",
  assets: ["event", "talk-fixed-later"].map((slideId, index) => ({
    slideId,
    path: `/assets/social/video/sdlcai-2026-${slideId}-video-3840x2160.png`,
    version: String(index + 1).repeat(64),
    filename: `${String(index + 1).padStart(2, "0")}-${slideId}.png`,
  })),
};

function pngHeader(width = 3840) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, 2160);
  return bytes;
}

function imageResponse(url, bytes = pngHeader()) {
  // Split even the PNG header across reads to exercise streamed downloads.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, 7));
      controller.enqueue(bytes.slice(7));
      controller.close();
    },
  });
  const response = new Response(stream, {
    headers: { "content-type": "image/png" },
  });
  Object.defineProperty(response, "url", { value: url.href });
  return response;
}

function mockBrowser(t, fetch) {
  const original = globalThis.location;
  globalThis.location = { origin: "https://sdlcai.org" };
  t.after(() => {
    if (original === undefined) delete globalThis.location;
    else globalThis.location = original;
  });
  t.mock.method(globalThis, "fetch", fetch);
}

test("ZIP downloads preserve manifest order, versioned URLs, filenames, and PNG bytes", async (t) => {
  const urls = [];
  mockBrowser(t, async (url) => {
    urls.push(url);
    return imageResponse(url);
  });
  const progress = [];
  const zip = await buildVideoArchive(
    parseVideoExportManifest(manifest),
    new AbortController().signal,
    (current, total) => progress.push([current, total]),
  );
  assert.equal(zip.type, "application/zip");
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.deepEqual(
    Object.keys(entries),
    manifest.assets.map((asset) => asset.filename),
  );
  for (const bytes of Object.values(entries))
    assert.deepEqual(bytes, pngHeader());
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);
  assert.deepEqual(
    urls.map((url) => url.searchParams.get("v")),
    manifest.assets.map((asset) => asset.version),
  );
  assert.ok(urls.every((url) => url.searchParams.get("snapshot") === "1"));
});

test("ZIP exports reject edits during export, wrong dimensions, and cancellation", async (t) => {
  mockBrowser(t, async () => new Response("Changed", { status: 409 }));
  await assert.rejects(
    buildVideoArchive(manifest, new AbortController().signal, () => {}),
    /slides changed/u,
  );
  t.mock.method(globalThis, "fetch", async (url) =>
    imageResponse(url, pngHeader(1920)),
  );
  await assert.rejects(
    buildVideoArchive(manifest, new AbortController().signal, () => {}),
    /valid 4K PNG/u,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    buildVideoArchive(manifest, controller.signal, () => {}),
    { name: "AbortError" },
  );
});

test("export manifests reject foreign paths, duplicate slides, and unsafe archive filenames", () => {
  for (const edit of [
    (value) => {
      value.assets[0].path = "https://other.example/image.png";
    },
    (value) => {
      value.assets[1] = value.assets[0];
    },
    (value) => {
      value.assets[0].filename = "../slide.png";
    },
  ]) {
    const invalid = structuredClone(manifest);
    edit(invalid);
    assert.throws(() => parseVideoExportManifest(invalid), /Invalid/u);
  }
});
