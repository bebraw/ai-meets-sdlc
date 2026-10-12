import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, webkit } from "playwright";

const root = path.resolve("build");
const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  let file = path.join(root, new URL(request.url, "http://localhost").pathname);
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    await stat(file);
    response.writeHead(200, {
      "content-type":
        contentTypes[path.extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

function observeTransitions() {
  window.transitionReport = null;
  const observe = (transition) => {
    const report = (window.transitionReport = {
      ready: false,
      finished: false,
    });
    transition.ready.then(
      () => {
        report.ready = true;
        report.animations = document.getAnimations().map((animation) => ({
          name: animation.animationName,
          pseudo: animation.effect.pseudoElement,
          duration: animation.effect.getComputedTiming().duration,
        }));
      },
      (error) => {
        report.error = error.message;
      },
    );
    transition.finished.then(() => {
      report.finished = true;
    });
  };
  addEventListener("pagereveal", (event) => {
    if (event.viewTransition) observe(event.viewTransition);
  });
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = (...args) => {
    const transition = start(...args);
    observe(transition);
    return transition;
  };
}

async function reportFor(page) {
  await page.waitForFunction(() => window.transitionReport?.finished);
  const report = await page.evaluate(() => window.transitionReport);
  assert.equal(
    report.error,
    undefined,
    "View Transition should not be skipped",
  );
  assert.equal(report.ready, true);
  return report;
}

function assertPageFade(report) {
  for (const pseudo of [
    "::view-transition-old(root)",
    "::view-transition-new(root)",
  ]) {
    assert.ok(
      report.animations.some(
        (animation) => animation.pseudo === pseudo && animation.duration > 1,
      ),
      `${pseudo} should animate during page navigation`,
    );
  }
}

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
      for (const motion of ["no-preference", "reduce"]) {
        const context = await browser.newContext({ reducedMotion: motion });
        try {
          await context.addInitScript(observeTransitions);
          const page = await context.newPage();
          await page.goto(origin);
          await page.locator('a[href="/speakers/"]').first().click();
          const report = await reportFor(page);
          if (motion === "reduce") {
            assert.ok(
              report.animations.every((animation) => animation.duration <= 1),
              "Reduced motion should suppress page animations",
            );
          } else {
            assertPageFade(report);
            await page.locator('a[href="/schedule/"]').first().click();
            assertPageFade(await reportFor(page));
            await page.goBack();
            assertPageFade(await reportFor(page));
          }

          await page.goto(`${origin}/slides/closing/`);
          await page.evaluate(() => document.fonts.ready);
          await page.keyboard.press("ArrowRight");
          if (motion === "reduce") {
            assert.equal(
              await page.evaluate(() => window.transitionReport),
              null,
              "Reduced motion should switch slides without a View Transition",
            );
          } else {
            const slide = await reportFor(page);
            assert.ok(
              slide.animations.some(
                (animation) =>
                  animation.name === "presentation-slide-in-forward",
              ),
              "Slide navigation should retain its directional animation",
            );
            assert.ok(
              !slide.animations.some(
                (animation) =>
                  animation.pseudo === "::view-transition-old(root)" ||
                  animation.pseudo === "::view-transition-new(root)",
              ),
              "Slides should animate independently of the page root",
            );
          }
          console.log(
            `${name}/${motion}: page navigation, reduced motion, and slide transitions passed.`,
          );
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
