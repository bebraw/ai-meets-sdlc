import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const buildDir = path.resolve("build");
const outputDir = path.join(buildDir, "assets/social");
const deckRoute = "/slides/deck/";
const pageTimeoutMs = 15_000;
const presets = [
  {
    id: "linkedin",
    width: 1200,
    height: 627,
    quality: 92,
    maxBytes: 5 * 1024 * 1024,
  },
  {
    id: "x",
    width: 1600,
    height: 900,
    quality: 92,
    maxBytes: 5 * 1024 * 1024,
  },
  {
    id: "bluesky",
    width: 1600,
    height: 900,
    quality: 86,
    maxBytes: 1_000_000,
  },
];
const browserCandidates = [
  process.env.LAYOUT_BROWSER_PATH,
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  for (const candidate of browserCandidates) {
    if (await fileExists(candidate)) return candidate;
  }

  throw new Error(
    "No Chromium-compatible browser found. Set LAYOUT_BROWSER_PATH to export social slides.",
  );
}

function startServer() {
  const contentTypes = new Map([
    [".css", "text/css"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript"],
    [".jpg", "image/jpeg"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
    [".woff2", "font/woff2"],
  ]);

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const safePath = path
      .normalize(decodeURIComponent(requestUrl.pathname))
      .replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(buildDir, safePath);

    try {
      if ((await stat(filePath)).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    } catch {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath)) ?? "text/plain",
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function waitForActiveAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.querySelectorAll(".presentation-slide.is-active img")].map(
        async (image) => {
          await image.decode();

          if (image.naturalWidth === 0) {
            throw new Error(`Could not decode slide image: ${image.src}`);
          }
        },
      ),
    );
  });
}

async function exportPreset(browser, origin, preset) {
  const presetDir = path.join(outputDir, preset.id);
  await mkdir(presetDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: preset.width, height: preset.height },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(pageTimeoutMs);

  try {
    await page.goto(`${origin}${deckRoute}?slide=1`, {
      waitUntil: "domcontentloaded",
    });
    await waitForActiveAssets(page);

    const slideCount = await page.locator("[data-presentation-slide]").count();
    let totalBytes = 0;

    for (let index = 0; index < slideCount; index += 1) {
      const number = String(index + 1);
      const paddedNumber = number.padStart(2, "0");
      const slide = page.locator("[data-presentation-slide].is-active");
      const bounds = await slide.boundingBox();

      if (
        !bounds ||
        Math.abs(bounds.width - preset.width) > 1 ||
        Math.abs(bounds.height - preset.height) > 1
      ) {
        throw new Error(
          `${preset.id} slide ${number} rendered at ${bounds?.width ?? 0}x${bounds?.height ?? 0}, expected ${preset.width}x${preset.height}`,
        );
      }

      const outputPath = path.join(
        presetDir,
        `sdlcai-2026-slide-${paddedNumber}-${preset.id}-${preset.width}x${preset.height}.jpg`,
      );

      await slide.screenshot({
        path: outputPath,
        type: "jpeg",
        quality: preset.quality,
        animations: "disabled",
      });

      const outputBytes = (await stat(outputPath)).size;
      totalBytes += outputBytes;

      if (outputBytes > preset.maxBytes) {
        throw new Error(
          `${path.relative(buildDir, outputPath)} is ${outputBytes} bytes, above the ${preset.maxBytes}-byte ${preset.id} limit`,
        );
      }

      if (index < slideCount - 1) {
        const nextSlideNumber = String(index + 2);
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
          (expectedNumber) =>
            document
              .querySelector("[data-presentation-slide].is-active")
              ?.getAttribute("data-slide-number") === expectedNumber,
          nextSlideNumber,
        );
        await waitForActiveAssets(page);
      }
    }

    return { id: preset.id, slideCount, totalBytes };
  } finally {
    await context.close();
  }
}

async function main() {
  await rm(outputDir, { recursive: true, force: true });

  const browserPath = await findBrowser();
  const { server, port } = await startServer();
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--headless=new"],
  });
  const origin = `http://127.0.0.1:${port}`;

  try {
    const results = await Promise.all(
      presets.map((preset) => exportPreset(browser, origin, preset)),
    );
    const fileCount = results.reduce(
      (total, result) => total + result.slideCount,
      0,
    );
    const totalBytes = results.reduce(
      (total, result) => total + result.totalBytes,
      0,
    );

    console.log(
      `Exported ${fileCount} social slide images (${Math.round(totalBytes / 1024)} KB).`,
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
