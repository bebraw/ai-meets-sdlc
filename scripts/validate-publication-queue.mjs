import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { closeBrowserServer } from "./layout-browser.mjs";
import { createWorkerFixture } from "../test/helpers/worker-fixture.mjs";

const vars = {
  ADMIN_USERNAME: "publication-admin",
  ADMIN_PASSWORD: "publication-test-password",
  TURNSTILE_SITE_KEY: "",
};
const authorization = `Basic ${Buffer.from(`${vars.ADMIN_USERNAME}:${vars.ADMIN_PASSWORD}`).toString("base64")}`;
const fixture = await createWorkerFixture({ vars });
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
  const options = {
    extraHTTPHeaders: { authorization },
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  };
  const context = await browser.newContext(options);
  const secondContext = await browser.newContext(options);
  const page = await context.newPage(),
    second = await secondContext.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  second.on("pageerror", (e) => errors.push(e.message));
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  const url = origin + "/admin/publication-queue/";
  const loaded = async (page) =>
    page.locator("[data-publication-item]").first().waitFor();
  const save = async (page, status = 200) => {
    const response = page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/publication-queue") &&
        r.request().method() === "PUT",
    );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    assert.equal((await response).status(), status);
    await page.waitForFunction(
      () => !document.querySelector("[data-publication-fields]")?.disabled,
    );
  };
  await page.goto(url);
  await loaded(page);
  assert.equal(await page.locator("[data-publication-item]").count(), 5);
  assert.equal(
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByLabel("Post copy", { exact: true })
    .fill("First device copy. <script>window.injected=true</script>");
  await page
    .getByLabel("Image alt text", { exact: true })
    .fill("Edited description of the takeaway card.");
  await page
    .getByLabel("Graphic format", { exact: true })
    .selectOption("landscape");
  await page.getByLabel("Status", { exact: true }).selectOption("ready");
  await save(page);
  await page.reload();
  await loaded(page);
  assert.equal(
    await page.getByLabel("Post copy", { exact: true }).inputValue(),
    "First device copy. <script>window.injected=true</script>",
  );
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(
    await page.getByLabel("Graphic format", { exact: true }).inputValue(),
    "landscape",
  );
  await second.goto(url);
  await loaded(second);
  assert.equal(
    await second.getByLabel("Post copy", { exact: true }).inputValue(),
    await page.getByLabel("Post copy", { exact: true }).inputValue(),
  );
  await page
    .getByLabel("Post copy", { exact: true })
    .fill("Unsaved first-device version");
  await second
    .getByLabel("Post copy", { exact: true })
    .fill("Saved second-device version");
  await save(second);
  await save(page, 409);
  await page
    .locator("[data-publication-conflict]")
    .waitFor({ state: "visible" });
  assert.equal(
    await page.getByLabel("Post copy", { exact: true }).inputValue(),
    "Unsaved first-device version",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByText("Compare the saved version", { exact: true }).click();
  assert.ok(
    (
      await page.locator("[data-publication-conflict] dl").textContent()
    ).includes("Saved second-device version"),
  );
  await page
    .getByRole("button", { name: "Copy draft text", exact: true })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "Unsaved first-device version",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Load saved version", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Post copy", { exact: true }).inputValue(),
    "Saved second-device version",
  );

  await page.getByLabel("Status", { exact: true }).selectOption("published");
  await page.getByLabel("Publication date", { exact: true }).fill("2026-10-23");
  await page
    .getByLabel("Published post URL", { exact: true })
    .fill("https://www.linkedin.com/feed/update/publication-test");
  await save(page);
  assert.equal(
    await page
      .getByRole("link", { name: "Open recorded publication", exact: true })
      .getAttribute("href"),
    "https://www.linkedin.com/feed/update/publication-test",
  );
  await mkdir(".cache/publication-queue-review", { recursive: true });
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download draft", exact: true })
    .click();
  await (
    await downloadEvent
  ).saveAs(".cache/publication-queue-review/draft.txt");
  assert.match(
    await readFile(".cache/publication-queue-review/draft.txt", "utf8"),
    /Saved second-device version[\s\S]*IMAGE ALT TEXT[\s\S]*https:\/\/www.linkedin.com/,
  );
  const pngEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download landscape PNG", exact: true })
    .click();
  await (
    await pngEvent
  ).saveAs(".cache/publication-queue-review/landscape.png");
  const png = await readFile(".cache/publication-queue-review/landscape.png");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  await page.getByLabel("Channel", { exact: true }).selectOption("website");
  assert.equal(await page.locator("[data-publication-item]").count(), 1);
  await page.locator('[data-publication-item="archive-announcement"]').click();
  assert.ok(
    (
      await page.getByLabel("Announcement title", { exact: true }).inputValue()
    ).includes("recordings and talk summaries"),
  );
  await page
    .getByLabel("Announcement title", { exact: true })
    .fill("Edited archive announcement");
  await page.getByLabel("Subtitle", { exact: true }).fill("Edited subtitle");
  await page
    .getByLabel("Listing summary", { exact: true })
    .fill("Edited listing summary");
  await save(page);
  await page.getByLabel("Channel", { exact: true }).selectOption("newsletter");
  await page.locator('[data-publication-item="archive-newsletter"]').click();
  await page
    .getByLabel("Email subject", { exact: true })
    .fill("Edited newsletter subject");
  await page
    .getByLabel("Email preheader", { exact: true })
    .fill("Edited preheader");
  await page.getByLabel("Status", { exact: true }).selectOption("scheduled");
  await page.getByLabel("Publication date", { exact: true }).fill("2026-10-26");
  await save(page);
  await second.goto(url + "#archive-newsletter");
  await second.getByLabel("Email subject", { exact: true }).waitFor();
  // Fragment navigation selects from the open tab's snapshot; reload fetches
  // the latest saved versions from the other device.
  await second.reload();
  await loaded(second);
  assert.equal(
    await second.getByLabel("Email subject", { exact: true }).inputValue(),
    "Edited newsletter subject",
  );
  assert.equal(
    await second.getByLabel("Email preheader", { exact: true }).inputValue(),
    "Edited preheader",
  );
  assert.equal(
    await second.getByLabel("Status", { exact: true }).inputValue(),
    "scheduled",
  );
  await page
    .getByLabel("Review status", { exact: true })
    .selectOption("published");
  assert.equal(await page.locator("[data-publication-item]").count(), 0);
  await page.getByLabel("Review status", { exact: true }).selectOption("all");
  await page.getByLabel("Channel", { exact: true }).selectOption("all");
  await page.locator('[data-publication-item="delivery-01"]').click();
  // Clipboard-denied users retain a selected text fallback.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    }),
  );
  await page
    .getByRole("button", { name: "Copy draft text", exact: true })
    .click();
  assert.match(
    await page.locator("[data-publication-notice]").textContent(),
    /selected/,
  );
  // A failed save must leave the editor usable and the local copy intact.
  await page.route("**/api/admin/publication-queue", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"Temporary failure"}',
        })
      : route.continue(),
  );
  await page
    .getByLabel("Post copy", { exact: true })
    .fill("Retain this after a failed save");
  await save(page, 503);
  assert.equal(
    await page.getByLabel("Post copy", { exact: true }).inputValue(),
    "Retain this after a failed save",
  );
  assert.equal(
    await page.getByLabel("Post copy", { exact: true }).isEnabled(),
    true,
  );
  await page.unroute("**/api/admin/publication-queue");
  await save(page);

  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const id of [
    "delivery-01",
    "archive-announcement",
    "archive-newsletter",
  ]) {
    await page.locator(`[data-publication-item="${id}"]`).click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(async (theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
          await document.fonts.ready;
          await Promise.all(
            document.getAnimations().map((a) => a.finished.catch(() => {})),
          );
        }, theme);
        if (id === "delivery-01")
          await page
            .locator("[data-publication-graphic]")
            .evaluate(async (image) => {
              image.loading = "eager";
              await image.decode();
            });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `${id} ${width}/${theme} overflow`,
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
          `${id} ${width}/${theme}`,
        );
        await page.screenshot({
          path: `.cache/publication-queue-review/${id}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
  }
  assert.deepEqual(errors, []);
  await context.close();
  await secondContext.close();
  await browser.close();
  console.log(
    "Publication queue passed: five drafts, edits across browser contexts, safe conflicts and failed saves, graphics, downloads, tracking, filters and responsive accessibility.",
  );
} finally {
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}
