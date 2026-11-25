import assert from "node:assert/strict";
import { blocks as printBlocks } from "../toolkit/dist/blocks/print.mjs";

async function checkTitleFit(title, path, width) {
  const brokenWords = await title.evaluate(async (heading) => {
    await document.fonts.ready;
    const column = heading.getBoundingClientRect();
    const text = heading.firstChild;
    const range = document.createRange();
    const failures = [];
    for (const word of text.textContent.matchAll(/\S+/gu)) {
      range.setStart(text, word.index);
      range.setEnd(text, word.index + word[0].length);
      const rects = [...range.getClientRects()];
      if (
        rects.length !== 1 ||
        rects[0].left < column.left - 1 ||
        rects[0].right > column.right + 1
      )
        failures.push(word[0]);
    }
    return failures;
  });
  assert.deepEqual(
    brokenWords,
    [],
    `Title word wrapping at ${path} (${width}px)`,
  );
}

async function checkPrintSetups(page) {
  async function copy(block, operation, manual = false) {
    await page.evaluate((fallback) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async writeText(text) {
            if (fallback) throw new Error("Clipboard unavailable");
            window.copiedSetup = text;
          },
        },
      });
    }, manual);
    await page.getByRole("button", { name: "Copy setup" }).click();
    await page.getByText(/Edit as JSON.+Apply JSON/).waitFor();
    const raw = manual
      ? await page.getByLabel("Setup JSON to copy").inputValue()
      : await page.evaluate(() => window.copiedSetup);
    const setup = JSON.parse(raw);
    printBlocks
      .find((b) => b.id === block)
      .operations.find((o) => o.name === operation)
      .prepare(setup);
    return setup;
  }
  await page.goto("/toolkit/badges/");
  await page.getByLabel("Display name").fill("River Chen");
  await page.getByLabel("Badge shape").selectOption("rounded-square");
  await page.getByLabel("Print font").selectOption("lora");
  await page.getByLabel("Attachment").selectOption("holder");
  await page.getByLabel("Event logo").selectOption("Field Notes logo");
  await page.getByLabel("Print paper").selectOption("a4");
  await page.getByText("Print settings", { exact: true }).click();
  await page.getByLabel("Trim width (mm)").fill("80");
  await page.getByLabel("Bleed per edge (mm)").fill("2");
  await page.getByLabel("Spare attendee badges").fill("7");
  await page.getByLabel("Printed sides").selectOption("Matching back");
  await page
    .getByText("6 per sheet · 2 sheets · 4 PDF pages at 210 × 297 mm.")
    .waitFor();
  assert.equal(await page.locator("figure [data-cut-marks]").count(), 6);
  const badge = await copy("badges", "badges_preflight");
  assert.equal(badge.people[0].name, "River Chen");
  assert.ok(badge.logo.startsWith("data:image/"));
  assert.deepEqual(badge.spares, [{ role: "attendee", count: 7 }]);
  assert.deepEqual(badge.settings, {
    shape: "rounded-square",
    font: "lora",
    attachment: "holder",
    paper: "a4",
    diameter: 80,
    bleed: 2,
    doubleSided: true,
    sheetMargin: 5,
    cutMarks: true,
  });
  await page.getByLabel("Display name").fill("");
  await page.getByRole("button", { name: "Copy setup" }).click();
  assert.equal(
    await page.getByText("Setup copied.", { exact: false }).count(),
    0,
  );

  await page.goto("/toolkit/venue-signs/");
  await page.getByLabel("Destination").fill("Quiet room");
  await page.getByLabel("Direction").selectOption("Right");
  await page.getByLabel("Print font").selectOption("fira-code");
  assert.deepEqual(await copy("venue-signs", "venue_signs_export_pdf", true), {
    eventName: "Field Notes Forum",
    font: "fira-code",
    signs: [{ title: "Quiet room", direction: "right" }],
  });

  await page.goto("/toolkit/table-tents/");
  await page.getByLabel("Discussion topic").fill("W".repeat(100));
  await page.getByLabel("Starter question").fill("W".repeat(280));
  const overflow = page.getByText(
    "Text exceeds the preview. Shorten the copy before printing.",
  );
  await overflow.waitFor();
  await page.getByLabel("Discussion topic").fill("Code review");
  await page.getByLabel("Starter question").fill("");
  await page.getByLabel("Print font").selectOption("lora");
  await overflow.waitFor({ state: "hidden" });
  assert.deepEqual(await copy("table-tents", "table_tents_export_pdf"), {
    eventName: "Field Notes Forum",
    font: "lora",
    tables: [{ label: "Table 3", topic: "Code review" }],
  });
}

