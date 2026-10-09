import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { closeBrowserServer } from "./layout-browser.mjs";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin,
} from "../test/helpers/receipt-fixture.mjs";

const fixture = await createReceiptFixture({
  vars: {
    SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T00:00:00Z",
    SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T00:00:00Z",
  },
});
let browserServer;
try {
  assert.equal(
    (
      await fixture.worker.fetch(
        receiptOrigin + "/api/admin/speaker-dinner/attendance",
        {
          method: "POST",
          headers: {
            authorization: receiptAdmin,
            origin: receiptOrigin,
            "content-type": "application/json",
            "x-admin-action": "manage-speaker-dinner-attendance",
          },
          body: JSON.stringify({
            speaker_id: "mo-khazali",
            attendance: "attending",
            revision: 0,
          }),
        },
      )
    ).status,
    200,
  );
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
  browserServer = await chromium.launchServer({ executablePath });
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization: receiptAdmin },
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  await page.goto(origin + "/admin/dinner/");
  await page.locator("[data-admin-dinner-add-panel] summary").click();
  const add = page.locator("[data-admin-dinner-add-form]");
  await add.locator('[name="name"]').fill("Dinner guest");
  await add.locator('[name="email"]').fill("guest@example.test");
  await add.locator('[name="meal_preference"]').selectOption("vegan");
  await add.locator('[name="cross_contamination"]').selectOption("no");
  await add.locator('[name="consent"]').check();
  await add.locator('[type="submit"]').click();
  await page
    .getByText("Dinner guest added. You can add the next guest now.", {
      exact: true,
    })
    .waitFor();
  const email = page.getByLabel("Dinner-update email for Dinner guest", {
    exact: true,
  });
  assert.equal(await email.inputValue(), "guest@example.test");
  await email.fill("updated@example.test");
  await page.getByRole("button", { name: "Save email", exact: true }).click();
  await page
    .getByText("Dinner-update email saved for Dinner guest.", { exact: true })
    .waitFor();
  assert.equal(await email.inputValue(), "updated@example.test");
  const dinner = await (
    await context.request.get(origin + "/api/admin/speaker-dinner")
  ).json();
  const guest = dinner.shared_responses[0];
  const body = {
    response_id: guest.response_id,
    revision: guest.email_revision,
    email: "guest@example.test",
  };
  const endpoint = origin + "/api/admin/speaker-dinner/guest-email";
  for (const [headers, status] of [
    [
      {
        authorization: "",
        origin,
        "x-admin-action": "manage-dinner-guest-email",
      },
      401,
    ],
    [
      {
        origin: "https://elsewhere.test",
        "x-admin-action": "manage-dinner-guest-email",
      },
      403,
    ],
    [{ origin, "x-admin-action": "wrong" }, 403],
  ]) {
    assert.equal(
      (await context.request.put(endpoint, { headers, data: body })).status(),
      status,
    );
  }
  const csv = await (
    await context.request.get(origin + "/api/admin/speaker-dinner.csv")
  ).text();
  assert.doesNotMatch(csv, /updated@example.test/u);
  await page
    .getByRole("link", {
      name: "Send a combined speaker and dinner announcement",
    })
    .click();
  const panel = page.locator("[data-admin-announcement-panel]");
  assert.equal(await panel.getAttribute("open"), "");
  await page
    .locator("[data-admin-announcement-speakers] input")
    .first()
    .waitFor();
  await panel.locator('[name="include_dinner"]').check();
  await panel
    .locator('[name="subject"]')
    .fill("Speaker and dinner information");
  await panel
    .locator('[name="text_body"]')
    .fill("General event details for speakers and dinner guests.");
  await panel
    .locator('[name="speaker_text_body"]')
    .fill(
      "Speaker-specific instructions.\n\n" +
        "Please arrive before your session to check the microphone, connect your laptop, and review your presentation with the event team.\n\n".repeat(
          8,
        ),
    );
  await panel
    .locator('[name="dinner_text_body"]')
    .fill("Dinner-specific instructions.");
  const closing = panel.locator('[name="closing_text_body"]');
  await closing.fill("Best,\nJuho & the SDLCAI team");
  await panel.locator('[name="test_email"]').fill("test@example.test");
  const message = panel.locator('[name="text_body"]');
  const originalMessage = await message.inputValue();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  await message.press("ControlOrMeta+A");
  await message.press("ControlOrMeta+C");
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    originalMessage,
  );
  await closing.fill("");
  await closing.press("ControlOrMeta+V");
  assert.equal(
    await closing.inputValue(),
    originalMessage,
    "native paste works in the closing field",
  );
  await closing.press("ControlOrMeta+A");
  await closing.press("ControlOrMeta+X");
  assert.equal(
    await closing.inputValue(),
    "",
    "native cut works in message fields",
  );
  await closing.fill("Best,\nJuho & the SDLCAI team");
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle("dark", dark),
      dark,
    );
    for (const name of [
      "subject",
      "text_body",
      "speaker_text_body",
      "dinner_text_body",
      "closing_text_body",
      "test_email",
    ]) {
      const colors = await panel
        .locator(`[name="${name}"]`)
        .evaluate((field) => ({
          background: getComputedStyle(field).backgroundColor,
          selection: getComputedStyle(field, "::selection").backgroundColor,
          selectedText: getComputedStyle(field, "::selection").color,
        }));
      assert.notEqual(
        colors.selection,
        colors.background,
        `visible ${name} selection in ${dark ? "dark" : "light"} mode`,
      );
      assert.notEqual(
        colors.selectedText,
        colors.selection,
        "selected text remains readable",
      );
    }
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await panel.locator("[data-admin-announcement-copy]").click();
  await panel
    .getByText("Subject and message copied.", { exact: true })
    .waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /Speaker-specific[\s\S]*Dinner-specific[\s\S]*Best,\nJuho & the SDLCAI team/u,
  );
  const preview = page.locator("[data-admin-announcement-preview-panel]");
  const confirm = panel.locator("[data-admin-announcement-confirm]");
  const send = panel.locator("[data-admin-announcement-send]");
  const previewButton = panel.locator("[data-admin-announcement-preview]");
  await previewButton.click();
  await preview.waitFor({ state: "visible" });
  assert.equal(
    await panel
      .locator("[data-admin-announcement-recipient-count]")
      .textContent(),
    "3",
  );
  assert.match(
    await panel
      .locator("[data-admin-announcement-audience-counts]")
      .textContent(),
    /1 speakers only \/ 1 dinner only \/ 1 in both/u,
  );
  const variant = panel.locator("[data-admin-announcement-variant]");
  const htmlPreview = panel.locator("[data-admin-announcement-html-preview]");
  const assertPreviewFits = async (hasSpeaker) => {
    await page.waitForFunction((hasSpeaker) => {
      const frame = document.querySelector(
        "[data-admin-announcement-html-preview]",
      );
      const body = frame?.contentDocument?.body;
      if (!body || body.innerText.includes("Speaker-specific") !== hasSpeaker)
        return false;
      const height = Math.ceil(body.getBoundingClientRect().height);
      return (
        height > 0 &&
        frame.clientHeight >= height &&
        frame.clientHeight <= Math.max(320, height) + 1
      );
    }, hasSpeaker);
  };
  await variant.selectOption({ label: "Speakers and dinner" });
  await assertPreviewFits(true);
  const longPreviewHeight = await htmlPreview.evaluate(
    (frame) => frame.clientHeight,
  );
  assert.ok(longPreviewHeight > 600, "long messages expand the HTML preview");
  assert.ok(
    (await htmlPreview.boundingBox()).width >= 640,
    "desktop preview has a full email width",
  );
  assert.match(
    await panel.locator("[data-admin-announcement-text-preview]").textContent(),
    /Speaker-specific[\s\S]*Dinner-specific[\s\S]*Best,\nJuho & the SDLCAI team/u,
  );
  assert.equal(
    await preview.isVisible(),
    true,
    "changing the preview version preserves confirmation",
  );
  await variant.selectOption({ label: "Dinner only" });
  await assertPreviewFits(false);
  assert.ok(
    (await htmlPreview.evaluate((frame) => frame.clientHeight)) <
      longPreviewHeight,
    "switching to a shorter audience message shrinks the preview",
  );
  assert.doesNotMatch(
    await panel.locator("[data-admin-announcement-text-preview]").textContent(),
    /Speaker-specific/u,
  );
  assert.match(
    await panel.locator("[data-admin-announcement-text-preview]").textContent(),
    /Dinner-specific[\s\S]*Best,\nJuho & the SDLCAI team/u,
  );
  const downloadEvent = page.waitForEvent("download");
  await panel.locator("[data-admin-announcement-download]").click();
  const download = await downloadEvent;
  const downloadPath = path.join(tmpdir(), "sdlcai-announcement-download.txt");
  await download.saveAs(downloadPath);
  assert.match(
    await readFile(downloadPath, "utf8"),
    /Speaker-specific[\s\S]*Dinner-specific[\s\S]*Best,\nJuho & the SDLCAI team/u,
  );
  await confirm.check();
  assert.equal(await send.isEnabled(), true);
  await closing.fill("Best,\nJuho");
  assert.equal(await preview.isVisible(), false);
  assert.equal(await send.isDisabled(), true);
  await previewButton.click();
  await preview.waitFor({ state: "visible" });
  await confirm.check();
  await panel
    .locator('[name="text_body"]')
    .fill("A revised general message for the same recipients.");
  assert.equal(await preview.isVisible(), false);
  assert.equal(await send.isDisabled(), true);
  await panel.locator("[data-admin-announcement-select-none]").click();
  await previewButton.click();
  await preview.waitFor({ state: "visible" });
  await confirm.check();
  const draftFields = [
    "category",
    "subject",
    "text_body",
    "speaker_text_body",
    "dinner_text_body",
    "closing_text_body",
    "test_email",
  ];
  const draft = await Promise.all(
    draftFields.map((name) => panel.locator(`[name="${name}"]`).inputValue()),
  );
  await page.reload();
  await panel.locator('[name="speaker_id"]').first().waitFor();
  assert.equal(
    await panel.getAttribute("open"),
    "",
    "restoring a draft opens the composer",
  );
  assert.deepEqual(
    await Promise.all(
      draftFields.map((name) => panel.locator(`[name="${name}"]`).inputValue()),
    ),
    draft,
    "reload restores every message field",
  );
  assert.equal(
    await panel.locator('[name="include_dinner"]').isChecked(),
    true,
  );
  assert.equal(
    await panel.locator('[name="speaker_id"]:checked').count(),
    0,
    "reload preserves dinner-only recipients",
  );
  assert.equal(await preview.isVisible(), false);
  assert.equal(await confirm.isChecked(), false);
  assert.equal(
    await send.isDisabled(),
    true,
    "restoring a draft requires fresh preview and confirmation",
  );
  await page.locator("[data-admin-speakers-refresh]").click();
  await page.waitForFunction(
    () => !document.querySelector("[data-admin-speakers-refresh]").disabled,
  );
  assert.equal(
    await panel.locator('[name="speaker_id"]:checked').count(),
    0,
    "refreshing speakers preserves recipient choices",
  );
  await previewButton.click();
  await preview.waitFor({ state: "visible" });
  assert.equal(
    await panel
      .locator("[data-admin-announcement-recipient-count]")
      .textContent(),
    "2",
  );
  assert.match(
    await panel
      .locator("[data-admin-announcement-audience-counts]")
      .textContent(),
    /0 speakers only \/ 2 dinner only \/ 0 in both/u,
  );
  await panel.locator("[data-admin-announcement-select-all]").click();
  await previewButton.click();
  await preview.waitFor({ state: "visible" });
  await variant.selectOption({ label: "Speakers and dinner" });
  await assertPreviewFits(true);
  await preview.screenshot({
    path: path.join(tmpdir(), "sdlcai-announcements-preview-desktop.png"),
  });
  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertPreviewFits(true);
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run("[data-admin-announcement-panel]", {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    );
    assert.deepEqual(
      violations,
      [],
      `Announcement accessibility at ${width}px`,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Announcement overflow at ${width}px`,
    );
  }
  await panel.getByText("Exact text body", { exact: true }).click();
  assert.equal(
    await panel.locator("[data-admin-announcement-text-preview]").isVisible(),
    true,
    "the plain-text version can be expanded",
  );
  await panel.getByText("Exact text body", { exact: true }).click();
  await preview.screenshot({
    path: path.join(tmpdir(), "sdlcai-announcements-preview-mobile.png"),
  });
  await page.screenshot({
    path: path.join(tmpdir(), "sdlcai-announcements-320.png"),
  });
  let submission;
  await page.route("**/api/admin/speakers/announcements/send", (route) => {
    submission = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ message: "Mocked local delivery complete." }),
    });
  });
  await confirm.check();
  await send.click();
  await panel
    .getByText("Mocked local delivery complete.", { exact: true })
    .waitFor();
  assert.equal(submission.confirm_recipient_count, 3);
  assert.equal(submission.include_dinner, true);
  assert.equal(submission.closing_text_body, "Best,\nJuho");
  assert.ok(submission.preview_token);
  assert.equal(await preview.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    "Announcement browser checks passed: guest email editing, authorization, native copy/cut/paste, visible text selection, draft recovery after reload, preserved recipients, full-height responsive previews, confirmation, mobile layout and accessibility. No real email sent.",
  );
  await context.close();
  await browser.close();
} finally {
  if (browserServer) await closeBrowserServer(browserServer);
  await fixture.dispose();
}
