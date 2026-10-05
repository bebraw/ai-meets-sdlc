import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, webkit } from "playwright";
import { unzipSync } from "fflate";
import {
  is4kPng,
  videoExportManifestPath,
} from "../site/scripts/video-export-contract.ts";

const buildDir = path.resolve("build");
const outputDir = path.join(tmpdir(), "sdlcai-video-qa");
const manifest = JSON.parse(
  await readFile(path.join(buildDir, "assets/social/manifest.json"), "utf8"),
);
const assets = manifest.assets
  .filter((asset) => asset.presetId === "video")
  .sort((a, b) => a.slideNumber - b.slideNumber)
  .map((asset, index) => ({
    ...asset,
    filename: `${String(index + 1).padStart(2, "0")}-${asset.slideId}.png`,
  }));
for (const asset of assets) {
  const bytes = await readFile(path.join(buildDir, asset.path));
  assert.ok(
    is4kPng(bytes),
    `${asset.slideId}: run npm run slides:export:video first`,
  );
}
const exportManifest = {
  filename: `sdlcai-2026-session-slides-4k-${manifest.version.slice(0, 12)}.zip`,
  assets,
};
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  let file = path.join(buildDir, decodeURIComponent(url.pathname));
  if (!file.startsWith(`${buildDir}/`)) {
    response.writeHead(404).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    await stat(file);
    response.writeHead(200, {
      "content-type": types[path.extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const candidates = [
  process.env.LAYOUT_BROWSER_PATH,
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  chromium.executablePath(),
].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
  try {
    await stat(candidate);
    executablePath = candidate;
    break;
  } catch {
    /* Try the next installed browser. */
  }
}
async function checkDownload(browser, engine) {
  const engineOutputDir = path.join(outputDir, engine);
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`**${videoExportManifestPath}`, (route) =>
      route.fulfill({ json: exportManifest }),
    );
    // Social thumbnails are not part of the video export under test.
    await page.route("**/assets/social/*/*.jpg", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="627"><rect width="1200" height="627" fill="#080808"/></svg>',
      }),
    );
    await page.goto(`${origin}/slides/`);
    const start = page.locator("[data-video-download-start]");
    const status = page.locator("[data-video-download-status]");
    const cancel = page.locator("[data-video-download-cancel]");
    assert.equal(await start.isVisible(), true);
    assert.equal(
      await page.locator('a[download][href$=".png"]').count(),
      assets.length,
    );
    await mkdir(engineOutputDir, { recursive: true });
    await page.screenshot({
      path: path.join(engineOutputDir, "library-desktop.png"),
    });
    let retry = true;
    await page.route("**/assets/social/video/*.png?*", async (route) => {
      if (retry) {
        retry = false;
        await route.fulfill({ status: 503, body: "Retry" });
      } else await route.continue();
    });
    const download = page.waitForEvent("download", { timeout: 120_000 });
    await start.click();
    const result = await download;
    assert.equal(result.suggestedFilename(), exportManifest.filename);
    const zip = unzipSync(new Uint8Array(await readFile(await result.path())));
    assert.deepEqual(
      Object.keys(zip),
      assets.map((asset) => asset.filename),
    );
    for (const asset of assets) {
      assert.ok(is4kPng(zip[asset.filename]));
      assert.deepEqual(
        Buffer.from(zip[asset.filename]),
        await readFile(path.join(buildDir, asset.path)),
      );
    }
    await page.waitForFunction(() =>
      document
        .querySelector("[data-video-download-status]")
        .textContent.includes("download has started"),
    );
    assert.equal(await cancel.isVisible(), false);

    await page.unroute("**/assets/social/video/*.png?*");
    await page.route("**/assets/social/video/*.png?*", (route) =>
      route.fulfill({ status: 409, body: "Changed" }),
    );
    await start.click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-video-download-status]")
        .textContent.includes("slides changed"),
    );
    assert.equal(await start.isEnabled(), true);
    await page.unroute("**/assets/social/video/*.png?*");
    await page.route("**/assets/social/video/*.png?*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue().catch(() => {});
    });
    await start.click();
    await cancel.click();
    await page.waitForFunction(() =>
      document
        .querySelector("[data-video-download-status]")
        .textContent.includes("cancelled"),
    );
    assert.equal(await start.isEnabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("[data-video-download]").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(engineOutputDir, "library-mobile.png"),
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.match(await status.textContent(), /cancelled/u);
    await page.goto(`${origin}/admin-slides/`);
    assert.equal(
      await page.locator("[data-video-download-start]").isVisible(),
      true,
    );
    await page.screenshot({
      path: path.join(engineOutputDir, "admin-mobile.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      `${engine} video browser check passed: ${assets.length} real 4K PNGs in order, ZIP integrity, transient retry, edit recovery, cancellation, public/admin controls, and mobile layout.`,
    );
  } finally {
    await browser.close();
  }
}
try {
  await checkDownload(
    await chromium.launch({ executablePath, headless: true }),
    "chromium",
  );
  await checkDownload(await webkit.launch({ headless: true }), "webkit");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
