import assert from "node:assert/strict";

export async function validateToolkitExplorer(page) {
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
    const title = (
      await page.locator("article > div > header h1").innerText()
    ).trim();
    assert.ok(
      title && !titles.has(title),
      "Missing or duplicate guide title at " + path,
    );
    titles.add(title);
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
  await page
    .getByLabel("Attendee question")
    .fill("May we share the recording?");
  await page.getByRole("button", { name: "Submit as attendee" }).click();
  assert.match(await preview.innerText(), /pending moderator review/i);
  await page.getByRole("button", { name: "Approve as moderator" }).click();
  assert.match(await preview.innerText(), /stage screen waiting/i);
  await page.getByRole("button", { name: "Show on stage as MC" }).click();
  assert.match(
    await page
      .getByRole("region", { name: "Stage screen preview" })
      .innerText(),
    /May we share the recording\?/i,
  );
  await page.getByRole("button", { name: "Reset example" }).click();
  assert.match(await preview.innerText(), /question queue empty/i);
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
}
