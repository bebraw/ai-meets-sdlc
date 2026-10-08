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
    .fill("Speaker-specific instructions.");
  await panel
    .locator('[name="dinner_text_body"]')
    .fill("Dinner-specific instructions.");
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
  await variant.selectOption({ label: "Speakers and dinner" });
  assert.match(
    await panel.locator("[data-admin-announcement-text-preview]").textContent(),
    /Speaker-specific[\s\S]*Dinner-specific/u,
  );
  assert.equal(
    await preview.isVisible(),
    true,
    "changing the preview version preserves confirmation",
  );
  await variant.selectOption({ label: "Dinner only" });
  assert.doesNotMatch(
    await panel.locator("[data-admin-announcement-text-preview]").textContent(),
    /Speaker-specific/u,
  );
  await confirm.check();
  assert.equal(await send.isEnabled(), true);
  await panel
    .locator('[name="text_body"]')
    .fill("A revised general message for the same recipients.");
  assert.equal(await preview.isVisible(), false);
  assert.equal(await send.isDisabled(), true);
  await panel.locator("[data-admin-announcement-select-none]").click();
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
  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(250);
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
  assert.ok(submission.preview_token);
  assert.equal(await preview.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(
    "Announcement browser checks passed: guest email editing, authorization, overlapping and dinner-only audiences, version previews, confirmation, mobile layout and accessibility. No real email sent.",
  );
  await context.close();
  await browser.close();
} finally {
  if (browserServer) await closeBrowserServer(browserServer);
  await fixture.dispose();
}
