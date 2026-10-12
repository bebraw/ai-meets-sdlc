import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, webkit } from "playwright";

// This checks the real built opening and closing decks. Video events are simulated; the production
// film is private R2 media, so CI neither needs production credentials nor
// downloads a two-minute movie.
const root = path.resolve("build");
const contentTypes = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  let file = path.join(root, decodeURIComponent(pathname));
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    await stat(file);
    response.writeHead(200, {
      "content-type":
        contentTypes[path.extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = process.env.OPENING_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });

try {
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    const browser = await engine.launch(
      name === "chromium" && process.platform === "darwin"
        ? {
            executablePath:
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {},
    );
    try {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/admin/intro/**", (route) =>
        route.fulfill({ status: 204 }),
      );
      await page.addInitScript(() => {
        window.videoPauses = 0;
        window.videoFailure = null;
        window.videoPlays = [];
        HTMLMediaElement.prototype.play = function () {
          window.videoPlays.push(this.src);
          if (window.videoFailure) {
            const name = window.videoFailure;
            window.videoFailure = null;
            return Promise.reject(new DOMException("Playback failed", name));
          }
          this.dispatchEvent(new Event("play"));
          return Promise.resolve();
        };
        HTMLMediaElement.prototype.load = function () {};
        HTMLMediaElement.prototype.pause = function () {
          window.videoPauses += 1;
        };
      });
      const active = page.locator("[data-presentation-slide].is-active");
      for (const { deck, ids, prefix } of [
        {
          deck: "opening",
          ids: [
            "welcome",
            "sold-out",
            "themes",
            "speakers",
            "schedule",
            "afterparty",
            "hallway-track",
            "pacman-rule",
            "questions",
            "sponsors",
            "code-of-conduct",
            "sdlcai",
          ],
          prefix: "",
        },
        {
          deck: "closing",
          ids: [
            "recap",
            "speakers",
            "sponsors",
            "crew",
            "attendees",
            "group-photo",
            "logo",
            "afterparty",
          ],
          prefix: "closing-",
        },
      ]) {
        await page.goto(`${origin}/slides/${deck}/`);
        await page.evaluate(() => document.fonts.ready);
        assert.deepEqual(
          await page
            .locator("[data-presentation-slide]")
            .evaluateAll((slides) =>
              slides.map((slide) => slide.dataset.slideId),
            ),
          ids,
        );
        for (const viewport of [
          { width: 1920, height: 1080 },
          { width: 1280, height: 720 },
          { width: 1024, height: 768 },
          { width: 390, height: 844 },
        ]) {
          await page.setViewportSize(viewport);
          await page.keyboard.press("Home");
          for (const id of ids) {
            await page.waitForFunction(() =>
              [...document.querySelectorAll(".is-active img")].every(
                (image) => image.complete && image.naturalWidth > 0,
              ),
            );
            assert.equal(await active.getAttribute("data-slide-id"), id);
            assert.equal(
              await active.locator("[data-slide-progress]").textContent(),
              `${ids.indexOf(id) + 1} / ${ids.length}`,
            );
            const overflow = await active.evaluate((slide) => {
              const bounds = slide.getBoundingClientRect();
              return [
                ...slide.querySelectorAll(
                  ".opening-content, h1, h2, p, li, figure, img, svg, figcaption, a",
                ),
              ].flatMap((element) => {
                const rect = element.getBoundingClientRect();
                if (!rect.width || !rect.height) return [];
                return rect.left < bounds.left - 1 ||
                  rect.top < bounds.top - 1 ||
                  rect.right > bounds.right + 1 ||
                  rect.bottom > bounds.bottom + 1 ||
                  element.scrollWidth > element.clientWidth + 2
                  ? [
                      element.tagName +
                        ": " +
                        (element.getAttribute("alt") ??
                          element.textContent.slice(0, 80)) +
                        ` ${JSON.stringify({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: element.clientWidth, scrollWidth: element.scrollWidth })}`,
                    ]
                  : [];
              });
            });
            if (output && name === "chromium" && viewport.width === 1920) {
              await page.screenshot({
                path: path.join(output, `${prefix}${id}.png`),
              });
              await writeFile(
                path.join(output, `${prefix}${id}.json`),
                JSON.stringify(
                  await active.evaluate((slide) =>
                    [
                      ...slide.querySelectorAll(
                        ".opening-header,.opening-content,.opening-footer,h1",
                      ),
                    ].map((el) => ({
                      tag: el.tagName,
                      class: el.className,
                      text: el.textContent.slice(0, 80),
                      rect: el.getBoundingClientRect().toJSON(),
                      fontSize: getComputedStyle(el).fontSize,
                    })),
                  ),
                  null,
                  2,
                ),
              );
            }
            assert.deepEqual(
              overflow,
              [],
              `${name} ${deck} ${viewport.width} ${id}`,
            );
            await page.keyboard.press("ArrowRight");
          }
        }
      }
      await page.goto(`${origin}/slides/closing/?slideId=group-photo`);
      assert.equal(await active.getAttribute("data-slide-id"), "group-photo");
      assert.equal(await active.locator(".closing-camera").count(), 1);
      await page.keyboard.press("ArrowRight");
      assert.equal(await active.getAttribute("data-slide-id"), "logo");
      assert.equal(
        await active.locator(".closing-logo-image").getAttribute("src"),
        "/assets/logo.svg",
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(await active.getAttribute("data-slide-id"), "afterparty");
      assert.equal(await active.locator("img").getAttribute("alt"), "Tada!");
      await page.keyboard.press("ArrowRight");
      assert.equal(await active.getAttribute("data-slide-id"), "afterparty");
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(`${origin}/slides/opening/?slideId=questions`);
      assert.equal(await active.getAttribute("data-slide-id"), "questions");
      assert.equal(
        await active.locator(".opening-qa-link").innerText(),
        "sdlcai.org/qa",
      );
      await page.keyboard.press("Home");
      await page
        .getByRole("button", { name: "Next slide", exact: true })
        .focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(await active.getAttribute("data-slide-id"), "sold-out");

      await page.goto(`${origin}/slides/opening/?intro=1`);
      await page.waitForFunction(
        () => !document.querySelector("[data-opening-preroll]").hidden,
      );
      assert.equal(
        await page.locator("[data-presentation-deck]").isVisible(),
        false,
      );
      assert.match(
        await page.locator("video").getAttribute("src"),
        /\/4k\.mp4$/,
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(await active.getAttribute("data-slide-id"), "welcome");
      await page
        .getByRole("button", { name: "Play intro", exact: true })
        .click();
      assert.equal(
        await page.locator("[data-video-prompt]").isVisible(),
        false,
      );
      await page.locator("video").dispatchEvent("ended");
      assert.equal(
        await page.locator("[data-presentation-deck]").isVisible(),
        true,
      );
      assert.equal(await active.getAttribute("data-slide-id"), "welcome");
      assert.equal(new URL(page.url()).searchParams.has("intro"), false);
      assert.ok(await page.evaluate(() => window.videoPauses > 0));
      assert.equal(await page.locator("[data-use-preview]").isVisible(), false);

      // Unsupported 4K and media errors recover once, while a permission error
      // leaves resolution unchanged and allows the presenter to try Play again.
      await page.goto(`${origin}/slides/opening/?intro=1`);
      await page.evaluate(() => {
        window.videoFailure = "NotSupportedError";
      });
      await page
        .getByRole("button", { name: "Play intro", exact: true })
        .click();
      await page.waitForFunction(() =>
        document.querySelector("video").src.endsWith("/preview.mp4"),
      );
      assert.equal(
        await page.locator("[data-opening-quality]").innerText(),
        "1080p",
      );
      assert.equal(await page.locator("[data-video-error]").isVisible(), false);
      await page.locator("video").dispatchEvent("error");
      assert.equal(await page.locator("[data-video-error]").isVisible(), true);
      assert.equal(await page.locator("[data-video-prompt]").isVisible(), true);

      await page.goto(`${origin}/slides/opening/?intro=1`);
      await page.evaluate(() => {
        window.videoFailure = "NotAllowedError";
      });
      await page
        .getByRole("button", { name: "Play intro", exact: true })
        .click();
      assert.match(
        await page.locator("video").getAttribute("src"),
        /\/4k\.mp4$/,
      );
      assert.equal(await page.locator("[data-video-prompt]").isVisible(), true);
      await page
        .getByRole("button", { name: "Play intro", exact: true })
        .click();
      await page.locator("video").dispatchEvent("error");
      assert.match(
        await page.locator("video").getAttribute("src"),
        /\/preview\.mp4$/,
      );
      assert.equal(await page.locator("[data-video-error]").isVisible(), false);

      await page.goto(`${origin}/slides/opening/?intro=1`);
      await page
        .getByRole("button", { name: "Play intro", exact: true })
        .click();
      await page.locator("video").evaluate((video) => {
        video.currentTime = 42;
      });
      await page
        .getByRole("button", { name: "Use 1080p", exact: true })
        .click();
      assert.match(
        await page.locator("video").getAttribute("src"),
        /\/preview\.mp4$/,
      );
      assert.equal(
        await page.locator("video").evaluate((video) => video.currentTime),
        42,
      );

      await page.goto(`${origin}/slides/opening/?intro=1`);
      await page
        .getByRole("button", { name: "Continue to welcome", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await page.locator("[data-opening-preroll]").isVisible(),
        false,
      );
      assert.equal(await active.getAttribute("data-slide-id"), "welcome");
      await page.locator("video").dispatchEvent("error");
      assert.match(
        await page.locator("video").getAttribute("src"),
        /\/4k\.mp4$/,
      );

      await page.goto(`${origin}/admin/`);
      const eventDay = page.locator("[data-admin-workspace-group]", {
        has: page.locator("h2#event-day"),
      });
      for (const [label, href] of [
        ["Opening slides", "/slides/opening/?intro=1"],
        ["Closing slides", "/slides/closing/"],
      ]) {
        assert.equal(
          await eventDay
            .getByRole("link", { name: new RegExp(label) })
            .getAttribute("href"),
          href,
        );
      }
      await page.goto(`${origin}/admin-slides/`);
      for (const href of [
        "/slides/opening/",
        "/slides/opening/?intro=1",
        "/slides/closing/",
      ]) {
        assert.equal(
          (await page.locator(`a[href="${href}"]`).count()) > 0,
          true,
        );
      }
      assert.deepEqual(errors, []);
      console.log(
        `${name}: opening/closing layouts and admin shortcuts passed; 4K playback selection, 1080p recovery, navigation, photo-to-party ending, and pre-roll passed.`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
