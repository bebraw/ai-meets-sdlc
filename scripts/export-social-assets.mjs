import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDir = path.join(root, "assets", "social");
const outDir = path.join(sourceDir, "exports");
const assets = [
  { filename: "bsky-header-og.svg", width: 3000, height: 1000 },
  { filename: "linkedin-header.svg", width: 1128, height: 191 },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

for (const { filename, width, height } of assets) {
  await page.setViewportSize({ width, height });
  await page.goto(pathToFileURL(path.join(sourceDir, filename)).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: path.join(outDir, filename.replace(".svg", ".png")),
    type: "png",
    fullPage: false,
  });
}

await browser.close();
