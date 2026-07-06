import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(root, "assets", "social");
const outDir = path.join(sourceDir, "exports");
const assets = ["bsky-header-og.svg"];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 3000, height: 1000 },
  deviceScaleFactor: 1,
});

for (const asset of assets) {
  await page.goto(pathToFileURL(path.join(sourceDir, asset)).href);
  await page.screenshot({
    path: path.join(outDir, asset.replace(".svg", ".png")),
    type: "png",
    fullPage: false,
  });
}

await browser.close();
