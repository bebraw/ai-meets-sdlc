import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin,
} from "../test/helpers/receipt-fixture.mjs";

const fixture = await createReceiptFixture({
  vars: {
    SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
    SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
  },
});
let browser;
try {
  const seed = await fixture.worker.fetch(
    receiptOrigin + "/api/speaker/dinner",
    {
      method: "POST",
      headers: {
        cookie: fixture.cookies.get("mo-khazali"),
        origin: receiptOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        attendance: "attending",
        meal_preference: "vegan",
        food_requirements: "Nut allergy",
        cross_contamination: "yes",
        consent: true,
      }),
    },
  );
  assert.equal(seed.status, 200);
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
  const context = await browser.newContext({
    extraHTTPHeaders: { authorization: receiptAdmin },
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
  });
  const catering = page.locator("[data-dinner-catering]");
  const cateringCount = (label) =>
    catering
      .locator("dl")
      .first()
      .locator("div")
      .filter({ has: page.getByText(label, { exact: true }) })
      .locator("dd")
      .textContent();
  const card = (id) => page.locator(`[data-dinner-speaker-id="${id}"]`);
  const mo = card("mo-khazali"),
    ohans = card("ohans-emmanuel");
  const waitSaved = (name) =>
    page
      .getByText(`Dinner attendance saved for ${name}.`, { exact: true })
      .waitFor();
  const save = async (row, value, name) => {
    await row.getByRole("combobox").selectOption(value);
    await row
      .getByRole("button", { name: "Save attendance", exact: true })
      .click();
    await waitSaved(name);
  };
  await page.goto(origin + "/admin/dinner/");
  await mo.getByRole("combobox").waitFor();
  assert.equal(await cateringCount("Dinner headcount"), "1");
  assert.equal(await cateringCount("Requirements reported"), "1");
  assert.equal(
    await catering.locator('[data-dinner-meal="vegan"] dd').textContent(),
    "1",
  );
  await catering.getByText(/Cross-contamination concern: 1/).waitFor();
  assert.equal(await catering.locator('[data-diet-review="true"]').count(), 1);
  assert.equal(
    await page.locator('[data-admin-dinner-count="attending"]').textContent(),
    "1",
  );
  await save(mo, "not_attending", "Mo Khazali");
  await mo.getByText("Not Attending", { exact: true }).first().waitFor();
  assert.equal(await cateringCount("Dinner headcount"), "0");
  await catering
    .getByText("No guests are currently attending dinner.", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator('[data-admin-dinner-count="attending"]').textContent(),
    "0",
  );
  assert.equal(
    await page
      .locator('[data-admin-dinner-count="not_attending"]')
      .textContent(),
    "1",
  );
  await page.waitForFunction(
    () =>
      document.activeElement?.closest("[data-dinner-speaker-id]")?.dataset
        .dinnerSpeakerId === "mo-khazali",
  );
  assert.doesNotMatch(
    await (
      await context.request.get(origin + "/api/admin/speaker-dinner.csv")
    ).text(),
    /Mo Khazali|Nut allergy/,
  );
  await save(mo, "attending", "Mo Khazali");
  await mo.getByText("Nut allergy", { exact: true }).waitFor();
  assert.match(
    await (
      await context.request.get(origin + "/api/admin/speaker-dinner.csv")
    ).text(),
    /Mo Khazali.*attendance set by admin.*vegan.*Nut allergy/,
  );
  await save(mo, "", "Mo Khazali");
  assert.equal(await mo.getByRole("combobox").inputValue(), "");
  await save(ohans, "attending", "Ohans Emmanuel");
  await ohans
    .getByText("Dietary details have not been supplied by the speaker.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await cateringCount("Dinner headcount"), "2");
  assert.equal(await cateringCount("No answer / placeholder"), "1");
  assert.equal(
    await catering.locator('[data-dinner-meal="missing"] dd').textContent(),
    "1",
  );
  await save(ohans, "", "Ohans Emmanuel");
  await ohans.getByText("Awaiting Reply", { exact: true }).first().waitFor();

  // Dinner guests participate in the same aggregation and anonymous report.
  await page.locator("[data-admin-dinner-add-panel] summary").click();
  const form = page.locator("[data-admin-dinner-add-form]");
  await form.locator('[name="name"]').fill("Organizer dinner guest");
  await form.locator('[name="meal_preference"]').selectOption("vegetarian");
  await form.locator('[name="food_requirements"]').fill("Gluten free");
  await form.locator('[name="cross_contamination"]').selectOption("no");
  await form.locator('[name="consent"]').check();
  await form.locator('[type="submit"]').click();
  await page
    .getByText(
      "Organizer dinner guest added. You can add the next guest now.",
      { exact: true },
    )
    .waitFor();
  await page.locator("[data-admin-dinner-add-panel] summary").click();
  assert.equal(await cateringCount("Dinner headcount"), "2");
  assert.equal(await cateringCount("Requirements reported"), "2");
  assert.equal(
    await catering.locator('[data-dinner-meal="vegetarian"] dd').textContent(),
    "1",
  );
  await catering
    .getByRole("heading", { name: "1 x Vegetarian + Gluten free", exact: true })
    .waitFor();
  await catering
    .getByRole("button", { name: "Copy dinner summary", exact: true })
    .click();
  await catering.getByText("Dinner summary copied.", { exact: true }).waitFor();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(report, /Dinner headcount: 2/);
  assert.match(report, /12 October 2026/);
  assert.match(report, /Nut allergy; Cross-contamination is a concern/);
  assert.match(report, /vegetarian; Gluten free/);
  assert.doesNotMatch(
    report,
    /Mo Khazali|Organizer dinner guest|13 October|Marsio/,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await catering
    .getByRole("button", { name: "Copy dinner summary", exact: true })
    .click();
  const fallback = catering.getByLabel(
    "Dinner catering summary (select and copy)",
    { exact: true },
  );
  await fallback.waitFor({ state: "visible" });
  assert.match(await fallback.inputValue(), /Dinner headcount: 2/);
  await page.evaluate(() => Reflect.deleteProperty(navigator, "clipboard"));
  const downloadPromise = page.waitForEvent("download");
  await catering
    .getByRole("button", { name: "Download dinner summary", exact: true })
    .click();
  const download = await downloadPromise;
  assert.equal(
    download.suggestedFilename(),
    "sdlcai-2026-dinner-catering-summary.txt",
  );
  assert.match(await readFile(await download.path(), "utf8"), /Nut allergy/);
  await catering
    .getByRole("button", { name: "Copy dinner summary", exact: true })
    .click();
  await catering.getByText("Dinner summary copied.", { exact: true }).waitFor();
  assert.equal(await fallback.isVisible(), false);

  const outage = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary dinner outage." }),
    });
  await page.route("**/api/admin/speaker-dinner", outage);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await catering
    .getByText(
      "Temporary dinner outage. Refresh before exporting the dinner summary.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await catering
      .getByRole("button", { name: "Download dinner summary", exact: true })
      .isDisabled(),
    true,
  );
  await page.unroute("**/api/admin/speaker-dinner", outage);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await mo.getByRole("combobox").waitFor();
  assert.equal(await cateringCount("Dinner headcount"), "2");

  const list = await (
    await context.request.get(origin + "/api/admin/speaker-dinner")
  ).json();
  const speaker = list.speakers.find(
    (item) => item.speaker_id === "ohans-emmanuel",
  );
  assert.equal(
    (
      await context.request.post(
        origin + "/api/admin/speaker-dinner/attendance",
        {
          headers: {
            origin,
            "x-admin-action": "manage-speaker-dinner-attendance",
          },
          data: {
            speaker_id: speaker.speaker_id,
            revision: speaker.dinner_revision,
            attendance: "not_attending",
          },
        },
      )
    ).status(),
    200,
  );
  await ohans.getByRole("combobox").selectOption("attending");
  await ohans
    .getByRole("button", { name: "Save attendance", exact: true })
    .click();
  await page
    .getByText(
      "Dinner attendance changed. Refresh the list before saving again.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await ohans.getByText("Not Attending", { exact: true }).first().waitFor();
  await page.locator('[data-admin-dinner-filter="not_attending"]').click();
  assert.equal(
    await cateringCount("Dinner headcount"),
    "2",
    "Dinner list filters do not change catering totals",
  );
  assert.equal(await page.locator("[data-dinner-speaker-id]").count(), 1);
  await save(ohans, "", "Ohans Emmanuel");
  assert.equal(await page.locator("[data-dinner-speaker-id]").count(), 0);
  await page.locator('[data-admin-dinner-filter="all"]').click();
  await save(mo, "not_attending", "Mo Khazali");
  await page.reload();
  await mo.getByText("Not Attending", { exact: true }).first().waitFor();
  assert.equal(await mo.getByRole("combobox").inputValue(), "not_attending");
  assert.equal(await cateringCount("Dinner headcount"), "1");
  await save(mo, "attending", "Mo Khazali");

  const axeSource = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: [
              "wcag2a",
              "wcag2aa",
              "wcag21a",
              "wcag21aa",
              "wcag22aa",
              "best-practice",
            ],
          },
          rules: { "target-size": { enabled: false } },
        })
      ).violations.map((item) => ({
        id: item.id,
        targets: item.nodes.map((node) => node.target),
      })),
    );
    assert.deepEqual(violations, []);
    await mo.screenshot({
      path: path.join(tmpdir(), `sdlcai-dinner-${viewport.width}.png`),
    });
    await catering.screenshot({
      path: path.join(tmpdir(), `sdlcai-dinner-catering-${viewport.width}.png`),
    });
  }
  await page.goto(origin + "/admin/speakers/");
  const manageLink = page.locator(
    'a[href="/admin/dinner/#speaker-mo-khazali"]',
  );
  await manageLink.waitFor();
  await manageLink.click();
  await mo.getByRole("combobox").waitFor();
  assert.equal(new URL(page.url()).hash, "#speaker-mo-khazali");
  assert.deepEqual(errors, []);
  console.log(
    "Dinner browser check passed: shared diet aggregation for attending speakers and guests, meal and contamination counts, combined groups, copy/fallback/download, failed-load recovery, manual attendance, preserved food notes, catering CSV, missing diet details, stale-save rejection, filter-independent totals, persistence, speaker admin link, keyboard focus, mobile layout and accessibility.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
