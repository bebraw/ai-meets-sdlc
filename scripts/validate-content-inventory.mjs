import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { closeBrowserServer } from "./layout-browser.mjs";
import { createWorkerFixture } from "../test/helpers/worker-fixture.mjs";
import { getTalkPreviews } from "../site/talk-previews.ts";

const fixture = await createWorkerFixture({
  vars: {
    ADMIN_USERNAME: "inventory-admin",
    ADMIN_PASSWORD: "local-inventory-password",
    TURNSTILE_SITE_KEY: "",
  },
});
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
  server = await chromium.launchServer({ executablePath });
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({
    extraHTTPHeaders: {
      authorization: `Basic ${Buffer.from("inventory-admin:local-inventory-password").toString("base64")}`,
    },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  const url = `${origin}/admin/content-inventory/`;
  const visibleCards = () => page.locator("[data-inventory-item]:visible");
  await page.goto(url);
  assert.equal(await visibleCards().count(), 80);
  await page.getByLabel("Content type", { exact: true }).selectOption("clip");
  assert.equal(await visibleCards().count(), 29);
  await page
    .getByLabel("Speaker or author", { exact: true })
    .selectOption("Mo Khazali");
  assert.equal(await visibleCards().count(), 2);
  await page.getByLabel("Search content", { exact: true }).fill("bottleneck");
  assert.equal(await visibleCards().count(), 1);
  assert.equal(
    await visibleCards().first().getAttribute("id"),
    "mo-talk-clip-02",
  );
  await page
    .getByLabel("Search content", { exact: true })
    .fill("no-matching-material-xyz");
  await page.locator("[data-inventory-empty]").waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("[data-inventory-item]")].filter(
        (el) => !el.hidden,
      ).length === 80,
  );
  await page.getByLabel("Search content", { exact: true }).fill("Tistelgren");
  assert.ok((await visibleCards().count()) > 0, "Search ignores accents");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByLabel("Review state", { exact: true })
    .selectOption("published");
  assert.equal(await visibleCards().count(), 17);
  await page.getByLabel("Review state", { exact: true }).selectOption("review");
  assert.equal(await visibleCards().count(), 51);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add suggested starting set", exact: true })
    .click();
  assert.equal(await page.locator("[data-inventory-pick]:checked").count(), 5);
  await page.reload();
  assert.equal(await page.locator("[data-inventory-pick]:checked").count(), 5);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Local clipboard denial");
        },
      },
      configurable: true,
    }),
  );
  await page
    .getByRole("button", { name: "Copy editorial handoff", exact: true })
    .click();
  await page.locator("[data-inventory-fallback]").waitFor({ state: "visible" });
  const handoff = await page.locator("#inventory-handoff").inputValue();
  assert.match(handoff, /youtube\.com\/watch\?v=l8quIPHmakI&t=2087s/);
  assert.match(handoff, /before rendering or publishing/);
  await mkdir(".cache/content-inventory-review", { recursive: true });
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download handoff", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs(".cache/content-inventory-review/shortlist.txt");
  assert.equal(
    await readFile(".cache/content-inventory-review/shortlist.txt", "utf8"),
    handoff,
  );
  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .getByLabel("Content type", { exact: true })
      .selectOption("series");
    assert.equal(await visibleCards().count(), 4);
    await page
      .locator("[data-inventory-fallback]")
      .evaluate((el) => (el.hidden = true));
    for (const theme of ["light", "dark"]) {
      const currentTheme = await page.evaluate(() =>
        document.documentElement.classList.contains("dark") ? "dark" : "light",
      );
      if (currentTheme !== theme)
        await page
          .getByRole("button", { name: "Toggle dark mode", exact: true })
          .click();
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${width}/${theme}: overflow`,
      );
      await page.addScriptTag({ content: axe });
      const violations = await page.evaluate(
        async () =>
          (
            await axe.run(document, {
              runOnly: {
                type: "tag",
                values: [
                  "wcag2a",
                  "wcag2aa",
                  "wcag21aa",
                  "wcag22aa",
                  "best-practice",
                ],
              },
            })
          ).violations,
      );
      assert.deepEqual(
        violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
        [],
        `${width}/${theme}`,
      );
      await page.screenshot({
        path: `.cache/content-inventory-review/${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await page
    .getByRole("button", { name: "Clear shortlist", exact: true })
    .click();
  assert.equal(await page.locator("[data-inventory-pick]:checked").count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Download handoff", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("link", { name: "Talk companion previews", exact: true })
    .click();
  assert.equal(await page.locator("[data-talk-preview-card]").count(), 10);
  await page
    .getByRole("link", {
      name: "Read preview: 1978: The Last Good Year",
      exact: true,
    })
    .click();
  assert.equal(await page.locator("[data-talk-key-point]").count(), 5);
  assert.equal(
    await page.locator("[data-talk-key-point] a").first().getAttribute("href"),
    "https://www.youtube.com/watch?v=l8quIPHmakI&t=403s",
  );
  assert.equal(await page.locator("[data-talk-chapter]").count(), 10);
  // Every talk has its own deep link and preserves the same reading structure.
  for (const talk of getTalkPreviews().items) {
    await page.goto(origin + talk.href);
    assert.equal(await page.locator("h1").textContent(), talk.title);
    assert.equal(await page.locator("[data-talk-key-point]").count(), 5);
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex,nofollow,noarchive",
    );
    await page.setViewportSize({ width: 320, height: 1000 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${talk.slug}: mobile overflow`,
    );
  }
  for (const path of [
    "/admin/talk-previews/",
    "/admin/talk-previews/genai-software-engineering/",
  ]) {
    await page.goto(origin + path);
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        const current = await page.evaluate(() =>
          document.documentElement.classList.contains("dark")
            ? "dark"
            : "light",
        );
        if (current !== theme)
          await page
            .getByRole("button", { name: "Toggle dark mode", exact: true })
            .click();
        await page.mouse.move(0, 0);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${path}: ${width}/${theme} overflow`,
        );
        await page.addScriptTag({ content: axe });
        const violations = await page.evaluate(
          async () =>
            (
              await axe.run(document, {
                runOnly: {
                  type: "tag",
                  values: [
                    "wcag2a",
                    "wcag2aa",
                    "wcag21aa",
                    "wcag22aa",
                    "best-practice",
                  ],
                },
              })
            ).violations,
        );
        assert.deepEqual(
          violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
          [],
          `${path}: ${width}/${theme}`,
        );
        await page.screenshot({
          path: `.cache/content-inventory-review/${path.endsWith("genai-software-engineering/") ? "talk-detail" : "talk-index"}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.goto(origin + "/admin/");
  await page
    .getByRole("link", { name: /Content inventory/ })
    .first()
    .click();
  assert.equal(new URL(page.url()).pathname, "/admin/content-inventory/");
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
  console.log(
    "Content inventory and talk preview browser checks passed: filters, shortlist, handoff, ten talk pages, source timestamps, navigation, responsive layout and accessibility.",
  );
} finally {
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}
