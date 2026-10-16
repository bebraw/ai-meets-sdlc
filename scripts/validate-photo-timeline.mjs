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
const imageCount = (page) => page.locator(".film-photo[data-photo-id]").count();
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
    for (const width of [320, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + "/");
      const navigation = page
        .locator("header")
        .getByRole("link", { name: "Photo timeline", exact: true });
      assert.equal(
        await navigation.count(),
        1,
        "One visible timeline entry in the header",
      );
      assert.equal(await navigation.getAttribute("href"), "/timeline/");
      assert.equal(
        await page
          .locator("footer")
          .getByRole("link", { name: "Photo timeline", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "Homepage navigation fits the viewport",
      );
      const entry =
        width === 1440
          ? page.getByRole("link", {
              name: "Explore the photo timeline",
              exact: true,
            })
          : navigation;
      await entry.click();
      await page.locator(".chapter").first().waitFor();
      assert.equal(
        new URL(page.url()).pathname,
        "/timeline/",
        "The homepage entry opens the working timeline",
      );
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + "/timeline/");
    await page.locator(".chapter").first().waitFor();
    assert.equal(await imageCount(page), highlights.length);
    assert.equal(await page.locator(".chapter").count(), 9);
    assert.equal(
      await page.locator("dialog, [popover]").count(),
      0,
      "Photos stay integrated in their chapter",
    );
    const firstViewer = page.locator(".chapter-viewer").first();
    const secondViewer = page.locator(".chapter-viewer").nth(1);
    const secondActive = await secondViewer.getAttribute(
      "data-active-photo-id",
    );
    const frames = firstViewer.locator(".film-photo");
    await frames.first().click();
    assert.equal(await frames.first().getAttribute("aria-pressed"), "true");
    assert.equal(
      await firstViewer
        .getByRole("button", { name: "Previous photo" })
        .isDisabled(),
      true,
    );
    const initialBounds = await firstViewer
      .locator(".feature-photo")
      .boundingBox();
    await frames.nth(1).click();
    const activeId = await frames.nth(1).getAttribute("data-photo-id");
    const active = highlights.find((photo) => photo.id === activeId);
    assert.equal(
      await firstViewer.getAttribute("data-active-photo-id"),
      active.id,
    );
    assert.equal(
      await firstViewer.locator(".feature-photo img").getAttribute("alt"),
      active.altText ||
        active.caption ||
        `SDLCAI event photo by ${active.photographer}`,
    );
    assert.match(
      await firstViewer.locator(".feature-photo img").getAttribute("srcset"),
      new RegExp(active.images.preview.path),
    );
    assert.equal(
      await firstViewer.locator(".active-caption").textContent(),
      active.caption,
    );
    assert.equal(
      await firstViewer.locator(".active-credit").textContent(),
      `${active.capturedLocal.slice(11, 16)} / Photo: ${active.photographer} / CC BY 4.0`,
    );
    assert.equal(
      await firstViewer.locator(".sharing-download").getAttribute("href"),
      `/media/event-photos/${active.id}/share.jpg?download=1`,
    );
    assert.equal(
      await firstViewer.locator(".media-bank-link").getAttribute("href"),
      `/photos/?selection=&search=${encodeURIComponent(active.filename)}`,
    );
    assert.equal(
      await firstViewer.locator('.film-photo[aria-pressed="true"]').count(),
      1,
    );
    assert.equal(
      await frames.nth(1).getAttribute("aria-controls"),
      await firstViewer.locator(".feature-photo").getAttribute("id"),
    );
    assert.equal(
      await secondViewer.getAttribute("data-active-photo-id"),
      secondActive,
      "Chapters keep independent active photos",
    );
    assert.equal(
      (await firstViewer.locator(".feature-photo").boundingBox()).height,
      initialBounds.height,
      "Selecting a frame keeps the image area stable",
    );
    await page.locator("#collection").selectOption("all");
    assert.equal(
      await firstViewer.getAttribute("data-active-photo-id"),
      active.id,
      "Filter rerenders retain a still-available active photo",
    );
    await page.locator("#collection").selectOption("highlights");
    await firstViewer.locator(".feature-photo").focus();
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await firstViewer.getAttribute("data-active-photo-id"),
      await frames.first().getAttribute("data-photo-id"),
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await firstViewer.getAttribute("data-active-photo-id"),
      await frames.first().getAttribute("data-photo-id"),
      "Keyboard navigation stops at the chapter boundary",
    );
    await frames.last().click();
    assert.equal(
      await firstViewer
        .getByRole("button", { name: "Next photo" })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await firstViewer.getAttribute("data-active-photo-id"),
      await frames.last().getAttribute("data-photo-id"),
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await firstViewer
        .locator('.film-photo[aria-pressed="true"]')
        .evaluate((button) => button === document.activeElement),
      true,
      "Arrow keys follow the selected thumbnail",
    );
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
                      !el.closest(".filmstrip, .chapter-track"),
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
          `${name}: ${width}px ${theme} page overflow: ${JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => !el.closest(".filmstrip, .chapter-track") && el.getBoundingClientRect().right > innerWidth + 1).map((el) => ({ tag: el.tagName, class: el.className, width: el.getBoundingClientRect().width }))))}`,
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
    const talkViewer = page.locator(".chapter-viewer").first();
    await talkViewer.locator(".film-photo").first().click();
    assert.match(
      await talkViewer.locator(".active-credit").textContent(),
      /Photo: .+ \/ CC BY 4\.0/,
    );
    const talkPhotoId = await talkViewer.getAttribute("data-active-photo-id");
    const talkPhoto = catalog.photos.find((photo) => photo.id === talkPhotoId);
    assert.equal(
      await talkViewer.locator(".recording-link").getAttribute("href"),
      `https://www.youtube.com/watch?v=d7POyy6dYFI&t=${talkPhoto.eventContext.recordingOffsetSeconds}s`,
    );
    assert.match(
      await talkViewer.locator(".active-context").textContent(),
      new RegExp(
        talkPhoto.eventContext.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
    await talkViewer.getByRole("button", { name: "Next photo" }).click();
    assert.notEqual(
      await talkViewer.getAttribute("data-active-photo-id"),
      talkPhotoId,
    );
    await page.addScriptTag({ content: axe });
    assert.deepEqual(
      await page.evaluate(async () =>
        (await axe.run(document)).violations.map(({ id }) => id),
      ),
      [],
    );
    await talkViewer
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    await page.waitForFunction(() =>
      Boolean(
        document.querySelector('.viewer-fullscreen[aria-pressed="true"]'),
      ),
    );
    assert.equal(
      await talkViewer.locator(".fullscreen-credit").isVisible(),
      true,
    );
    assert.equal(
      await talkViewer
        .locator(".viewer-fullscreen")
        .getAttribute("aria-pressed"),
      "true",
    );
    await talkViewer.locator(".feature-photo").focus();
    const fullscreenPhotoId = await talkViewer.getAttribute(
      "data-active-photo-id",
    );
    await page.keyboard.press("ArrowRight");
    assert.notEqual(
      await talkViewer.getAttribute("data-active-photo-id"),
      fullscreenPhotoId,
      "Fullscreen continues browsing the same chapter",
    );
    await talkViewer
      .getByRole("button", { name: "Exit full screen", exact: true })
      .click();
    assert.equal(
      await talkViewer.isVisible(),
      true,
      "Exit returns to the integrated viewer",
    );
    assert.equal(await page.locator("dialog, [popover]").count(), 0);
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
      .getByRole("link", { name: "Explore the photo timeline", exact: true })
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
    const retryViewer = retryPage.locator(".chapter-viewer").first();
    assert.equal(
      await retryViewer.evaluate(
        (viewer) => viewer.scrollWidth > viewer.clientWidth,
      ),
      false,
      "Mobile viewer controls wrap",
    );
    await retryViewer
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    assert.match(await retryViewer.getAttribute("class"), /immersive/);
    assert.equal(
      await retryViewer.locator(".fullscreen-credit").isVisible(),
      true,
    );
    assert.equal(
      await retryViewer.evaluate(
        (viewer) => viewer.scrollHeight > viewer.clientHeight + 1,
      ),
      false,
      "Fullscreen keeps the photo, controls and credit in view",
    );
    assert.equal(
      await retryPage.locator(".site-bar").evaluate((header) => header.inert),
      true,
      "Fallback isolates the active viewer",
    );
    await retryViewer.locator(".feature-photo").focus();
    await retryPage.keyboard.press("Tab");
    assert.equal(
      await retryPage.evaluate(() =>
        document.activeElement.matches(
          ".viewer-controls button:not(:disabled)",
        ),
      ),
      true,
      "Focus stays within the fullscreen viewer",
    );
    await retryPage.keyboard.press("Escape");
    assert.equal(
      await retryViewer.isVisible(),
      true,
      "Escape returns to the chapter",
    );
    assert.equal(
      await retryViewer
        .locator(".viewer-fullscreen")
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(
      await retryPage.locator(".site-bar").evaluate((header) => header.inert),
      false,
    );
    assert.equal(
      await retryPage.evaluate(() =>
        document.activeElement.matches(".viewer-fullscreen"),
      ),
      true,
    );
    const portraitId = highlights.find(
      (photo) => photo.width < photo.height,
    )?.id;
    if (portraitId) {
      const thumbnail = retryPage.locator(
        `.film-photo[data-photo-id="${portraitId}"]`,
      );
      await thumbnail.click();
      const viewer = thumbnail.locator(
        'xpath=ancestor::div[contains(@class,"chapter-viewer")]',
      );
      assert.equal(
        await viewer
          .locator(".feature-photo img")
          .evaluate((img) => getComputedStyle(img).objectFit),
        "contain",
        "Portrait images remain fully visible",
      );
    }
    await retryPage.close();
    assert.deepEqual(assetFailures, [], "All page assets load");
    assert.deepEqual(errors, [], "No browser runtime errors");
    await context.close();
    await browser.close();
    await closeBrowserServer(server);
    server = undefined;
    console.log(
      `Photo timeline filters, themes, integrated viewers, fullscreen and layouts passed in ${name}.`,
    );
  }
} finally {
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}
