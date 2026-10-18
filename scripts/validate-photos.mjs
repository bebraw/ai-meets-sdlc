import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import seed from "../site/data/event-photos.json" with { type: "json" };
import initial from "../production/media-bank/initial-curation.json" with { type: "json" };
import { photoObjectFilename } from "../site/scripts/photo-files.ts";
import {
  createReceiptFixture,
  receiptAdmin,
} from "../test/helpers/receipt-fixture.mjs";

const fixture = await createReceiptFixture();
const publicPhotos = seed.photos.filter((photo) =>
  ["selected", "alternate"].includes(initial.photos[photo.id]?.selection),
);
const highlightCount = publicPhotos.filter(
  (photo) => initial.photos[photo.id].selection === "selected",
).length;
const photographerCount = new Set(
  publicPhotos.map((photo) => photo.photographer),
).size;
let browser;
try {
  // A repository-owned sample keeps this check independent of local originals.
  const jpeg = await readFile("assets/speakers/joongi-shin.jpg");
  for (const photo of seed.photos) {
    for (const variant of ["thumbnail", "preview", "share", "original"])
      await fixture.env.SPEAKER_UPLOADS.put(
        `event-photos/${seed.eventId}/${photo.id}/${photoObjectFilename(photo.filename, variant)}`,
        jpeg,
      );
  }
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
  browser = await chromium.launch({ executablePath });
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  const publicContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
  });
  const adminContext = await browser.newContext({
    extraHTTPHeaders: { authorization: receiptAdmin },
    viewport: { width: 1440, height: 1000 },
  });
  const page = await publicContext.newPage(),
    admin = await adminContext.newPage();
  const deferred = await publicContext.newPage();
  await deferred.addInitScript(() => {
    // Model a navigation transition whose first paint arrives after the load
    // event and animation frames. Idle work must wait for the paint notification.
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
  const catalogRequests = [];
  deferred.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/photos/catalog")
      catalogRequests.push(request.url());
  });
  await deferred.goto(`${origin}/2026/photos/`);
  await deferred.waitForFunction(
    () => typeof window.releaseFirstPaint === "function",
  );
  assert.equal(
    catalogRequests.length,
    0,
    "Catalog waits for a delayed first paint",
  );
  assert.equal(
    await deferred.evaluate(() => typeof window.releaseCatalog),
    "undefined",
  );
  await deferred.evaluate(() => window.releaseFirstPaint());
  await deferred.waitForFunction(
    () => typeof window.releaseCatalog === "function",
  );
  assert.equal(
    catalogRequests.length,
    0,
    "Catalog waits while the shell renders",
  );
  assert.equal(
    await deferred
      .getByRole("link", { name: "Schedule", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await deferred.locator("#tag").isDisabled(), true);
  assert.equal(await deferred.locator("#person").isVisible(), false);
  assert.equal(await deferred.locator("#similar").isVisible(), false);
  assert.equal(
    await deferred.locator("#grid").getAttribute("aria-busy"),
    "true",
  );
  assert.equal(
    await deferred.locator("#status").textContent(),
    "Loading photos…",
  );
  await deferred.getByRole("button", { name: "Toggle dark mode" }).click();
  assert.equal(
    await deferred.evaluate(() => document.documentElement.dataset.theme),
    "light",
  );
  await deferred.evaluate(() => window.releaseCatalog());
  await deferred.waitForFunction(
    (count) => document.querySelectorAll(".card").length === count,
    highlightCount,
  );
  assert.equal(catalogRequests.length, 1);
  assert.equal(await deferred.locator("#tag").isEnabled(), true);
  assert.equal(
    await deferred.locator("#grid").getAttribute("aria-busy"),
    "false",
  );
  await deferred.evaluate(() => localStorage.removeItem("sdlcai-theme"));
  await deferred.waitForLoadState("networkidle");
  await deferred.close();

  const fallbackCatalog = await publicContext.newPage();
  await fallbackCatalog.addInitScript(() => {
    window.requestIdleCallback = undefined;
    window.PerformanceObserver = undefined;
  });
  let attempts = 0;
  await fallbackCatalog.route("**/api/photos/catalog", async (route) => {
    if (++attempts === 1)
      await route.fulfill({ status: 503, body: "Temporarily unavailable" });
    else await route.continue();
  });
  await fallbackCatalog.goto(`${origin}/2026/photos/?selection=&tag=coffee`);
  await fallbackCatalog
    .getByRole("button", { name: "Retry loading photos" })
    .waitFor();
  assert.equal(
    await fallbackCatalog.locator("#status").textContent(),
    "Could not load the photo catalog.",
  );
  assert.equal(await fallbackCatalog.locator("#tag").isDisabled(), true);
  await fallbackCatalog
    .getByRole("button", { name: "Retry loading photos" })
    .click();
  await fallbackCatalog.waitForFunction(
    () => document.querySelectorAll(".card").length > 0,
  );
  assert.equal(attempts, 2);
  assert.equal(await fallbackCatalog.locator("#tag").inputValue(), "coffee");
  assert.equal(await fallbackCatalog.locator("#selection").inputValue(), "");
  assert.equal(await fallbackCatalog.locator("#status").textContent(), "");
  assert.equal(
    await fallbackCatalog
      .getByRole("button", { name: "Retry loading photos" })
      .isHidden(),
    true,
  );
  await fallbackCatalog.waitForLoadState("networkidle");
  await fallbackCatalog.close();
  const errors = [];
  const consoleErrors = [];
  for (const surface of [page, admin]) {
    surface.on("pageerror", (error) => errors.push(error.message));
    surface.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    surface.setDefaultTimeout(15000);
  }
  const enterFullscreen = async (surface, native = true) => {
    await surface
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    await surface.waitForFunction(
      () =>
        document.querySelector("#fullscreen").getAttribute("aria-pressed") ===
        "true",
    );
    if (native)
      await surface.waitForFunction(
        () => document.fullscreenElement?.id === "preview-viewer",
      );
    else
      assert.equal(
        await surface.evaluate(() => document.fullscreenElement),
        null,
      );
    assert.equal(await surface.locator("#editor").isVisible(), false);
    assert.match(
      await surface.locator("#preview").getAttribute("src"),
      /\/share\.jpg$/,
    );
    assert.match(
      await surface.locator("#fullscreen-credit").textContent(),
      /Photo: .*CC BY 4\.0/,
    );
    const bounds = await surface.evaluate(() => {
      const viewer = document.querySelector("#preview-viewer");
      const box = viewer.getBoundingClientRect();
      const image = document.querySelector("#preview").getBoundingClientRect();
      const controls = [...viewer.querySelectorAll(".dialog-bar button")].map(
        (button) => button.getBoundingClientRect(),
      );
      return {
        fills:
          Math.abs(box.width - innerWidth) < 1 &&
          Math.abs(box.height - innerHeight) < 1 &&
          box.x === 0 &&
          box.y === 0,
        fits:
          image.x >= 0 &&
          image.y >= 0 &&
          image.right <= innerWidth &&
          image.bottom <= innerHeight,
        fit: getComputedStyle(document.querySelector("#preview")).objectFit,
        overflow:
          viewer.scrollWidth > viewer.clientWidth ||
          viewer.scrollHeight > viewer.clientHeight,
        controlsInOneRow: controls.every(
          (box) => Math.abs(box.y - controls[0].y) < 1,
        ),
      };
    });
    assert.deepEqual(bounds, {
      fills: true,
      fits: true,
      fit: "contain",
      overflow: false,
      controlsInOneRow: true,
    });
  };
  const assertPreviewRestored = async (surface) => {
    await surface
      .getByRole("button", { name: "Full screen", exact: true })
      .waitFor();
    assert.equal(
      await surface.locator("#fullscreen").getAttribute("aria-pressed"),
      "false",
    );
    assert.equal(await surface.locator("#editor").isVisible(), true);
    assert.equal(
      await surface.locator("#detail").evaluate((dialog) => dialog.open),
      true,
    );
    assert.equal(
      await surface.evaluate(() => document.fullscreenElement),
      null,
    );
    assert.match(
      await surface.locator("#preview").getAttribute("src"),
      /\/preview\.jpg$/,
    );
    assert.equal(
      await surface.evaluate(() => document.activeElement.id),
      "fullscreen",
    );
  };
  await page.goto(`${origin}/2026/photos/`);
  const assertTheme = async (surface, theme) => {
    const state = await surface.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      dark: document.documentElement.classList.contains("dark"),
      saved: localStorage.getItem("sdlcai-theme"),
      background: getComputedStyle(document.body).backgroundColor,
    }));
    assert.deepEqual(state, {
      theme,
      dark: theme === "dark",
      saved: theme,
      background: theme === "dark" ? "rgb(16, 16, 16)" : "rgb(246, 244, 239)",
    });
    assert.equal(
      await surface.locator("[data-theme-label]").textContent(),
      theme === "dark" ? "Light" : "Dark",
    );
  };
  await page
    .locator("[data-theme-label]")
    .getByText("Light", { exact: true })
    .waitFor();
  await assertTheme(page, "dark");
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await assertTheme(page, "light");
  await page.reload();
  await page
    .locator("[data-theme-label]")
    .getByText("Dark", { exact: true })
    .waitFor();
  await assertTheme(page, "light");
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await page
    .locator("[data-theme-label]")
    .getByText("Dark", { exact: true })
    .waitFor();
  await assertTheme(page, "light");
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await page
    .getByRole("link", { name: "Media bank", exact: true })
    .first()
    .click();
  await page
    .locator("[data-theme-label]")
    .getByText("Light", { exact: true })
    .waitFor();
  await assertTheme(page, "dark");
  await page
    .waitForFunction(
      (count) => document.querySelectorAll(".card").length === count,
      highlightCount,
    )
    .catch(async (error) => {
      throw new Error(
        `${error.message}; page errors: ${JSON.stringify(errors)}; console: ${JSON.stringify(consoleErrors)}; state: ${JSON.stringify(await page.evaluate(() => ({ url: location.href, count: document.querySelectorAll(".card").length, status: document.querySelector("#status").textContent, selection: document.querySelector("#selection").value })))}`,
      );
    });
  assert.equal(
    await page.locator("#count").textContent(),
    `${highlightCount} photos shown · 0 in download selection`,
  );
  assert.equal(
    await page.locator("#stats").textContent(),
    `${photographerCount}photographers`,
  );
  assert.equal(
    await page.locator("#download-size option[value=original]").count(),
    0,
  );
  assert.equal(await page.locator("#person").isVisible(), false);
  const catalogTiming = await page.evaluate(() => ({
    request: performance
      .getEntriesByType("resource")
      .find((entry) => entry.name.endsWith("/api/photos/catalog"))?.startTime,
    paint: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
    load: performance.getEntriesByType("navigation")[0].loadEventEnd,
  }));
  // Presentation timestamps are rounded up to 4ms; resource timestamps retain
  // finer precision: https://www.w3.org/TR/paint-timing/#mark-paint-timing
  assert.ok(
    catalogTiming.request + 4 >= catalogTiming.paint,
    JSON.stringify(catalogTiming),
  );
  assert.ok(
    catalogTiming.request >= catalogTiming.load,
    JSON.stringify(catalogTiming),
  );
  const publicTags = [
    ...new Set(
      publicPhotos.flatMap((photo) =>
        initial.photos[photo.id].tags.map((tag) => tag.toLocaleLowerCase()),
      ),
    ),
  ].sort();
  assert.deepEqual(
    (
      await page
        .locator("#tag option")
        .evaluateAll((options) =>
          options.map((option) => option.value).filter(Boolean),
        )
    ).sort(),
    publicTags,
  );
  assert.equal(
    await page.locator('#tag option[value="welcome-sign"]').count(),
    1,
  );
  await page.locator("#selection").selectOption("");
  await page.locator("#photographer").selectOption("Jaakko Hollmén");
  assert.equal(
    await page.locator(".card").count(),
    publicPhotos.filter((photo) => photo.sourceId === "jaakko").length,
  );
  await page.locator("#tag").selectOption("welcome-sign");
  assert.equal(await page.locator(".card").count(), 1);
  await page.locator("#grid .image-button").first().click();
  assert.equal(
    await page.locator("#credit").textContent(),
    "Photo: Jaakko Hollmén / CC BY 4.0",
  );
  assert.match(
    await page.locator("#preview").getAttribute("src"),
    /\/preview\.jpg$/,
  );
  assert.equal(await page.locator("#original").isVisible(), false);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#tag").selectOption("");
  await page.locator("#photographer").selectOption("");
  for (const tag of [
    "beer",
    "coffee",
    "panel",
    "presentation-slides",
    "sponsors",
    "audio-mixer",
  ]) {
    await page.locator("#tag").selectOption(tag);
    const expected = publicPhotos
      .filter((photo) => initial.photos[photo.id].tags.includes(tag))
      .map((photo) => photo.id)
      .sort();
    assert.deepEqual(
      (
        await page
          .locator(".card")
          .evaluateAll((cards) => cards.map((card) => card.dataset.photoId))
      ).sort(),
      expected,
      `Exact membership for tag ${tag}`,
    );
  }
  await page.locator("#tag").selectOption("coffee");
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".card").length > 0,
  );
  assert.equal(await page.locator("#tag").inputValue(), "coffee");
  assert.equal(await page.locator("#selection").inputValue(), "");
  assert.equal(new URL(page.url()).searchParams.has("selection"), true);
  await page.locator("#photographer").selectOption("Bulent Sahin");
  assert.equal(
    await page.locator(".card").count(),
    publicPhotos.filter(
      (photo) =>
        photo.photographer === "Bulent Sahin" &&
        initial.photos[photo.id].tags.includes("coffee"),
    ).length,
  );
  await page.locator("#grid .image-button").first().click();
  assert.match(await page.locator("#photo-tags").textContent(), /Coffee/);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll(".card").length === count,
    publicPhotos.length,
  );
  assert.equal(await page.locator("#tag").inputValue(), "");
  await page.locator("#search").fill("Sini Tistelgrén");
  const sini = seed.photos.find(
    (photo) => photo.filename === "IMG_20261013_141709_015.jpg",
  );
  const siniCard = page.locator(`[data-photo-id="${sini.id}"]`);
  assert.equal(await siniCard.count(), 1);
  await siniCard.locator(".image-button").click();
  assert.match(
    await page.locator("#facts").textContent(),
    /2026-10-13 14:17:12/,
  );
  assert.match(
    await page.locator("#talk-context").textContent(),
    /Sini Tistelgrén/,
  );
  assert.match(
    await page.locator("#programme-context").textContent(),
    /Sini Tistelgrén/,
  );
  assert.equal(await page.locator("#confirmed-people").isVisible(), false);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#search").fill("");
  await page.locator("#selection").selectOption("selected");
  await page.locator("#grid .image-button").first().click();
  assert.equal(
    await page.getByRole("button", { name: "Save photo details" }).isVisible(),
    false,
  );
  assert.equal(await page.locator("#original").isVisible(), false);
  assert.ok(await page.locator("#public-caption").textContent());
  const firstTitle = await page.locator("#detail-title").textContent();
  await enterFullscreen(page);
  await page.keyboard.press("ArrowRight");
  assert.notEqual(
    await page.locator("#detail-title").textContent(),
    firstTitle,
  );
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#detail-title").textContent(), firstTitle);
  await page.keyboard.press("Escape");
  await assertPreviewRestored(page);
  await enterFullscreen(page);
  await page.evaluate(() => document.exitFullscreen());
  await assertPreviewRestored(page);
  await enterFullscreen(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#detail").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  await page.locator("#grid .image-button").first().click();
  assert.equal(
    await page.locator("#fullscreen").getAttribute("aria-pressed"),
    "false",
  );
  await page.getByRole("button", { name: "Next photo" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#selection").selectOption("");
  assert.equal(await page.locator(".card").count(), publicPhotos.length);
  await page.locator("#photographer").selectOption("Bulent Sahin");
  assert.equal(await page.locator(".card").count(), 65);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator("#search").fill(seed.photos[0].filename);
  assert.equal(await page.locator(".card").count(), 1);
  assert.equal(
    await page.locator("#count").textContent(),
    "1 photo shown · 0 in download selection",
  );
  const downloadSelection = page.locator(".card input[type=checkbox]");
  await downloadSelection.check();
  assert.equal(
    await page.locator("#count").textContent(),
    "1 photo shown · 1 in download selection",
  );
  await downloadSelection.uncheck();
  await page
    .getByRole("button", { name: "Select visible", exact: true })
    .click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download selection ZIP" }).click();
  const zip = unzipSync(
    new Uint8Array(await readFile(await (await downloaded).path())),
  );
  assert.match(strFromU8(zip["CREDITS.txt"]), /Juho Vepsäläinen.*CC BY 4.0/);
  assert.ok(zip["catalog.json"]);

  await admin.goto(`${origin}/admin/photos/`);
  await admin.waitForFunction(
    (count) => document.querySelectorAll(".card").length === count,
    seed.photos.length,
  );
  assert.match(
    await admin.locator("#stats").textContent(),
    new RegExp(`${seed.photos.length}photographs`),
  );
  assert.match(
    await admin.locator("#count").textContent(),
    new RegExp(`^${seed.photos.length} of ${seed.photos.length}`),
  );
  await admin.locator("#grid .image-button").first().click();
  await admin.locator('[name="caption"]').fill("Hosted browser check caption");
  const originalTags = await admin.locator('[name="tags"]').inputValue();
  await admin
    .locator('[name="tags"]')
    .fill(`${originalTags}, browser-review-tag`);
  await enterFullscreen(admin);
  await admin
    .getByRole("button", { name: "Exit full screen", exact: true })
    .click();
  await assertPreviewRestored(admin);
  assert.equal(
    await admin.locator('[name="caption"]').inputValue(),
    "Hosted browser check caption",
  );
  await admin.getByRole("button", { name: "Save photo details" }).click();
  await admin
    .getByText("Saved to the photo catalog.", { exact: true })
    .waitFor();
  assert.match(
    await admin.locator("#photo-tags").textContent(),
    /Browser review tag/,
  );
  assert.equal(
    await admin.locator('#tag option[value="browser-review-tag"]').count(),
    1,
  );
  await admin.getByRole("button", { name: "Close", exact: true }).click();
  await admin.locator("#tag").selectOption("browser-review-tag");
  assert.equal(await admin.locator(".card").count(), 1);
  await admin.reload();
  await admin
    .getByText("Hosted browser check caption", { exact: true })
    .waitFor();
  assert.equal(await admin.locator("#tag").inputValue(), "browser-review-tag");
  await admin.getByRole("button", { name: "Clear filters" }).click();
  await admin.waitForFunction(
    (count) => document.querySelectorAll(".card").length === count,
    seed.photos.length,
  );
  await page.reload();
  await page
    .getByText("Hosted browser check caption", { exact: true })
    .waitFor();

  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390, 320]) {
      for (const surface of [page, admin]) {
        if (
          (await surface.evaluate(
            () => document.documentElement.dataset.theme,
          )) !== theme
        )
          await surface
            .getByRole("button", { name: "Toggle dark mode" })
            .click();
        await assertTheme(surface, theme);
        await surface.setViewportSize({ width, height: 1000 });
        await surface.evaluate(() => document.fonts.ready);
        assert.equal(
          await surface.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `Overflow at ${width}px`,
        );
        await surface.addScriptTag({ content: axe });
        const violations = await surface.evaluate(async () =>
          (
            await axe.run(document, {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations.map(({ id, nodes }) => ({
            id,
            elements: nodes.map((node) => node.target),
          })),
        );
        assert.deepEqual(
          violations,
          [],
          `${theme} accessibility at ${width}px`,
        );
        if (width === 1440) {
          await surface.locator("#grid .image-button").first().click();
          const dialogViolations = await surface.evaluate(async () =>
            (
              await axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              })
            ).violations.map(({ id, nodes }) => ({
              id,
              elements: nodes.map((node) => node.target),
            })),
          );
          assert.deepEqual(
            dialogViolations,
            [],
            `${theme} photo dialog accessibility`,
          );
          await enterFullscreen(surface);
          const fullscreenViolations = await surface.evaluate(async () =>
            (
              await axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: ["wcag2a", "wcag2aa", "wcag21aa"],
                },
              })
            ).violations.map(({ id }) => id),
          );
          assert.deepEqual(
            fullscreenViolations,
            [],
            `${theme} fullscreen accessibility`,
          );
          await surface
            .getByRole("button", { name: "Exit full screen", exact: true })
            .click();
          await assertPreviewRestored(surface);
          await surface
            .getByRole("button", { name: "Close", exact: true })
            .click();
        }
      }
    }
  }
  for (const support of ["missing", "rejected"]) {
    const fallback = await publicContext.newPage();
    fallback.setDefaultTimeout(15000);
    fallback.on("pageerror", (error) => errors.push(error.message));
    await fallback.addInitScript((support) => {
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        configurable: true,
        value:
          support === "missing"
            ? undefined
            : () =>
                Promise.reject(
                  new DOMException("Fullscreen denied", "NotAllowedError"),
                ),
      });
    }, support);
    await fallback.goto(`${origin}/2026/photos/`);
    await fallback.locator("#grid .image-button").first().click();
    await fallback.addScriptTag({ content: axe });
    for (const viewport of support === "missing"
      ? [
          { width: 1440, height: 1000 },
          { width: 390, height: 844 },
          { width: 320, height: 568 },
          { width: 844, height: 390 },
        ]
      : [{ width: 390, height: 844 }]) {
      await fallback.setViewportSize(viewport);
      await enterFullscreen(fallback, false);
      await fallback.keyboard.press("Tab");
      assert.equal(
        await fallback.evaluate(() =>
          document
            .querySelector("#preview-viewer")
            .contains(document.activeElement),
        ),
        true,
      );
      const violations = await fallback.evaluate(async () =>
        (
          await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map(({ id }) => id),
      );
      assert.deepEqual(
        violations,
        [],
        `${support} fullscreen at ${viewport.width}px`,
      );
      await fallback.keyboard.press("Escape");
      await assertPreviewRestored(fallback);
    }
    await fallback.keyboard.press("Escape");
    await fallback.locator("#detail").waitFor({ state: "hidden" });
    await fallback.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "Hosted photo bank passed: public gallery, organizer edits, licensed ZIP, shared themes, native/fallback fullscreen, keyboard exit/navigation, preserved drafts and accessible desktop/mobile previews.",
  );
} finally {
  // Let image response streams finish before closing their browser clients.
  if (browser)
    await Promise.all(
      browser
        .contexts()
        .flatMap((context) =>
          context.pages().map((page) => page.waitForLoadState("networkidle")),
        ),
    );
  await browser?.close();
  await fixture.dispose();
}
