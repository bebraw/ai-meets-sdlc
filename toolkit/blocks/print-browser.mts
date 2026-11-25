import type { Page } from "playwright";
import {
  printFontIds,
  printFonts,
  printFontUrl,
  printFontCss,
  type PrintFontId,
} from "./print-fonts.mjs";
import { readFile } from "node:fs/promises";

const origin = "https://event-toolkit.invalid";
const fontFile = new URL("../../assets/print/NotoSans.ttf", import.meta.url);
const artworkFile = new URL("./badge-artwork.mjs", import.meta.url);
const resource = (path: URL, contentType: string) => ({ path, contentType });
const assets = new Map([
  ...printFontIds.map((id): [string, ReturnType<typeof resource>] => [
    printFontUrl(id),
    resource(
      new URL("../../assets/print/" + printFonts[id].file, import.meta.url),
      "font/ttf",
    ),
  ]),
  ["/font.ttf", resource(fontFile, "font/ttf")],
  ["/badge-artwork.mjs", resource(artworkFile, "text/javascript")],
  [
    "/badge-sheets.mjs",
    resource(new URL("./badge-sheets.mjs", import.meta.url), "text/javascript"),
  ],
]);

/** Serve only local package assets. A print run makes no external requests. */
export async function withPrintPage<T>(
  work: (page: Page) => Promise<T>,
  font?: PrintFontId,
): Promise<T> {
  const { chromium } = await import("playwright");
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.TOOLKIT_CHROMIUM_PATH || undefined,
    });
  } catch (error) {
    throw new Error(
      "Could not start Chromium. Run npx playwright install chromium, or set TOOLKIT_CHROMIUM_PATH.",
      { cause: error },
    );
  }
  try {
    const page = await browser.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body:
            '<!doctype html><meta charset="utf-8"><title>Print proof</title><style>' +
            printFontCss(font) +
            "*{box-sizing:border-box}html,body{margin:0}body{font-family:Print,sans-serif;color:#192027}svg{display:block}article{break-after:page;print-color-adjust:exact;-webkit-print-color-adjust:exact}article:last-child{break-after:auto}</style><body></body>",
        });
      const asset = assets.get(url.pathname);
      if (!asset) return route.abort();
      return route.fulfill({
        contentType: asset.contentType,
        body: await readFile(asset.path),
      });
    });
    await page.goto(origin);
    return await work(page);
  } finally {
    await browser.close();
  }
}

export async function printPdf(page: Page, name: string) {
  return {
    name,
    mimeType: "application/pdf",
    bytes: await page.pdf({ printBackground: true, preferCSSPageSize: true }),
  };
}
