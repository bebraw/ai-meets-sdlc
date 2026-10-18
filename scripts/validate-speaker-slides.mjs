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
  htmlSlideBytes,
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
  const setupSaved = await fixture.worker.fetch(
    "https://sdlcai.org/api/speaker/presentation",
    {
      method: "POST",
      headers: {
        cookie: rawCookie,
        origin: "https://sdlcai.org",
        "content-type": "application/json",
      },
      body: JSON.stringify({ delivery_method: "own_laptop" }),
    },
  );
  assert.equal(setupSaved.status, 200);
  await speaker.goto(`${origin}/speaker/`);
  const card = speaker.locator("[data-slide-talk]").first();
  await card.waitFor();
  const talkId = await card.getAttribute("data-slide-talk");
  const fileInput = card.getByLabel(
    "Presentation file (PDF or .pptx, up to 50 MB)",
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
  const contact = admin.locator(
    '[data-admin-speaker-contact="ohans-emmanuel"]',
  );
  await contact.waitFor();
  for (const address of ["ohans-backup@example.test", ""]) {
    await contact.getByLabel("Secondary email (optional)").fill(address);
    const saved = admin.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/speakers/contact") &&
        response.request().method() === "POST",
    );
    await contact
      .getByRole("button", { name: "Save emails", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await admin.reload();
    await contact.waitFor();
    assert.equal(
      await contact.getByLabel("Secondary email (optional)").inputValue(),
      address,
    );
    assert.equal(
      await contact.getByLabel("Primary speaker email").inputValue(),
      "ohans-emmanuel@example.test",
    );
  }
  const presentation = admin.locator('[data-admin-presentation="mo-khazali"]');
  const materials = presentation.locator(
    `[data-admin-presentation-talk="${talkId}"]`,
  );
  const setup = presentation.locator("[data-admin-presentation-setup]");
  await presentation.waitFor();
  assert.equal(
    await presentation
      .getByText(await card.getByRole("heading", { level: 3 }).textContent(), {
        exact: true,
      })
      .count(),
    1,
  );
  assert.equal(await materials.locator("form:visible").count(), 0);
  await setup.getByText("Needs venue confirmation", { exact: true }).waitFor();
  const setupGuidance = setup.getByText(
    "Discouraged by the venue; confirm the connection and changeover plan with the speaker.",
    { exact: true },
  );
  assert.equal(await setupGuidance.isVisible(), false);
  await setup.locator("summary").click();
  assert.equal(await setupGuidance.isVisible(), true);
  await setup.locator("summary").click();
  const uploadToggle = materials.getByRole("button", {
    name: "Upload file",
    exact: true,
  });
  await uploadToggle.click();
  assert.equal(await uploadToggle.getAttribute("aria-expanded"), "true");
  await materials
    .locator("[data-admin-slide-upload]")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(await uploadToggle.getAttribute("aria-expanded"), "false");
  assert.equal(
    await uploadToggle.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  const addLinkToggle = materials.getByRole("button", {
    name: "Add public slide link",
    exact: true,
  });
  await addLinkToggle.click();
  const initialLinkForm = materials.locator("[data-admin-slide-link]");
  await initialLinkForm
    .getByLabel("Slide URL (HTTPS)")
    .fill("https://discard.example.org/");
  await initialLinkForm
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(
    await initialLinkForm.getByLabel("Slide URL (HTTPS)").inputValue(),
    "",
  );
  assert.equal(
    await addLinkToggle.evaluate(
      (element) => element === document.activeElement,
    ),
    true,
  );
  assert.equal(await materials.locator("form:visible").count(), 0);
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
  await schedule.goto(`${origin}/2026/schedule/`);
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
    powerpointSlideBytes(28 * 1024 * 1024),
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

  const slideLinkForm = admin.locator(`[data-admin-slide-link="${talkId}"]`);
  const openLinkEditor = async (page) => {
    const form = page.locator(`[data-admin-slide-link="${talkId}"]`);
    if (await form.isVisible()) return;
    const group = page.locator(`[data-admin-presentation-talk="${talkId}"]`);
    const add = group.getByRole("button", {
      name: "Add public slide link",
      exact: true,
    });
    if (await add.count()) await add.click();
    else
      await group
        .getByRole("button", { name: "Edit public slide link", exact: true })
        .click();
  };
  const externalLink = scheduleTalk.getByRole("link", {
    name: "Presentation",
    exact: true,
  });
  const saveLink = async (url) => {
    await openLinkEditor(admin);
    await slideLinkForm.getByLabel("Slide URL (HTTPS)").fill(url);
    await slideLinkForm
      .getByRole("button", { name: "Save slide link", exact: true })
      .click();
  };
  const firstSlideUrl = "https://slides.example.org/deck?view=public&lang=en";
  await saveLink(firstSlideUrl);
  await slideLinkForm.waitFor({ state: "hidden" });
  await admin
    .getByText("Slide link published on the schedule.", { exact: true })
    .waitFor();
  await admin.reload();
  assert.equal(
    await slideLinkForm.getByLabel("Slide URL (HTTPS)").inputValue(),
    firstSlideUrl,
  );
  await schedule.reload();
  assert.equal(await externalLink.getAttribute("href"), firstSlideUrl);
  assert.equal(await publicLink.getAttribute("href"), latestPublicHref);
  const staleAdmin = await adminContext.newPage();
  await staleAdmin.goto(`${origin}/admin/speakers/`);
  const staleForm = staleAdmin.locator(`[data-admin-slide-link="${talkId}"]`);
  await openLinkEditor(staleAdmin);
  await staleForm.getByLabel("Slide URL (HTTPS)").waitFor();
  const updatedSlideUrl = "https://slides.example.org/updated";
  await saveLink(updatedSlideUrl);
  await slideLinkForm.waitFor({ state: "hidden" });
  await admin
    .getByText("Slide link published on the schedule.", { exact: true })
    .waitFor();
  await staleForm
    .getByLabel("Slide URL (HTTPS)")
    .fill("https://slides.example.org/stale");
  await staleForm
    .getByRole("button", { name: "Save slide link", exact: true })
    .click();
  await staleForm
    .getByText("The slide link changed. Reload speakers before saving again.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await staleForm.getByLabel("Slide URL (HTTPS)").inputValue(),
    "https://slides.example.org/stale",
  );
  await staleAdmin.close();
  await schedule.reload();
  assert.equal(await externalLink.getAttribute("href"), updatedSlideUrl);

  const programme = schedule.locator("#day-flow");
  assert.equal(await programme.locator("[data-schedule-talk]").count(), 10);
  const talkIds = await schedule
    .locator("[data-canonical-talk-title]")
    .evaluateAll((elements) =>
      elements.map((element) => element.dataset.canonicalTalkId),
    );
  assert.equal(talkIds.length, 10);
  assert.equal(new Set(talkIds).size, 10);
  assert.equal(
    await schedule
      .getByRole("link", { name: "Slides (PDF)", exact: true })
      .count(),
    1,
  );
  assert.equal(await publicLink.getAttribute("href"), latestPublicHref);
  assert.equal(
    await scheduleTalk.locator("details").getAttribute("open"),
    null,
  );
  assert.equal(await publicLink.isVisible(), true);
  assert.equal(
    await scheduleTalk.locator("details [data-talk-materials]").count(),
    0,
  );
  await scheduleTalk.getByText("About this talk", { exact: true }).click();
  assert.equal(await scheduleTalk.locator("details").getAttribute("open"), "");
  await scheduleTalk.getByText("About this talk", { exact: true }).click();

  await openLinkEditor(admin);
  await slideLinkForm
    .getByLabel("Link type", { exact: true })
    .selectOption("resource");
  await slideLinkForm
    .getByRole("button", { name: "Save slide link", exact: true })
    .click();
  await slideLinkForm.waitFor({ state: "hidden" });
  await admin
    .getByText("Slide link published on the schedule.", { exact: true })
    .waitFor();
  await schedule.reload();
  assert.equal(
    await scheduleTalk
      .getByRole("link", { name: "Related resource", exact: true })
      .getAttribute("href"),
    updatedSlideUrl,
  );
  await openLinkEditor(admin);
  await slideLinkForm
    .getByLabel("Link type", { exact: true })
    .selectOption("presentation");
  await slideLinkForm
    .getByRole("button", { name: "Save slide link", exact: true })
    .click();
  // The previous save has the same status text; wait for this refresh to close
  // the editor before starting another edit in the newly rendered workspace.
  await slideLinkForm.waitFor({ state: "hidden" });
  await admin
    .getByText("Slide link published on the schedule.", { exact: true })
    .waitFor();

  const recordingForm = materials.locator(
    `[data-admin-recording-link="${talkId}"]`,
  );
  await materials
    .getByRole("button", { name: "Add recording link", exact: true })
    .click();
  await recordingForm
    .getByLabel("Recording URL (HTTPS)")
    .fill("https://video.example.org/edited-talk");
  await recordingForm
    .getByRole("button", { name: "Save recording link", exact: true })
    .click();
  await admin
    .getByText("Recording link published on the schedule.", { exact: true })
    .waitFor();
  await schedule.reload();
  assert.equal(
    await schedule
      .getByRole("link", { name: "Watch talk", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await scheduleTalk
      .getByRole("link", { name: "Watch talk", exact: true })
      .getAttribute("href"),
    "https://video.example.org/edited-talk",
  );

  const adminUploadForm = admin.locator(
    `[data-admin-slide-upload="${talkId}"]`,
  );
  const adminFileInput = adminUploadForm.getByLabel(
    "Presentation file (PDF, .pptx, or HTML, up to 50 MB)",
  );
  const adminPermission = adminUploadForm.getByRole("checkbox");
  const uploadAsAdmin = async (
    name,
    buffer,
    mimeType,
    buttonName,
    mayPublish = false,
  ) => {
    if (buttonName === "Upload slides")
      await materials
        .getByRole("button", { name: "Upload file", exact: true })
        .click();
    else
      await materials
        .getByRole("button", { name: buttonName, exact: true })
        .click();
    await adminFileInput.setInputFiles({ name, buffer, mimeType });
    if (mayPublish) await adminPermission.check();
    const completed = admin.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/speakers/slides/upload?") &&
        response.request().method() === "POST",
    );
    await adminUploadForm
      .getByRole("button", { name: buttonName, exact: true })
      .click();
    assert.equal((await completed).status(), 201);
    await admin.waitForFunction((talkId) => {
      const input = document.querySelector(
        `[data-admin-slide-upload="${talkId}"] input[type=file]`,
      );
      return input && input.files.length === 0;
    }, talkId);
  };
  await uploadAsAdmin(
    "speaker-supplied.html",
    htmlSlideBytes(),
    "text/html",
    "Upload slides",
  );
  let htmlAdminCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "speaker-supplied.html" });
  assert.equal(
    await htmlAdminCard.getByRole("button", { name: /Publish/ }).count(),
    0,
  );
  const htmlDownloadEvent = admin.waitForEvent("download");
  await htmlAdminCard
    .getByRole("link", { name: "Download HTML", exact: true })
    .click();
  const htmlDownload = await htmlDownloadEvent;
  assert.equal(htmlDownload.suggestedFilename(), "speaker-supplied.html");
  assert.deepEqual(await readFile(await htmlDownload.path()), htmlSlideBytes());
  await uploadAsAdmin(
    "updated.html",
    htmlSlideBytes("Updated HTML"),
    "text/html",
    "Replace HTML",
  );
  htmlAdminCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "updated.html" });
  await htmlAdminCard.waitFor();
  await uploadAsAdmin(
    "admin-venue.pptx",
    powerpointSlideBytes(),
    "application/octet-stream",
    "Replace PowerPoint",
  );
  assert.equal(await adminPermission.isVisible(), false);
  await speaker.reload();
  await card
    .getByRole("link", { name: "Download HTML", exact: true })
    .waitFor();
  await setFile("speaker.html", htmlSlideBytes(), "text/html");
  assert.equal(await permission.isVisible(), false);
  await card
    .getByRole("button", { name: "Upload slides", exact: true })
    .click();
  await card
    .getByText("Choose a PDF or PowerPoint (.pptx) file.", { exact: true })
    .waitFor();
  await fileInput.setInputFiles([]);
  await schedule.reload();
  assert.equal(await publicLink.getAttribute("href"), latestPublicHref);
  assert.equal(
    await scheduleTalk.getByRole("link", { name: /HTML|PowerPoint/ }).count(),
    0,
  );

  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [1440, 390]) {
    for (const page of [speaker, admin, schedule]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.addScriptTag({ content: axe });
      const selector =
        page === speaker
          ? "[data-speaker-slide-files]"
          : page === admin
            ? "[data-admin-presentation]"
            : "#day-flow";
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
    await presentation.screenshot({
      path: path.join(tmpdir(), `sdlcai-admin-presentation-${width}.png`),
    });
    await scheduleTalk.screenshot({
      path: path.join(tmpdir(), `sdlcai-programme-talk-${width}.png`),
    });
    const fileMore = adminCard.locator("summary");
    assert.equal(
      await adminCard
        .getByRole("button", { name: "Remove PDF", exact: true })
        .isVisible(),
      false,
    );
    await fileMore.click();
    assert.equal(
      await adminCard
        .getByRole("button", { name: "Remove PDF", exact: true })
        .isVisible(),
      true,
    );
    const menuBounds = await adminCard.locator("summary + div").boundingBox();
    assert.ok(
      menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= width,
      `File menu stays within ${width}px viewport`,
    );
    await fileMore.press("Escape");
    assert.equal(
      await adminCard
        .getByRole("button", { name: "Remove PDF", exact: true })
        .isVisible(),
      false,
    );
    await materials
      .getByRole("button", { name: "Upload file", exact: true })
      .click();
    await openLinkEditor(admin);
    const expandedViolations = await admin.evaluate(async () => {
      const result = await window.axe.run("[data-admin-presentation]", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
      return result.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target),
      }));
    });
    assert.deepEqual(
      expandedViolations,
      [],
      `Expanded slide editors accessibility at ${width}px`,
    );
    await slideLinkForm.screenshot({
      path: path.join(tmpdir(), `sdlcai-admin-slide-link-${width}.png`),
    });
    await adminUploadForm.screenshot({
      path: path.join(tmpdir(), `sdlcai-admin-slide-upload-${width}.png`),
    });
    await slideLinkForm
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await adminUploadForm
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    const linkMore = materials.locator("[data-admin-slide-link-row] summary");
    await linkMore.click();
    const linkMenuBounds = await materials
      .locator("[data-admin-slide-link-row] summary + div")
      .boundingBox();
    assert.ok(
      linkMenuBounds.x >= 0 && linkMenuBounds.x + linkMenuBounds.width <= width,
      `Link menu stays within ${width}px viewport`,
    );
    await linkMore.press("Escape");
    await admin.locator("[data-theme-toggle]").click();
    const otherThemeViolations = await admin.evaluate(async () => {
      const result = await window.axe.run("[data-admin-presentation]", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      });
      return result.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map(({ target }) => target),
      }));
    });
    assert.deepEqual(
      otherThemeViolations,
      [],
      `Other theme slide controls accessibility at ${width}px`,
    );
    await presentation.screenshot({
      path: path.join(
        tmpdir(),
        `sdlcai-admin-presentation-other-theme-${width}.png`,
      ),
    });
    await admin.locator("[data-theme-toggle]").click();
  }
  const linkRow = materials.locator("[data-admin-slide-link-row]");
  const recordingRow = materials.locator("[data-admin-recording-link-row]");
  await recordingRow.locator("summary").click();
  await recordingRow
    .getByRole("button", { name: "Remove recording link", exact: true })
    .click();
  await admin
    .getByText("Recording link removed from the schedule.", { exact: true })
    .waitFor();
  await schedule.reload();
  assert.equal(
    await schedule
      .getByRole("link", { name: "Watch talk", exact: true })
      .count(),
    0,
  );
  await linkRow.locator("summary").click();
  await linkRow
    .getByRole("button", { name: "Remove slide link", exact: true })
    .click();
  await admin
    .getByText("Slide link removed from the schedule.", { exact: true })
    .waitFor();
  await admin.reload();
  assert.equal(
    await slideLinkForm.getByLabel("Slide URL (HTTPS)").inputValue(),
    "",
  );
  await schedule.reload();
  assert.equal(await externalLink.count(), 0);
  assert.equal(await publicLink.getAttribute("href"), latestPublicHref);
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
  await card
    .getByRole("link", { name: "Download PDF", exact: true })
    .waitFor({ state: "detached" });
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
  await admin.reload();
  await uploadAsAdmin(
    "admin-public.pdf",
    pdfSlideBytes("Admin PDF"),
    "application/pdf",
    "Upload slides",
    true,
  );
  let adminPdfCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "admin-public.pdf" });
  await adminPdfCard
    .getByRole("button", { name: "Publish PDF on schedule", exact: true })
    .click();
  await admin
    .getByText("PDF published on the schedule.", { exact: true })
    .waitFor();
  await schedule.reload();
  await publicLink.waitFor();
  const adminPublicHref = await publicLink.getAttribute("href");
  await uploadAsAdmin(
    "admin-private.pdf",
    pdfSlideBytes("Admin replacement"),
    "application/pdf",
    "Replace PDF",
  );
  assert.equal(
    (await publicContext.request.get(`${origin}${adminPublicHref}`)).status(),
    404,
  );
  adminPdfCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "admin-private.pdf" });
  assert.equal(
    await adminPdfCard
      .getByRole("button", { name: "Publish PDF on schedule", exact: true })
      .isDisabled(),
    true,
  );
  admin.once("dialog", (dialog) => dialog.accept());
  await adminPdfCard.locator("summary").click();
  await adminPdfCard
    .getByRole("button", { name: "Remove PDF", exact: true })
    .click();
  await admin
    .getByText("Slides removed. Any public link has been removed.", {
      exact: true,
    })
    .waitFor();
  await adminPdfCard.waitFor({ state: "detached" });
  htmlAdminCard = admin
    .locator("[data-admin-slide]")
    .filter({ hasText: "updated.html" });
  admin.once("dialog", (dialog) => dialog.accept());
  await htmlAdminCard.locator("summary").click();
  await htmlAdminCard
    .getByRole("button", { name: "Remove HTML", exact: true })
    .click();
  await htmlAdminCard.waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log(
    "Secondary email save/removal, speaker and admin uploads, PDF publication, single programme listing, presentation/resource and recording links, stale edits, replacement, removal, mobile layout and accessibility passed.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
