import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceSvgPath = path.join(
  rootDir,
  "assets/slides/source/sdlcai-2026-screen-ad.svg",
);
const svgPath = path.join(rootDir, "assets/slides/sdlcai-2026-screen-ad.svg");
const outputDir = path.join(rootDir, "output/pdf");
const outputPdf = path.join(outputDir, "sdlcai-2026-screen-ad.pdf");
const publicPdf = path.join(rootDir, "assets/slides/sdlcai-2026-screen-ad.pdf");

await mkdir(outputDir, { recursive: true });

const inlineAssets = [
  {
    reference: "../fonts/FinlandicaHeadline-Black.woff2",
    mimeType: "font/woff2",
    file: path.join(rootDir, "assets/fonts/FinlandicaHeadline-Black.woff2"),
  },
  {
    reference: "../fonts/FinlandicaText-Regular.woff2",
    mimeType: "font/woff2",
    file: path.join(rootDir, "assets/fonts/FinlandicaText-Regular.woff2"),
  },
  {
    reference: "../fonts/FinlandicaText-Bold.woff2",
    mimeType: "font/woff2",
    file: path.join(rootDir, "assets/fonts/FinlandicaText-Bold.woff2"),
  },
  {
    reference: "aalto-school-of-science.png",
    mimeType: "image/png",
    file: path.join(rootDir, "assets/slides/aalto-school-of-science.png"),
  },
  {
    reference: "registration-qr.png",
    mimeType: "image/png",
    file: path.join(rootDir, "assets/slides/registration-qr.png"),
  },
];

let svg = await readFile(sourceSvgPath, "utf8");

for (const asset of inlineAssets) {
  const bytes = await readFile(asset.file);
  const dataUri = `data:${asset.mimeType};base64,${bytes.toString("base64")}`;
  svg = svg.replaceAll(asset.reference, dataUri);
}

await writeFile(svgPath, svg);

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });

  await page.goto(pathToFileURL(svgPath).href, { waitUntil: "networkidle" });
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => document.fonts.ready);

  await page.pdf({
    path: outputPdf,
    width: "13.333333in",
    height: "7.5in",
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: false,
  });
} finally {
  await browser.close();
}

await copyFile(outputPdf, publicPdf);

console.log(`Generated ${path.relative(rootDir, svgPath)}`);
console.log(`Exported ${path.relative(rootDir, outputPdf)}`);
console.log(`Updated ${path.relative(rootDir, publicPdf)}`);
