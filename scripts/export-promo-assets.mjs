import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const sourceDir = path.join(root, "assets/social/source");
const outputDir = path.join(root, "assets/social/exports");
const assets = [
  {
    name: "sdlcai-2026-bsky-x",
    label: "BLUESKY / X",
    width: 1600,
    height: 900,
  },
  {
    name: "sdlcai-2026-facebook",
    label: "FACEBOOK / LANDSCAPE",
    width: 1200,
    height: 630,
  },
  {
    name: "sdlcai-2026-square",
    label: "SQUARE / ALL THREE PLATFORMS",
    width: 1080,
    height: 1080,
  },
];

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.LAYOUT_BROWSER_PATH
    ? { executablePath: process.env.LAYOUT_BROWSER_PATH }
    : {}),
});

try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const asset of assets) {
    await page.setViewportSize({ width: asset.width, height: asset.height });
    await page.goto(
      pathToFileURL(path.join(sourceDir, `${asset.name}.svg`)).href,
      {
        waitUntil: "networkidle",
      },
    );
    // Fail on missing brand fonts, missing logo, or text outside its intended area.
    const problems = await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('900 32px "Finlandica Headline"'),
        document.fonts.load('400 32px "Finlandica Text"'),
        document.fonts.load('700 32px "Finlandica Text"'),
      ]);
      await document.fonts.ready;
      const problems = [];
      if ([...document.fonts].some((font) => font.status !== "loaded")) {
        problems.push("A Finlandica font failed to load");
      }
      for (const image of document.querySelectorAll("image")) {
        const decoded = new Image();
        decoded.src = new URL(
          image.getAttribute("href"),
          document.baseURI,
        ).href;
        await decoded.decode();
      }
      for (const text of document.querySelectorAll("text[data-safe]")) {
        const [x, y, width, height] = text
          .getAttribute("data-safe")
          .split(" ")
          .map(Number);
        // SVG getBBox includes the font's full em box. Measure visible glyphs
        // so empty ascender/descender space does not produce false overflows.
        const canvas = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas",
        );
        const context = canvas.getContext("2d");
        const style = getComputedStyle(text);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.letterSpacing =
          style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
        const metrics = context.measureText(text.textContent.trim());
        const anchor =
          style.textAnchor === "middle"
            ? metrics.width / 2
            : style.textAnchor === "end"
              ? metrics.width
              : 0;
        const box = {
          x:
            Number(text.getAttribute("x")) -
            anchor -
            metrics.actualBoundingBoxLeft,
          y: Number(text.getAttribute("y")) - metrics.actualBoundingBoxAscent,
          width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
          height:
            metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        };
        if (
          box.x < x ||
          box.y < y ||
          box.x + box.width > x + width ||
          box.y + box.height > y + height
        ) {
          problems.push(
            `${text.textContent.trim()} exceeds its safe area: ${JSON.stringify({ x: box.x, y: box.y, width: box.width, height: box.height })}`,
          );
        }
      }
      return problems;
    });
    if (problems.length)
      throw new Error(`${asset.name}: ${problems.join("; ")}`);

    const output = path.join(outputDir, `${asset.name}.png`);
    await page.screenshot({ path: output, type: "png", fullPage: false });
    const bytes = (await stat(output)).size;
    // Keep all three exports within the project's conservative Bluesky budget.
    if (bytes >= 1_000_000)
      throw new Error(`${asset.name} exceeds the 1 MB export budget`);
    console.log(
      `${asset.name}.png — ${asset.width} × ${asset.height}, ${Math.round(bytes / 1024)} KB`,
    );
  }

  const cards = [];
  for (const asset of assets) {
    const buffer = await readFile(path.join(outputDir, `${asset.name}.png`));
    cards.push(
      `<figure><figcaption>${asset.label} <span>${asset.width} × ${asset.height}</span></figcaption><img src="data:image/png;base64,${buffer.toString("base64")}" alt="${asset.label}" /></figure>`,
    );
  }
  await page.setViewportSize({ width: 1600, height: 1580 });
  await page.goto("about:blank");
  await page.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><title>SDLCAI social graphics</title><style>
    * { box-sizing: border-box; } body { margin: 0; padding: 48px; background: #232323; color: #f6f4ef; font: 22px sans-serif; }
    h1 { font-size: 28px; margin: 0 0 36px; } main { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
    figure { margin: 0; } figure:first-child { grid-column: 1 / -1; width: 1120px; }
    figcaption { font-size: 16px; letter-spacing: 1px; margin-bottom: 12px; } span { float: right; color: #b7b0a4; } img { display: block; width: 100%; }
    </style><h1>SDLCAI 2026 / SOCIAL GRAPHICS</h1><main>${cards.join("")}</main></html>`);
  await page.evaluate(() =>
    Promise.all([...document.images].map((image) => image.decode())),
  );
  await page.screenshot({
    path: path.join(outputDir, "sdlcai-2026-preview.png"),
    type: "png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
