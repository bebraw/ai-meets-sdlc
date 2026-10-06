import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import sponsors from "../site/data/sponsors.json" with { type: "json" };
import schedule from "../site/data/schedule.json" with { type: "json" };
import { getSlideTitleClassName } from "../site/scripts/slide-title.ts";

const buildDir = path.resolve("build");
const deckRoute = "/slides/deck/";
const scheduleRoute = "/slides/schedule/";
const deckViewports = [
  { name: "hd", width: 1280, height: 720 },
  { name: "linkedin", width: 1200, height: 627 },
  { name: "social-landscape", width: 1600, height: 900 },
  { name: "full-hd", width: 1920, height: 1080 },
];
const browserCandidates = [
  process.env.LAYOUT_BROWSER_PATH,
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  chromium.executablePath(),
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
    "No Chromium-compatible browser found. Set LAYOUT_BROWSER_PATH to validate slides.",
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

async function waitForPageAssets(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images]
        .filter((image) => {
          const rect = image.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((image) =>
          image.complete ? undefined : image.decode().catch(() => undefined),
        ),
    );
  });
}

// Element boxes can fit even when a descender touches the next line's capitals.
// Measure the actual wrapped lines with the loaded font, including glyph ink.
function inspectTalkTitle(title) {
  const errors = [];
  const style = getComputedStyle(title);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const lines = [];
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    for (let index = 0; index < node.textContent.length; index += 1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0) continue;
      let line = lines.find((item) => Math.abs(item.top - rect.top) < 1);
      if (!line) {
        line = { top: rect.top, text: "" };
        lines.push(line);
      }
      line.text += node.textContent[index];
    }
  }

  lines.sort((a, b) => a.top - b.top);
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const descent = context.measureText(previous.text).actualBoundingBoxDescent;
    const ascent = context.measureText(current.text).actualBoundingBoxAscent;
    const gap = current.top - previous.top - descent - ascent;
    if (gap < 1) {
      errors.push(
        `talk title lines ${index} and ${index + 1} have no clear ink gap (${gap.toFixed(1)}px)`,
      );
    }
  }

  const titleRect = title.getBoundingClientRect();
  const slide = title.closest("[data-presentation-slide]");
  const headerRect = slide
    .querySelector(".presentation-header")
    .getBoundingClientRect();
  const footerRect = slide
    .querySelector(".presentation-footer")
    .getBoundingClientRect();
  if (
    titleRect.top < headerRect.bottom - 2 ||
    titleRect.bottom > footerRect.top + 2
  ) {
    errors.push("talk title crosses the header or sponsor footer");
  }
  if (title.scrollWidth > title.clientWidth + 2) {
    errors.push("talk title overflows horizontally");
  }
  return { errors, lineCount: lines.length };
}

