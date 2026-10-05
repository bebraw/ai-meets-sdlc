import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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
  assert.equal(
    await page.locator('[data-admin-dinner-count="attending"]').textContent(),
    "1",
  );
  await save(mo, "not_attending", "Mo Khazali");
  await mo.getByText("Not Attending", { exact: true }).first().waitFor();
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
  await save(ohans, "", "Ohans Emmanuel");
  await ohans.getByText("Awaiting Reply", { exact: true }).first().waitFor();

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
  assert.equal(await page.locator("[data-dinner-speaker-id]").count(), 1);
  await save(ohans, "", "Ohans Emmanuel");
  assert.equal(await page.locator("[data-dinner-speaker-id]").count(), 0);
  await page.locator('[data-admin-dinner-filter="all"]').click();
  await save(mo, "not_attending", "Mo Khazali");
  await page.reload();
  await mo.getByText("Not Attending", { exact: true }).first().waitFor();
  assert.equal(await mo.getByRole("combobox").inputValue(), "not_attending");

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
      path: `/private/tmp/sdlcai-dinner-${viewport.width}.png`,
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
    "Dinner browser check passed: manual attendance, preserved food notes, restoring speaker replies, counts, catering CSV, missing diet details, stale-save rejection, filtering, persistence, speaker admin link, keyboard focus, mobile layout and accessibility.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
