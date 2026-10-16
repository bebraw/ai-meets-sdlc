import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createWorkerFixture } from "../test/helpers/worker-fixture.mjs";
import { closeBrowserServer } from "./layout-browser.mjs";

const fixture = await createWorkerFixture();
const origin = `http://127.0.0.1:${fixture.worker.port}`;
const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
const jpeg = await readFile("assets/speakers/joongi-shin.jpg");
const response = await fixture.worker.fetch(origin + "/api/photos/catalog");
assert.equal(response.status, 200);
const catalog = await response.json();
const highlights = catalog.photos.filter(
  (photo) => photo.selection === "selected",
);
const imageCount = (page) => page.locator("button[data-photo-id]").count();
await mkdir(".cache/timeline-review", { recursive: true });
let server;
try {
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
  const engines = [["chromium", chromium, { executablePath }]];
  try {
    await access(webkit.executablePath());
    engines.push(["webkit", webkit, {}]);
  } catch {}
  for (const [name, engine, options] of engines) {
    server = await engine.launchServer(options);
    const browser = await engine.connect(server.wsEndpoint());
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    // Image pixels are a repository fixture; the catalog and page use the real
    // local Worker, keeping this check independent of remote R2 or local photos.
    await context.route("**/media/event-photos/**", (route) =>
      route.fulfill({ contentType: "image/jpeg", body: jpeg }),
    );
    const deferred = await context.newPage();
    await deferred.addInitScript(() => {
      const entries = performance.getEntriesByName.bind(performance);
      performance.getEntriesByName = (name, ...args) =>
        name === "first-contentful-paint" ? [] : entries(name, ...args);
      window.PerformanceObserver = class {
        static supportedEntryTypes = ["paint"];
        constructor(callback) {
          this.callback = callback;
        }
        observe() {
          window.releaseFirstPaint = () =>
            this.callback({
              getEntries: () => [{ name: "first-contentful-paint" }],
            });
        }
        disconnect() {}
      };
      window.requestIdleCallback = (callback) => {
        window.releaseCatalog = callback;
      };
    });
    const requests = [];
    deferred.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/photos/catalog")
        requests.push(request.url());
    });
    await deferred.goto(origin + "/timeline/");
    await deferred.waitForFunction(
      () => typeof window.releaseFirstPaint === "function",
    );
    assert.equal(requests.length, 0, "Metadata waits for the page to paint");
    await deferred.evaluate(() => window.releaseFirstPaint());
    await deferred.waitForFunction(
      () => typeof window.releaseCatalog === "function",
    );
    assert.equal(requests.length, 0, "Metadata waits for idle work");
    await deferred.evaluate(() => window.releaseCatalog());
    await deferred.locator(".chapter").first().waitFor();
    await deferred.close();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const assetFailures = [];
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).pathname.startsWith("/assets/")
      )
        assetFailures.push(response.url());
    });
    await page.goto(origin + "/timeline/");
    await page.locator(".chapter").first().waitFor();
    assert.equal(await imageCount(page), highlights.length);
    assert.equal(await page.locator(".chapter").count(), 9);
    assert.equal(
      await page.locator('link[rel="canonical"]').getAttribute("href"),
      "https://sdlcai.org/timeline/",
    );
    assert.equal(await page.locator('meta[name="robots"]').count(), 0);
    assert.equal(
      await page.locator("#main").getAttribute("aria-busy"),
      "false",
    );
    assert.equal(
      await page
        .getByText(/prototype|compare with the photo atlas|photographs shown/i)
        .count(),
      0,
    );
    assert.match(
      await (await fixture.worker.fetch(origin + "/sitemap.xml")).text(),
      /https:\/\/sdlcai.org\/timeline\//,
    );
    assert.equal(
      (await fixture.worker.fetch(origin + "/assets/favicon.svg")).status,
      200,
    );

    for (const width of [240, 320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        if ((await page.locator("html").getAttribute("data-theme")) !== theme)
          await page.getByRole("button", { name: "Toggle dark mode" }).click();
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )
        ) {
          console.log(
            JSON.stringify(
              await page.evaluate(() => ({
                width: innerWidth,
                rootWidth: document.documentElement.scrollWidth,
                bodyWidth: document.body.scrollWidth,
                scrolling: [...document.querySelectorAll("body *")]
                  .filter(
                    (el) =>
                      el.scrollWidth > el.clientWidth + 1 &&
                      !el.closest(".filmstrip, .chapter-track, dialog"),
                  )
                  .map((el) => ({
                    tag: el.tagName,
                    class: el.className,
                    width: el.clientWidth,
                    scroll: el.scrollWidth,
                  })),
              })),
            ),
          );
          await page.screenshot({
            path: `.cache/timeline-review/${name}-${width}-${theme}-overflow.png`,
          });
        }
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${name}: ${width}px ${theme} page overflow: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => !el.closest(".filmstrip, .chapter-track, dialog") && el.getBoundingClientRect().right > innerWidth + 1).map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width }))))}`,
        );
        assert.equal(
          await page
            .locator(".film-frame .credit")
            .evaluateAll((credits) =>
              credits.some(
                (credit) => credit.scrollWidth > credit.clientWidth + 1,
              ),
            ),
          false,
          "Photographer names wrap within their frame",
        );
        if (
          (width === 320 && theme === "light") ||
          (width === 1440 && theme === "dark")
        ) {
          await page.addScriptTag({ content: axe });
          const violations = await page.evaluate(async () =>
            (
              await axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"],
                },
              })
            ).violations.map(({ id, nodes }) => ({
              id,
              targets: nodes.map((node) => node.target),
            })),
          );
          assert.deepEqual(
            violations,
            [],
            `${name}: accessibility at ${width}px ${theme}`,
          );
          await page.screenshot({
            path: `.cache/timeline-review/${name}-${width}-${theme}.png`,
          });
        }
      }
    }
    await page
      .locator(".film-frame .credit")
      .evaluateAll((credits) =>
        credits.forEach((credit) => (credit.style.fontSize = "24px")),
      );
    assert.equal(
      await page
        .locator(".film-frame .credit")
        .evaluateAll((credits) =>
          credits.some((credit) => credit.scrollWidth > credit.clientWidth + 1),
        ),
      false,
      "Credits remain readable at double text size",
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator("#collection").selectOption("all");
    assert.equal(await imageCount(page), catalog.photos.length);
    await page.locator("#photographer").selectOption("Juho Vepsäläinen");
    assert.equal(
      await imageCount(page),
      catalog.photos.filter(
        (photo) => photo.photographer === "Juho Vepsäläinen",
      ).length,
    );
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "photographer",
    );
    await page.locator("#photographer").selectOption("");
    for (const [label, tag] of [
      ["Our sponsors", "sponsors"],
      ["Branded beer", "beer"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      assert.equal(
        await imageCount(page),
        catalog.photos.filter((photo) =>
          photo.tags.map((tag) => tag.toLowerCase()).includes(tag),
        ).length,
      );
      assert.equal(
        await page.evaluate(() =>
          document.activeElement.getAttribute("aria-pressed"),
        ),
        "true",
      );
    }
    await page.getByRole("button", { name: "Everything", exact: true }).click();
    await page.locator("#discovery-query").fill("sini tistelgren");
    await page.getByRole("button", { name: "Find photos" }).click();
    assert.ok((await imageCount(page)) > 0);
    assert.ok((await imageCount(page)) < catalog.photos.length);
    assert.match(new URL(page.url()).searchParams.get("q"), /sini tistelgren/);
    const searchedIds = await page
      .locator("[data-photo-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.photoId));
    await page.reload();
    await page.locator(".chapter").first().waitFor();
    assert.deepEqual(
      await page
        .locator("[data-photo-id]")
        .evaluateAll((nodes) => nodes.map((node) => node.dataset.photoId)),
      searchedIds,
    );
    await page.getByRole("button", { name: "Clear discovery" }).click();
    await page.locator("#discovery-speaker").selectOption("sini-tistelgren");
    assert.ok((await imageCount(page)) > 0);
    assert.equal(await page.locator("#discovery-talk option").count(), 2);
    await page.locator("#discovery-talk").selectOption({ index: 1 });
    const selectedTalk = await page.locator("#discovery-talk").inputValue();
    assert.equal(new URL(page.url()).searchParams.get("talk"), selectedTalk);
    await page.locator(".feature-photo").first().click();
    assert.equal(await page.locator("#preview").isVisible(), true);
    assert.match(
      await page.locator("#preview-credit").textContent(),
      /Photo: .+ \/ CC BY 4\.0/,
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Watch this moment in the recording" })
        .count(),
      1,
    );
    assert.match(
      await page.locator("#download").getAttribute("href"),
      /^\/media\/event-photos\/photo-[a-f0-9]{20}\/share\.jpg\?download=1$/,
    );
    const before = await page.locator("#large-photo").getAttribute("src");
    await page.keyboard.press("ArrowRight");
    assert.notEqual(
      await page.locator("#large-photo").getAttribute("src"),
      before,
    );
    await page.addScriptTag({ content: axe });
    assert.deepEqual(
      await page.evaluate(async () =>
        (await axe.run(document)).violations.map(({ id }) => id),
      ),
      [],
    );
    await page
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        Boolean(document.fullscreenElement) ||
        document.querySelector("#preview").classList.contains("immersive"),
    );
    assert.equal(await page.locator("#fullscreen-credit").isVisible(), true);
    assert.equal(
      await page.locator("#fullscreen").getAttribute("aria-pressed"),
      "true",
    );
    await page
      .getByRole("button", { name: "Exit full screen", exact: true })
      .click();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.locator("#preview").isVisible(), false);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.matches("[data-photo-id]"),
      ),
      true,
    );
    await page.getByRole("button", { name: "Clear discovery" }).click();
    await page
      .getByRole("button", { name: "Generative UI", exact: true })
      .click();
    assert.ok((await imageCount(page)) > 0);
    assert.equal(new URL(page.url()).searchParams.get("topic"), "ui");
    await page.getByRole("button", { name: "Clear discovery" }).click();
    await page.locator('a[data-chapter="evening"]').click();
    await page.reload();
    await page.locator("#evening").waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector("#evening").getBoundingClientRect().top <
        innerHeight,
    );
    assert.equal(new URL(page.url()).hash, "#evening");
    await page
      .locator("#discovery-query")
      .fill("unlikely-photo-search-no-match");
    await page.getByRole("button", { name: "Find photos" }).click();
    assert.equal(await imageCount(page), 0);
    await page.getByRole("button", { name: "Reset all filters" }).click();
    assert.equal(await imageCount(page), highlights.length);
    const theme = await page.locator("html").getAttribute("data-theme");
    await page.getByRole("link", { name: "Media bank", exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    await page
      .getByRole("link", { name: "Explore the day in frames", exact: true })
      .click();
    await page.locator(".chapter").first().waitFor();
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);

    const retryPage = await context.newPage();
    await retryPage.setViewportSize({ width: 240, height: 700 });
    await retryPage.addInitScript(() => {
      Element.prototype.requestFullscreen = undefined;
    });
    let fail = true;
    await retryPage.route("**/api/photos/catalog", (route) =>
      fail
        ? route.fulfill({ status: 503, body: "Unavailable" })
        : route.continue(),
    );
    await retryPage.goto(origin + "/timeline/");
    await retryPage
      .getByRole("button", { name: "Retry loading photos" })
      .waitFor();
    fail = false;
    await retryPage
      .getByRole("button", { name: "Retry loading photos" })
      .click();
    await retryPage.locator(".chapter").first().waitFor();
    assert.equal(await imageCount(retryPage), highlights.length);
    await retryPage.locator(".feature-photo").first().click();
    assert.equal(
      await retryPage
        .locator("#preview")
        .evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth),
      false,
      "Mobile preview controls wrap",
    );
    await retryPage
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    assert.match(
      await retryPage.locator("#preview").getAttribute("class"),
      /immersive/,
    );
    assert.equal(
      await retryPage.locator("#fullscreen-credit").isVisible(),
      true,
    );
    assert.equal(
      await retryPage
        .locator("#preview")
        .evaluate((dialog) => dialog.scrollHeight > dialog.clientHeight + 1),
      false,
      "Fullscreen keeps the photo, controls and credit in view",
    );
    await retryPage.keyboard.press("Escape");
    assert.equal(
      await retryPage.locator("#preview").isVisible(),
      true,
      "First Escape exits the fullscreen fallback",
    );
    assert.equal(
      await retryPage.locator("#fullscreen").getAttribute("aria-pressed"),
      "false",
    );
    await retryPage.keyboard.press("Escape");
    assert.equal(await retryPage.locator("#preview").isVisible(), false);
    await retryPage.close();
    assert.deepEqual(assetFailures, [], "All page assets load");
    assert.deepEqual(errors, [], "No browser runtime errors");
    await context.close();
    await browser.close();
    await closeBrowserServer(server);
    server = undefined;
    console.log(
      `Photo timeline filters, themes, previews, fullscreen and layouts passed in ${name}.`,
    );
  }
} finally {
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}