async function validateDeck(page, origin, viewport, failures) {
  await page.goto(`${origin}${deckRoute}?slide=1`, {
    waitUntil: "domcontentloaded",
  });
  await waitForPageAssets(page);
  const slideCount = await page.locator("[data-presentation-slide]").count();

  for (let index = 0; index < slideCount; index += 1) {
    const result = await page.evaluate(
      (expectedSponsors) => {
        const activeSlides = [
          ...document.querySelectorAll("[data-presentation-slide].is-active"),
        ];
        const active = activeSlides[0];

        if (!(active instanceof HTMLElement)) {
          return { errors: ["missing active slide"] };
        }

        const errors = [];
        const tolerance = 2;
        const slideRect = active.getBoundingClientRect();
        const header = active.querySelector(".presentation-header");
        const content = [
          ...active.querySelectorAll(
            ".presentation-title-content,.presentation-session-content,.presentation-talk-content",
          ),
        ].find((element) => getComputedStyle(element).display !== "none");
        const footer = active.querySelector(".presentation-footer");

        if (activeSlides.length !== 1) {
          errors.push(
            `expected one active slide, found ${activeSlides.length}`,
          );
        }

        if (
          Math.abs(slideRect.width - innerWidth) > tolerance ||
          Math.abs(slideRect.height - innerHeight) > tolerance
        ) {
          errors.push(
            `slide is ${Math.round(slideRect.width)}x${Math.round(slideRect.height)}, viewport is ${innerWidth}x${innerHeight}`,
          );
        }

        if (
          active.scrollWidth > active.clientWidth + tolerance ||
          active.scrollHeight > active.clientHeight + tolerance
        ) {
          errors.push(
            `slide overflows ${active.scrollWidth}x${active.scrollHeight} inside ${active.clientWidth}x${active.clientHeight}`,
          );
        }

        const regions = [header, content, footer].filter(
          (element) => element instanceof HTMLElement,
        );

        for (const region of regions) {
          const rect = region.getBoundingClientRect();

          if (
            rect.left < slideRect.left - tolerance ||
            rect.top < slideRect.top - tolerance ||
            rect.right > slideRect.right + tolerance ||
            rect.bottom > slideRect.bottom + tolerance
          ) {
            errors.push(`${region.className} crosses the slide boundary`);
          }
        }

        if (header && content) {
          const headerRect = header.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();

          if (headerRect.bottom > contentRect.top + tolerance) {
            errors.push("header overlaps slide content");
          }
        }

        if (content && footer) {
          const contentRect = content.getBoundingClientRect();
          const footerRect = footer.getBoundingClientRect();

          if (contentRect.bottom > footerRect.top + tolerance) {
            errors.push("slide content overlaps sponsor footer");
          }
        }

        for (const image of active.querySelectorAll("img")) {
          if (!image.complete || image.naturalWidth === 0) {
            errors.push(`image did not load: ${image.getAttribute("src")}`);
          }
        }

        const sponsorStrip = active.querySelector(
          ".presentation-sponsor-strip",
        );

        const actualSponsors = [
          ...(sponsorStrip?.querySelectorAll("figure img") ?? []),
        ]
          .map((image) => image.alt)
          .sort();
        if (
          JSON.stringify(actualSponsors) !== JSON.stringify(expectedSponsors)
        ) {
          errors.push(
            "between-talk strip must contain the configured sponsors",
          );
        }

        if (sponsorStrip?.querySelector(".presentation-sponsor-brand")) {
          errors.push("Brand sponsor appeared in the between-talk strip");
        }

        if (sponsorStrip?.querySelector(".presentation-sponsor-location")) {
          errors.push("Location sponsor appeared in the between-talk strip");
        }

        for (const image of sponsorStrip?.querySelectorAll("img") ?? []) {
          const rect = image.getBoundingClientRect();
          const frame = image.closest("figure");
          const naturalRatio = image.naturalWidth / image.naturalHeight;
          const renderedRatio = rect.width / rect.height;

          if (Math.abs(renderedRatio / naturalRatio - 1) > 0.02) {
            errors.push(
              `sponsor logo aspect ratio changed: ${image.getAttribute("alt")}`,
            );
          }

          if (frame) {
            const frameRect = frame.getBoundingClientRect();
            const frameStyle = getComputedStyle(frame);
            const padding = Number.parseFloat(frameStyle.paddingTop);

            if (
              rect.left < frameRect.left + padding - tolerance ||
              rect.top < frameRect.top + padding - tolerance ||
              rect.right > frameRect.right - padding + tolerance ||
              rect.bottom > frameRect.bottom - padding + tolerance
            ) {
              errors.push(
                `sponsor logo crosses its safe area: ${image.getAttribute("alt")}`,
              );
            }
          }
        }

        return {
          errors,
          number: active.getAttribute("data-slide-number"),
        };
      },
      sponsors.items
        .filter((sponsor) => sponsor.betweenTalks)
        .map((sponsor) => sponsor.name)
        .sort(),
    );

    for (const error of result.errors) {
      failures.push({
        route: deckRoute,
        slide: result.number ?? String(index + 1),
        viewport: viewport.name,
        error,
      });
    }

    const title = page.locator(
      ".presentation-slide.is-active .presentation-talk-title",
    );
    if (await title.count()) {
      const { errors } = await title.evaluate(inspectTalkTitle);
      for (const error of errors) {
        failures.push({
          route: deckRoute,
          slide: result.number,
          viewport: viewport.name,
          error,
        });
      }
    }

    if (index < slideCount - 1) {
      const nextSlideNumber = String(index + 2);
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        (slideNumber) =>
          document
            .querySelector("[data-presentation-slide].is-active")
            ?.getAttribute("data-slide-number") === slideNumber,
        nextSlideNumber,
      );
      await waitForPageAssets(page);
    }
  }

  return slideCount;
}

async function validateUpdatedTitle(page, origin, viewport, failures) {
  // Workspace titles override the repository defaults at runtime. Keep the
  // reported title as a fixture without changing the speaker's source data.
  const text = "Medical Breakthroughs and Scientific Discoveries";
  const slideId = await page
    .locator(".presentation-talk-title")
    .first()
    .evaluate(
      (title) => title.closest("[data-presentation-slide]").dataset.slideId,
    );
  await page.goto(`${origin}${deckRoute}?slideId=${slideId}`);
  await waitForPageAssets(page);
  const title = page.locator(
    ".presentation-slide.is-active .presentation-talk-title",
  );
  await title.evaluate(
    (element, fixture) => {
      element.textContent = fixture.text;
      element.className = fixture.className;
    },
    { text, className: getSlideTitleClassName(text) },
  );
  const result = await title.evaluate(inspectTalkTitle);
  await page.screenshot({
    path: path.join(os.tmpdir(), `sdlcai-updated-title-${viewport.name}.png`),
  });
  if (result.lineCount < 2)
    result.errors.push("title fixture must wrap onto multiple lines");
  for (const error of result.errors) {
    failures.push({
      route: deckRoute,
      slide: "updated-title",
      viewport: viewport.name,
      error,
    });
  }
}

