import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { getTalkGraphics } from "../site/talk-graphics.ts";
import {
  graphicsDirectory,
  graphicsRoot,
  graphicInputVersion,
  renderTalkGraphic,
} from "./talk-graphics.mjs";

const directory = path.join(graphicsRoot, graphicsDirectory);
const temporary = path.join(graphicsRoot, ".cache/talk-graphics");
await mkdir(path.join(directory, "exports"), { recursive: true });
await mkdir(temporary, { recursive: true });
let executablePath;
for (const candidate of [
  process.env.LAYOUT_BROWSER_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  chromium.executablePath(),
].filter(Boolean)) {
  try {
    await access(candidate);
    executablePath = candidate;
    break;
  } catch {}
}
const browser = await chromium.launch({ executablePath });
const manifest = {
  schemaVersion: 1,
  inputVersion: await graphicInputVersion(),
  assets: [],
};
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const card of getTalkGraphics()) {
    for (const asset of card.assets) {
      const filename = `${card.id}-${asset.id}.png`;
      const source = path.join(temporary, `${filename}.html`);
      await writeFile(
        source,
        renderTalkGraphic(
          card,
          asset,
          (url) => pathToFileURL(path.join(graphicsRoot, url.slice(1))).href,
        ),
      );
      await page.setViewportSize({ width: asset.width, height: asset.height });
      await page.goto(pathToFileURL(source).href);
      const issues = await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
        const issues = [];
        if ([...document.fonts].some((font) => font.status !== "loaded"))
          issues.push("Font did not load");
        const footer = document.querySelector("footer").getBoundingClientRect();
        for (const el of document.querySelectorAll("[data-fit]")) {
          const bounds = el.getBoundingClientRect();
          const container = el
            .closest(".point, .intro")
            .getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          if (
            Array.from(range.getClientRects()).some(
              (r) =>
                r.left < bounds.left - 1 ||
                r.right > bounds.right + 1 ||
                r.bottom > container.bottom + 1 ||
                r.bottom > footer.top - 3,
            )
          )
            issues.push(`Text exceeds safe area: ${el.textContent}`);
        }
        if (
          document.documentElement.scrollHeight > innerHeight ||
          document.documentElement.scrollWidth > innerWidth
        )
          issues.push("Canvas overflow");
        return issues;
      });
      if (issues.length) throw new Error(`${filename}: ${issues.join("; ")}`);
      const output = path.join(directory, "exports", filename);
      await page.screenshot({ path: output, type: "png" });
      const bytes = await readFile(output);
      if (bytes.length > 1_000_000)
        throw new Error(`${filename}: exceeds 1 MB budget`);
      manifest.assets.push({
        filename,
        width: asset.width,
        height: asset.height,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      console.log(
        `${filename}: ${asset.width} × ${asset.height}, ${Math.round(bytes.length / 1024)} KB`,
      );
    }
  }
  await writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  // Small contact sheets make a full-set visual review practical.
  for (const format of ["landscape", "portrait"]) {
    for (const start of [0, 5]) {
      const figures = await Promise.all(
        getTalkGraphics()
          .slice(start, start + 5)
          .map(async (card) => {
            const png = await readFile(
              path.join(directory, "exports", `${card.id}-${format}.png`),
            );
            return `<figure><figcaption>${card.id}</figcaption><img src="data:image/png;base64,${png.toString("base64")}"></figure>`;
          }),
      );
      await page.setViewportSize({ width: 1100, height: 1000 });
      await page.goto("about:blank");
      await page.setContent(
        `<html><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#292929;color:white;font:16px sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0}figcaption{padding-bottom:8px}img{width:100%;display:block}</style><main>${figures.join("")}</main></html>`,
      );
      await page.evaluate(() =>
        Promise.all([...document.images].map((image) => image.decode())),
      );
      await page.screenshot({
        path: path.join(temporary, `review-${format}-${start / 5 + 1}.png`),
        fullPage: true,
      });
    }
  }
} finally {
  await browser.close();
}