export async function validateToolkitExplorer(page) {
  const phone = page.viewportSize();
  await page.goto("/toolkit/");
  const paths = await page
    .locator("#blocks li")
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  assert.equal(paths.length, 19, "Every catalog item should link to its guide");
  assert.equal(new Set(paths).size, 19, "Catalog guides need distinct URLs");

  const titles = new Set();
  for (const path of paths) {
    assert.match(path, /^\/toolkit\/[a-z0-9-]+\/$/);
    const response = await page.goto(path);
    assert.equal(response?.status(), 200, path);
    const id = path.split("/")[2];
    const demo = page.locator(`[data-toolkit-demo="${id}"]`);
    await page.getByRole("button", { name: "Reset example" }).waitFor();
    const heading = page.locator("article > div > header h1");
    const title = (await heading.innerText()).trim();
    assert.ok(
      title && !titles.has(title),
      "Missing or duplicate guide title at " + path,
    );
    titles.add(title);
    await page.setViewportSize({ width: 1024, height: phone.height });
    await checkTitleFit(heading, path, 1024);
    const leftColumnGap = await page
      .locator(".toolkit-intro")
      .evaluate(
        (header) =>
          document
            .querySelector('[aria-labelledby="actions-heading"]')
            .getBoundingClientRect().top -
          header.getBoundingClientRect().bottom,
      );
    assert.ok(
      leftColumnGap < 64,
      "Block capabilities separated from the introduction at " + path,
    );
    await page.setViewportSize(phone);
    await checkTitleFit(heading, path, phone.width);
    const actions = page
      .getByRole("region", { name: "What you can do" })
      .getByRole("listitem");
    assert.ok((await actions.count()) > 0, "Missing actions at " + path);
    await demo.locator(".demo-result > div > :visible").first().waitFor();

    const mobileIssues = await demo.evaluate((root) => {
      const issues = [];
      const controls = root.querySelectorAll("input, textarea, select, button");
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (!box.width || !box.height) continue;
        const name =
          control.getAttribute("aria-label") ||
          control.labels?.[0]?.textContent ||
          control.textContent;
        if (!name?.trim()) issues.push("Unlabelled " + control.tagName);
        if (
          box.left < -1 ||
          box.right > document.documentElement.clientWidth + 1
        )
          issues.push("Control outside the viewport: " + name);
      }
      if (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1
      )
        issues.push("Page has horizontal overflow");
      return issues;
    });
    assert.deepEqual(
      mobileIssues,
      [],
      "Mobile guide at " + path + ": " + mobileIssues.join(", "),
    );
  }

  await page.goto("/toolkit/#blocks");
  await page.locator('#blocks a[href="/toolkit/audience-qa/"]').click();
  await page.getByText("Operations and access", { exact: true }).click();
  const stageOperation = page.locator("details dl > div").filter({
    has: page.getByText("qa_present", { exact: true }),
  });
  assert.match(await stageOperation.innerText(), /Organizer, MC/);
  const preview = page.locator(".demo-result");
  const questionRow = (text) =>
    preview
      .getByRole("listitem")
      .filter({ has: page.getByText(text, { exact: true }) });
  const leader = questionRow("How did you test the change?");
  const example = questionRow("Could you show a worked example?");
  const screen = page.getByRole("region", { name: "Stage screen preview" });
  assert.match(await leader.innerText(), /4 votes/);
  const vote = example.getByRole("button", { name: /^Vote for/ });
  await vote.focus();
  await vote.press("Enter");
  assert.match(await example.innerText(), /2 votes/);
  assert.ok(await vote.isDisabled());
  assert.match(await screen.innerText(), /waiting for the MC/);
  await page
    .getByLabel("Attendee question")
    .fill("May we share the recording?");
  await page.getByRole("button", { name: "Submit as attendee" }).click();
  assert.match(
    await page.locator("[data-toolkit-demo] [role=status]").innerText(),
    /Pending moderator review/,
  );
  assert.equal(await questionRow("May we share the recording?").count(), 0);
  await page.getByRole("button", { name: "Approve as moderator" }).click();
  const submitted = questionRow("May we share the recording?");
  assert.match(await submitted.innerText(), /0 votes/);
  assert.ok(
    await submitted
      .getByRole("button", { name: "You submitted this question" })
      .isDisabled(),
  );
  await example.getByRole("button", { name: /on stage as MC/ }).click();
  assert.match(await screen.innerText(), /Could you show a worked example/);
  await leader.getByRole("button", { name: /on stage as MC/ }).click();
  assert.match(await screen.innerText(), /How did you test the change/);
  await page.getByRole("button", { name: "Clear stage screen" }).click();
  assert.match(await screen.innerText(), /waiting for the MC/);
  assert.equal(await leader.count(), 1);
  await submitted.getByRole("button", { name: /on stage as MC/ }).click();
  await page.getByRole("button", { name: "Mark answered as MC" }).click();
  assert.equal(await submitted.count(), 0);
  assert.match(await screen.innerText(), /waiting for the MC/);
  await page.getByRole("button", { name: "Reset example" }).click();
  assert.match(await example.innerText(), /1 vote\b/);
  assert.ok(await vote.isEnabled());
  assert.equal(
    await page.getByLabel("Attendee question").inputValue(),
    "Will the session slides be available?",
  );

  await page.getByRole("link", { name: "All toolkit blocks" }).click();
  await page.locator('#blocks a[href="/toolkit/lanyards/"]').click();
  await page.getByLabel("Spare attendee lanyards").fill("4");
  await page.getByLabel("Speaker color").selectOption("Blue");
  assert.match(await preview.innerText(), /14 blue lanyards/);
  assert.doesNotMatch(await preview.innerText(), /red lanyards/);
  await checkPrintSetups(page);
  await page.goto("/toolkit/catering/");
  const download = page.getByRole("button", {
    name: "Download catering-brief.txt",
  });
  assert.ok(await download.isEnabled());
  await page.getByLabel("Third guest’s dietary response").fill("Vegetarian");
  assert.ok(
    await download.isDisabled(),
    "The download must reflect the latest dietary response.",
  );
  await page.getByLabel("Additional reserved meals").selectOption("2");
  await page.getByRole("button", { name: "Update meal counts" }).click();
  await page.getByText("5 meals to prepare", { exact: true }).waitFor();
  assert.ok(await download.isEnabled());
}