async function validateSchedule(page, origin, failures) {
  await page.goto(`${origin}${scheduleRoute}`, {
    waitUntil: "domcontentloaded",
  });
  await waitForPageAssets(page);

  const result = await page.evaluate(
    ({ expectedSponsors, expectedRows }) => {
      const errors = [];
      const sheet = document.querySelector(".presentation-schedule-sheet");
      const list = document.querySelector(".presentation-schedule-list");
      const footer = document.querySelector(".presentation-schedule-footer");

      if (!(sheet instanceof HTMLElement)) {
        return { errors: ["missing schedule sheet"] };
      }

      if (sheet.scrollWidth > sheet.clientWidth + 2) {
        errors.push("schedule sheet overflows horizontally");
      }

      if (document.documentElement.scrollWidth > innerWidth + 2) {
        errors.push("schedule page overflows the viewport horizontally");
      }

      if (list && footer) {
        const listRect = list.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();

        if (listRect.bottom > footerRect.top + 2) {
          errors.push("schedule rows overlap the sponsor footer");
        }
      }

      if (
        document.querySelectorAll(".presentation-schedule-item").length !==
        expectedRows
      ) {
        errors.push(`schedule must contain all ${expectedRows} program rows`);
      }

      const actualSponsors = [
        ...document.querySelectorAll(".presentation-schedule-sponsor img"),
      ]
        .map((image) => image.alt)
        .sort();
      if (JSON.stringify(actualSponsors) !== JSON.stringify(expectedSponsors)) {
        errors.push(
          "schedule must acknowledge all configured sponsors and partners",
        );
      }

      for (const image of sheet.querySelectorAll("img")) {
        if (!image.complete || image.naturalWidth === 0) {
          errors.push(`image did not load: ${image.getAttribute("src")}`);
        }
      }

      for (const image of sheet.querySelectorAll(
        ".presentation-schedule-sponsor img",
      )) {
        const rect = image.getBoundingClientRect();
        const frame = image.closest("figure");
        const naturalRatio = image.naturalWidth / image.naturalHeight;
        const renderedRatio = rect.width / rect.height;

        if (Math.abs(renderedRatio / naturalRatio - 1) > 0.02) {
          errors.push(
            `schedule sponsor logo aspect ratio changed: ${image.getAttribute("alt")}`,
          );
        }

        if (frame) {
          const frameRect = frame.getBoundingClientRect();
          const frameStyle = getComputedStyle(frame);
          const padding = Number.parseFloat(frameStyle.paddingTop);

          if (
            rect.left < frameRect.left + padding - 2 ||
            rect.top < frameRect.top + padding - 2 ||
            rect.right > frameRect.right - padding + 2 ||
            rect.bottom > frameRect.bottom - padding + 2
          ) {
            errors.push(
              `schedule sponsor logo crosses its safe area: ${image.getAttribute("alt")}`,
            );
          }
        }
      }

      return { errors };
    },
    {
      expectedSponsors: sponsors.items.map((sponsor) => sponsor.name).sort(),
      expectedRows: schedule.items.length,
    },
  );

  for (const error of result.errors) {
    failures.push({ route: scheduleRoute, viewport: "desktop", error });
  }
}

async function main() {
  const browserPath = await findBrowser();
  const { server, port } = await startServer();
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--headless=new"],
  });
  const origin = `http://127.0.0.1:${port}`;
  const failures = [];
  let checkedSlides = 0;

  try {
    for (const viewport of deckViewports) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      try {
        checkedSlides += await validateDeck(page, origin, viewport, failures);
        await validateUpdatedTitle(page, origin, viewport, failures);
      } finally {
        await context.close();
      }
    }

    const scheduleContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const schedulePage = await scheduleContext.newPage();

    try {
      await validateSchedule(schedulePage, origin, failures);
    } finally {
      await scheduleContext.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length > 0) {
    console.error("Slide layout validation failed:");

    for (const failure of failures) {
      console.error(JSON.stringify(failure));
    }

    process.exit(1);
  }

  console.log(
    `Validated ${checkedSlides} deck renders, ${deckViewports.length} updated-title renders, and the complete daily schedule.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
