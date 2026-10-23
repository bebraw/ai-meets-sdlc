import { getPublishedTalks } from "../site/published-talks.ts";
import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { closeBrowserServer } from "./layout-browser.mjs";
import { createWorkerFixture } from "../test/helpers/worker-fixture.mjs";
import { getTalkPreviews } from "../site/talk-previews.ts";
import { unzipSync } from "fflate";

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
    .locator("[data-talk-graphic-thumbnail]")
    .evaluateAll(async (images) => {
      for (const image of images) image.loading = "eager";
      await Promise.all(images.map((image) => image.decode()));
    });
  const packDownload = page.waitForEvent("download");
  await page
    .getByRole("link", {
      name: "Download all 20 graphics & post copy (ZIP)",
      exact: true,
    })
    .click();
  const pack = await packDownload;
  await pack.saveAs(".cache/content-inventory-review/takeaway-graphics.zip");
  assert.equal(
    Object.keys(
      unzipSync(
        await readFile(".cache/content-inventory-review/takeaway-graphics.zip"),
      ),
    ).length,
    30,
  );
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
  const pngDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Portrait PNG · 1080 x 1350", exact: true })
    .click();
  await (
    await pngDownload
  ).saveAs(".cache/content-inventory-review/takeaway-portrait.png");
  const png = await readFile(
    ".cache/content-inventory-review/takeaway-portrait.png",
  );
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  const copyDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download post copy & alt text", exact: true })
    .click();
  await (
    await copyDownload
  ).saveAs(".cache/content-inventory-review/takeaway-copy.txt");
  assert.match(
    await readFile(".cache/content-inventory-review/takeaway-copy.txt", "utf8"),
    /ALT TEXT[\s\S]*SOURCE PASSAGES[\s\S]*CONTEXT & QUALIFICATIONS/,
  );
  // Every talk has its own deep link and preserves the same reading structure.
  await page.setViewportSize({ width: 320, height: 1000 });
  for (const talk of getTalkPreviews().items) {
    await page.goto(origin + talk.href);
    assert.equal(await page.locator("h1").textContent(), talk.title);
    assert.equal(await page.locator("[data-talk-key-point]").count(), 5);
    assert.equal(
      await page.locator('meta[name="robots"]').getAttribute("content"),
      "noindex,nofollow,noarchive",
    );
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.locator("[data-talk-graphic]").evaluate(async (image) => {
      image.loading = "eager";
      await image.decode();
    });
    assert.match(
      await page
        .locator("[data-talk-graphic]")
        .evaluate((image) => image.currentSrc),
      /summary-portrait\.png$/,
    );
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
    if (path.endsWith("genai-software-engineering/"))
      await page
        .getByText("Read post copy & alt text", { exact: true })
        .click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (path.endsWith("genai-software-engineering/")) {
        await page.waitForFunction(
          (format) =>
            document
              .querySelector("[data-talk-graphic]")
              .currentSrc.endsWith(`summary-${format}.png`),
          width < 640 ? "portrait" : "landscape",
        );
      }
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
  const publicContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 320, height: 1000 },
  });
  const publicPage = await publicContext.newPage();
  publicPage.on("pageerror", (error) => errors.push(error.message));
  for (const talk of getPublishedTalks().items) {
    const response = await publicPage.goto(origin + talk.href);
    assert.equal(response.status(), 200);
    assert.equal(await publicPage.locator("h1").textContent(), talk.title);
    assert.equal(await publicPage.locator("[data-talk-key-point]").count(), 5);
    assert.equal(
      await publicPage
        .locator('meta[name="robots"][content*="noindex"]')
        .count(),
      0,
    );
    await publicPage.locator("[data-talk-graphic]").evaluate(async (image) => {
      image.loading = "eager";
      await image.decode();
    });
    assert.match(
      await publicPage
        .locator("[data-talk-graphic]")
        .evaluate((image) => image.currentSrc),
      /summary-portrait\.png\?v=/,
    );
    assert.equal(
      await publicPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await publicPage.goto(origin + "/2026/talks/");
  assert.equal(
    await publicPage.locator("[data-talk-summary-card]").count(),
    10,
  );
  const publicPackDownload = publicPage.waitForEvent("download");
  await publicPage
    .getByRole("link", {
      name: "Download all 20 graphics & post copy (ZIP)",
      exact: true,
    })
    .click();
  await (
    await publicPackDownload
  ).saveAs(".cache/content-inventory-review/public-takeaway-graphics.zip");
  const publicEntries = unzipSync(
    await readFile(
      ".cache/content-inventory-review/public-takeaway-graphics.zip",
    ),
  );
  assert.equal(Object.keys(publicEntries).length, 30);
  for (const [name, data] of Object.entries(publicEntries))
    if (name.endsWith(".txt"))
      assert.doesNotMatch(
        new TextDecoder().decode(data),
        /EDITORIAL DRAFT|caption review|ASR|\/admin\//,
      );
  await publicPage.goto(origin + "/2026/talks/genai-software-engineering/");
  await publicPage
    .getByText("Read post copy & alt text", { exact: true })
    .click();
  for (const width of [320, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await publicPage.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, theme);
      await publicPage.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          document.getAnimations().map((a) => a.finished.catch(() => {})),
        );
      });
      assert.equal(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `public summary ${width}/${theme}`,
      );
      await publicPage.addScriptTag({ content: axe });
      const violations = await publicPage.evaluate(
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
        `public summary ${width}/${theme}`,
      );
      await publicPage.screenshot({
        path: `.cache/content-inventory-review/public-talk-detail-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await publicContext.close();
  assert.deepEqual(errors, []);
  await context.close();
  await browser.close();
  console.log(
    "Content inventory, protected previews and public talk summaries passed: filters, shortlist, handoffs, source timestamps, downloads, navigation, responsive graphics and accessibility.",
  );
} finally {
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}
