import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import seed from "../site/data/event-photos.json" with { type: "json" };
import {
  createReceiptFixture,
  receiptAdmin,
} from "../test/helpers/receipt-fixture.mjs";

const fixture = await createReceiptFixture();
let browser;
try {
  // A repository-owned sample keeps this check independent of local originals.
  const jpeg = await readFile("assets/speakers/joongi-shin.jpg");
  for (const photo of seed.photos) {
    for (const variant of ["thumbnail", "preview", "share", "original"])
      await fixture.env.SPEAKER_UPLOADS.put(
        `event-photos/${seed.eventId}/${photo.id}/${variant}.jpg`,
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
      };
    });
    assert.deepEqual(bounds, {
      fills: true,
      fits: true,
      fit: "contain",
      overflow: false,
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
  await page.goto(`${origin}/photos/`);
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
  await page.getByRole("link", { name: "Photos", exact: true }).first().click();
  await page
    .locator("[data-theme-label]")
    .getByText("Light", { exact: true })
    .waitFor();
  await assertTheme(page, "dark");
  await page
    .waitForFunction(() => document.querySelectorAll(".card").length === 43)
    .catch(async (error) => {
      throw new Error(
        `${error.message}; page errors: ${JSON.stringify(errors)}; console: ${JSON.stringify(consoleErrors)}; state: ${JSON.stringify(await page.evaluate(() => ({ url: location.href, count: document.querySelectorAll(".card").length, status: document.querySelector("#status").textContent, selection: document.querySelector("#selection").value })))}`,
      );
    });
  assert.equal(
    await page.locator("#count").textContent(),
    "43 photos shown · 0 in download selection",
  );
  assert.equal(await page.locator("#stats").textContent(), "2photographers");
  assert.equal(
    await page.locator("#download-size option[value=original]").count(),
    0,
  );
  assert.equal(await page.locator("#person").isVisible(), false);
  await page.locator("#selection").selectOption("");
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
  assert.equal(await page.locator(".card").count(), 188);
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
    () => document.querySelectorAll(".card").length === 188,
  );
  assert.match(await admin.locator("#stats").textContent(), /188photographs/);
  assert.match(await admin.locator("#count").textContent(), /^188 of 188/);
  await admin.locator("#grid .image-button").first().click();
  await admin.locator('[name="caption"]').fill("Hosted browser check caption");
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
  await admin.getByRole("button", { name: "Close", exact: true }).click();
  await admin.reload();
  await admin
    .getByText("Hosted browser check caption", { exact: true })
    .waitFor();
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
    await fallback.goto(`${origin}/photos/`);
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
  await browser?.close();
  await fixture.dispose();
}
