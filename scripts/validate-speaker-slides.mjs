import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  createReceiptFixture,
  receiptAdmin,
} from "../test/helpers/receipt-fixture.mjs";
import {
  pdfSlideBytes,
  powerpointSlideBytes,
} from "../test/helpers/slide-files.mjs";

const fixture = await createReceiptFixture();
let browser;
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
  browser = await chromium.launch({ executablePath });
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  const speakerContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const rawCookie = fixture.cookies.get("mo-khazali");
  const separator = rawCookie.indexOf("=");
  await speakerContext.addCookies([
    {
      name: rawCookie.slice(0, separator),
      value: rawCookie.slice(separator + 1),
      url: `https://127.0.0.1:${fixture.worker.port}/`,
      secure: true,
      httpOnly: true,
    },
  ]);
  // Turnstile is disabled in this fixture; do not load its external login widget.
  await speakerContext.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  const adminContext = await browser.newContext({
    extraHTTPHeaders: { authorization: receiptAdmin },
    viewport: { width: 1440, height: 1000 },
  });
  const publicContext = await browser.newContext();
  const speaker = await speakerContext.newPage();
  const admin = await adminContext.newPage();
  const schedule = await publicContext.newPage();
  const errors = [];
  for (const page of [speaker, admin, schedule]) {
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  await speaker.goto(`${origin}/speaker/`);
  const card = speaker.locator("[data-slide-talk]").first();
  await card.waitFor();
  const talkId = await card.getAttribute("data-slide-talk");
  const fileInput = card.getByLabel(
    "Presentation file (PDF or .pptx, up to 25 MB)",
  );
  const permission = card.getByRole("checkbox", {
    name: "Allow this PDF to be published with my talk",
  });
  const setFile = (name, buffer, mimeType) =>
    fileInput.setInputFiles({ name, buffer, mimeType });
  const upload = async (buttonName, expectedStatus = 201) => {
    const completed = speaker.waitForResponse(
      (response) =>
        response.url().includes("/api/speaker/slides?") &&
        response.request().method() === "POST",
    );
    await card.getByRole("button", { name: buttonName, exact: true }).click();
    assert.equal((await completed).status(), expectedStatus);
    if (expectedStatus === 201)
      await speaker.waitForFunction(() => {
        const input = document.querySelector(
          "[data-slide-talk] input[type=file]",
        );
        return input && input.files.length === 0;
      });
  };
  assert.equal(await permission.isChecked(), false);
  await setFile("venue.pdf", pdfSlideBytes(), "application/pdf");
  await upload("Upload slides");
  await card.getByText("Private · venue use only", { exact: true }).waitFor();
  await admin.goto(`${origin}/admin/speakers/`);
  let adminCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "venue.pdf" });
  await adminCard.waitFor();
  assert.equal(
    await adminCard
      .getByRole("button", { name: "Publish PDF on schedule", exact: true })
      .isDisabled(),
    true,
  );
  await setFile(
    "public.pdf",
    pdfSlideBytes("Public slides"),
    "application/pdf",
  );
  await permission.check();
  await upload("Replace PDF");
  await card
    .getByText("Private · PDF publication allowed", { exact: true })
    .waitFor();
  await admin.reload();
  adminCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "public.pdf" });
  await adminCard
    .getByRole("button", { name: "Publish PDF on schedule", exact: true })
    .click();
  await admin
    .getByText("PDF published on the schedule.", { exact: true })
    .waitFor();
  await schedule.goto(`${origin}/schedule/`);
  const scheduleTalk = schedule.locator(`[data-schedule-talk="${talkId}"]`);
  const publicLink = scheduleTalk.getByRole("link", {
    name: "Slides (PDF)",
    exact: true,
  });
  await publicLink.waitFor();
  const firstPublicHref = await publicLink.getAttribute("href");
  const downloaded = await publicContext.request.get(
    `${origin}${firstPublicHref}`,
  );
  assert.equal(downloaded.status(), 200);
  assert.deepEqual(await downloaded.body(), pdfSlideBytes("Public slides"));
  await speaker.reload();
  await card.getByText("Published on the schedule", { exact: true }).waitFor();
  await setFile(
    "venue.pptx",
    powerpointSlideBytes(),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
  assert.equal(await permission.isVisible(), false);
  await upload("Upload slides");
  await card
    .getByRole("link", { name: "Download PowerPoint", exact: true })
    .waitFor();
  assert.equal(
    await card.getByRole("link", { name: "Download PDF", exact: true }).count(),
    1,
  );

  await setFile("broken.pdf", Buffer.from("Not a PDF"), "application/pdf");
  await upload("Replace PDF", 400);
  await card
    .getByText(
      "The file is not a valid PDF or PowerPoint (.pptx) presentation.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await fileInput.evaluate((input) => input.files[0].name),
    "broken.pdf",
  );
  assert.equal(
    await card
      .getByRole("button", { name: "Replace PDF", exact: true })
      .isEnabled(),
    true,
  );
  await setFile(
    "updated.pdf",
    pdfSlideBytes("Updated public slides"),
    "application/pdf",
  );
  await permission.check();
  await upload("Replace PDF");
  assert.equal(
    (await publicContext.request.get(`${origin}${firstPublicHref}`)).status(),
    404,
  );
  await schedule.reload();
  assert.equal(await publicLink.count(), 0);
  await admin.reload();
  adminCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "updated.pdf" });
  await adminCard
    .getByRole("button", { name: "Publish PDF on schedule", exact: true })
    .click();
  await admin
    .getByText("PDF published on the schedule.", { exact: true })
    .waitFor();
  await schedule.reload();
  await publicLink.waitFor();
  const latestPublicHref = await publicLink.getAttribute("href");
  assert.notEqual(latestPublicHref, firstPublicHref);

  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [1440, 390]) {
    for (const page of [speaker, admin, schedule]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.addScriptTag({ content: axe });
      const selector =
        page === speaker
          ? "[data-speaker-slide-files]"
          : page === admin
            ? "[data-admin-slide]"
            : "[data-schedule-talk]";
      const violations = await page.evaluate(async (selector) => {
        const result = await window.axe.run(selector, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        });
        return result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        }));
      }, selector);
      assert.deepEqual(
        violations,
        [],
        `Slide controls accessibility at ${width}px`,
      );
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflows, false, `Slide page overflow at ${width}px`);
    }
    await speaker.locator("[data-speaker-slide-files]").screenshot({
      path: path.join(tmpdir(), `sdlcai-speaker-slide-files-${width}.png`),
    });
    await adminCard.screenshot({
      path: path.join(tmpdir(), `sdlcai-admin-slide-files-${width}.png`),
    });
  }
  await adminCard
    .getByRole("button", { name: "Unpublish PDF", exact: true })
    .click();
  await admin
    .getByText("PDF unpublished. The schedule link has been removed.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (await publicContext.request.get(`${origin}${latestPublicHref}`)).status(),
    404,
  );
  await speaker.reload();
  speaker.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Remove PDF", exact: true }).click();
  await speaker
    .getByText("Slides removed. Any public link has been removed.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await card.getByRole("link", { name: "Download PDF", exact: true }).count(),
    0,
  );
  assert.equal(
    await card
      .getByRole("link", { name: "Download PowerPoint", exact: true })
      .count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Speaker PDF/PowerPoint uploads, private downloads, publication, replacement, removal, mobile layout and accessibility passed.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
