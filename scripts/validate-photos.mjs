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
  await page.goto(`${origin}/photos/`);
  await page
    .waitForFunction(() => document.querySelectorAll(".card").length === 30)
    .catch(async (error) => {
      throw new Error(
        `${error.message}; page errors: ${JSON.stringify(errors)}; console: ${JSON.stringify(consoleErrors)}; state: ${JSON.stringify(await page.evaluate(() => ({ url: location.href, count: document.querySelectorAll(".card").length, status: document.querySelector("#status").textContent, selection: document.querySelector("#selection").value })))}`,
      );
    });
  assert.match(await page.locator("#count").textContent(), /^30 of 188/);
  assert.equal(
    await page.locator("#download-size option[value=original]").count(),
    0,
  );
  assert.equal(await page.locator("#person").isVisible(), false);
  await page.locator("#grid .image-button").first().click();
  assert.equal(
    await page.getByRole("button", { name: "Save photo details" }).isVisible(),
    false,
  );
  assert.equal(await page.locator("#original").isVisible(), false);
  assert.ok(await page.locator("#public-caption").textContent());
  await page.getByRole("button", { name: "Next photo" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#selection").selectOption("");
  assert.equal(await page.locator(".card").count(), 188);
  await page.locator("#photographer").selectOption("Bulent Sahin");
  assert.equal(await page.locator(".card").count(), 65);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.locator("#search").fill(seed.photos[0].filename);
  assert.equal(await page.locator(".card").count(), 1);
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
  await admin.locator("#grid .image-button").first().click();
  await admin.locator('[name="caption"]').fill("Hosted browser check caption");
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
  for (const width of [1440, 390, 320]) {
    for (const surface of [page, admin]) {
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
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map(({ id, nodes }) => ({
          id,
          elements: nodes.map((node) => node.target),
        })),
      );
      assert.deepEqual(violations, [], `Accessibility at ${width}px`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Hosted photo bank passed: public gallery, organizer edits, licensed ZIP download, and accessible layouts at 320/390/1440 px.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
