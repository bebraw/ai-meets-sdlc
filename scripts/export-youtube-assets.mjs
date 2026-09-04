import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright";

const rootDir = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(rootDir, "assets", "youtube", "source");
const outputDir = path.join(rootDir, "assets", "youtube", "exports");

const assets = [
  {
    filename: "sdlcai-2026-thumbnail.svg",
    width: 3840,
    height: 2160,
  },
  {
    filename: "sdlcai-2026-starting-soon.svg",
    width: 1920,
    height: 1080,
  },
  {
    filename: "sdlcai-2026-short-break.svg",
    width: 1920,
    height: 1080,
  },
  {
    filename: "sdlcai-2026-thanks.svg",
    width: 1920,
    height: 1080,
  },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

try {
  for (const { filename, width, height } of assets) {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });

    await page.goto(pathToFileURL(path.join(sourceDir, filename)).href, {
      waitUntil: "networkidle",
    });
    await page.evaluate(() => document.fonts.ready);

    const fitErrors = await page
      .locator("[data-fit-frame]")
      .evaluateAll((elements) =>
        elements.flatMap((element) => {
          const frameId = element.getAttribute("data-fit-frame");
          const frame = frameId ? document.getElementById(frameId) : null;

          if (!frame) {
            return [`Missing frame ${frameId ?? "(unspecified)"}`];
          }

          const contentBounds = element.getBBox();
          const frameBounds = frame.getBBox();
          const padding = Number(element.getAttribute("data-fit-padding") ?? 0);
          const fitsHorizontally =
            contentBounds.x >= frameBounds.x + padding &&
            contentBounds.x + contentBounds.width <=
              frameBounds.x + frameBounds.width - padding;
          if (fitsHorizontally) {
            return [];
          }

          return [
            `${element.textContent.trim()} does not fit within #${frameId}`,
          ];
        }),
      );

    if (fitErrors.length > 0) {
      throw new Error(`${filename}: ${fitErrors.join("; ")}`);
    }

    await page.screenshot({
      path: path.join(outputDir, filename.replace(".svg", ".png")),
      type: "png",
      fullPage: false,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(
  `Exported ${assets.length} YouTube assets to ${path.relative(rootDir, outputDir)}`,
);
