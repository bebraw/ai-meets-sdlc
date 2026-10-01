import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import ts from "typescript";
import {
  createReceiptFixture,
  receiptAdmin,
} from "../test/helpers/receipt-fixture.mjs";
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
  const page = await browser.newPage({
    extraHTTPHeaders: { authorization: receiptAdmin },
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  await page.route("**/test-scripts/*.ts", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").at(-1);
    if (!["badge-layout.ts", "admin-toolkit.ts"].includes(file))
      return route.abort();
    const source = await readFile(`site/scripts/${file}`, "utf8");
    await route.fulfill({
      contentType: "text/javascript",
      body: ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    });
  });
  await page.goto(`${origin}/admin/badges/`);
  await page.getByText("Saved badge list loaded.", { exact: true }).waitFor();
  const previousProof = page.getByRole("button", {
    name: "← Previous",
    exact: true,
  });
  const nextProof = page.getByRole("button", { name: "Next →", exact: true });
  const proofNavigation = page.getByRole("group", { name: "Proof navigation" });
  assert.ok(await previousProof.isDisabled());
  assert.ok(await nextProof.isDisabled());
  // Run the real browser font/shaping and circle-bound checks on adversarial names.
  const layouts = await page.evaluate(async () => {
    const { loadBadgeFont, renderBadge } =
      await import("/test-scripts/badge-layout.ts");
    const font = await loadBadgeFont();
    const settings = {
      diameter: 100,
      bleed: 0,
      safe: 5,
      top: 14,
      minName: 18,
      maxName: 30,
      companySize: 12,
      guides: false,
      doubleSided: false,
    };
    const names = [
      "Juho Vepsäläinen",
      "Łukasz Żółć",
      "Nguyễn Thị Minh Khai",
      "Zoë O’Connor-Sørensen",
      "Αλέξανδρος Παπαδόπουλος",
      "Александра Константинопольская",
      "María Fernanda de los Ángeles García López",
      "W".repeat(180),
      "張偉",
    ];
    return names.map((name) => ({
      name,
      issues: renderBadge(
        { name, company: "Aalto University", role: "attendee" },
        settings,
        font,
      ).issues,
    }));
  });
  for (const row of layouts.slice(0, 4))
    assert.deepEqual(row.issues, [], row.name);
  assert.ok(layouts.at(-2).issues.some((x) => x.includes("minimum size")));
  assert.ok(layouts.at(-1).issues.some((x) => x.includes("Font lacks")));
  await page.getByLabel("CSV file").setInputFiles({
    name: "tito.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Ticket Full Name,Ticket Company Name,Ticket Email\nŁukasz Żółć,Aalto,one@example.test\nNguyễn Thị Minh Khai,Research,two@example.test",
    ),
  });
  await page.getByRole("button", { name: "Append CSV rows" }).click();
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    "1 / 2",
  );
  await nextProof.click();
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    "2 / 2",
  );
  assert.ok(
    (await page.locator(".badge-preview").textContent()).includes("Nguyễn"),
  );
  await nextProof.press("ArrowRight");
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    "1 / 2",
  );
  await previousProof.click();
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    "2 / 2",
  );
  await previousProof.press("ArrowLeft");
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    "1 / 2",
  );
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page.getByText(/2 badges passed layout and duplicate checks/).waitFor();
  await page.getByLabel("CSV file").setInputFiles({
    name: "webropol.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,company,email\nDuplicate,,ONE@example.test"),
  });
  await page.getByRole("button", { name: "Append CSV rows" }).click();
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page.getByText(/2 badges need attention/).waitFor();
  await page
    .getByRole("article")
    .last()
    .getByLabel("Include in print run")
    .uncheck();
  await page.getByRole("button", { name: "Save badge list" }).click();
  await page.getByText("Badge list and printer settings saved.").waitFor();
  await page.reload();
  await page.getByText("Saved badge list loaded.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("article").count(), 3);
  await page.goto(`${origin}/admin/speakers/`);
  await page.getByText(/Loaded \d+ speakers\./).waitFor();
  const speakerEditor = page.locator("[data-admin-speakers] > article").first();
  await speakerEditor
    .getByText("Edit speaker details", { exact: true })
    .click();
  await speakerEditor.locator('[name="profile.honorific"]').fill("Md");
  await speakerEditor.locator('[name="profile.credentials"]').fill("PhD");
  await speakerEditor
    .getByRole("button", { name: "Approve & publish", exact: true })
    .click();
  await page
    .getByText("Organizer edit approved and published.", { exact: true })
    .waitFor();
  await speakerEditor
    .getByText("Edit speaker details", { exact: true })
    .click();
  assert.equal(
    await speakerEditor.locator('[name="profile.name"]').inputValue(),
    "Mo Khazali",
  );
  assert.equal(
    await speakerEditor.locator('[name="profile.honorific"]').inputValue(),
    "Md",
  );
  assert.equal(
    await speakerEditor.locator('[name="profile.credentials"]').inputValue(),
    "PhD",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Speaker editor mobile horizontal overflow",
  );
  await speakerEditor
    .locator('[name="profile.honorific"]')
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/sdlcai-speaker-titles-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/admin/badges/`);
  await page.getByText("Saved badge list loaded.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh speakers" }).click();
  await page.getByText(/speakers refreshed/).waitFor();
  const badgeNames = await page
    .locator("article textarea")
    .evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.ok(badgeNames.includes("Muhammad Waseem"));
  assert.ok(badgeNames.includes("Mo Khazali"));
  assert.ok(!badgeNames.some((name) => /\b(?:Dr|Md|PhD)\b/u.test(name)));
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page.getByText(/badges passed layout and duplicate checks/).waitFor();
  // Inspect the exact print DOM without opening a native print dialog.
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await page
    .getByRole("button", { name: "Print / save PDF — speaker", exact: true })
    .click();
  await page.waitForFunction(() => window.__printed);
  const speakerPrint = (
    await page.locator(".badge-print-root text").allTextContents()
  ).join(" ");
  assert.match(speakerPrint, /Muhammad Waseem/u);
  assert.match(speakerPrint, /Mo Khazali/u);
  assert.doesNotMatch(speakerPrint, /\b(?:Dr|Md|PhD)\b/u);
  await page.evaluate(() => {
    window.__printed = false;
  });
  await page
    .getByRole("button", { name: "Print / save PDF — attendee", exact: true })
    .click();
  await page.waitForFunction(() => window.__printed);
  assert.equal(await page.locator(".badge-print-sheet").count(), 2);
  const svgColors = await page.evaluate(async () => {
    const { loadBadgeFont, renderBadge } =
      await import("/test-scripts/badge-layout.ts");
    const font = await loadBadgeFont();
    const settings = {
      diameter: 100,
      bleed: 0,
      safe: 5,
      top: 14,
      minName: 18,
      maxName: 30,
      companySize: 12,
      guides: false,
      doubleSided: false,
    };
    const section = document.createElement("div");
    section.id = "badge-role-proofs";
    section.style.cssText =
      "display:flex;gap:10px;background:#ddd;padding:10px;width:max-content";
    const colors = [];
    for (const role of ["attendee", "speaker", "organizer"]) {
      const result = renderBadge(
        {
          name: "María Fernanda de los Ángeles García López",
          company: "University of Applied Sciences",
          role,
        },
        settings,
        font,
      );
      if (result.issues.length) throw new Error(result.issues.join(" "));
      colors.push(result.svg.querySelector("rect").getAttribute("fill"));
      section.appendChild(result.svg);
    }
    document.body.appendChild(section);
    return colors;
  });
  assert.deepEqual(svgColors, ["#ffffff", "#000000", "#f58220"]);
  await page
    .locator("#badge-role-proofs")
    .screenshot({ path: "/tmp/sdlcai-badge-roles.png" });
  await page.locator("#badge-role-proofs").evaluate((node) => node.remove());
  await page
    .locator(".badge-preview")
    .screenshot({ path: "/tmp/sdlcai-badge-proof.png" });
  await page.screenshot({
    path: "/tmp/sdlcai-badge-studio.png",
    fullPage: false,
  });
  const pdf = await page.pdf({
    path: "/tmp/sdlcai-badge-test.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal(
    [...pdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
    2,
  );
  await page.getByText("Printer settings", { exact: true }).click();
  await page.getByLabel("Bleed per edge (mm)", { exact: true }).fill("3");
  await page.getByLabel("Bleed per edge (mm)", { exact: true }).press("Tab");
  await page.getByLabel("Repeat each badge for an identical back").check();
  await page.evaluate(() => {
    window.__printed = false;
  });
  await page
    .getByRole("button", { name: "Print / save PDF — attendee", exact: true })
    .click();
  await page.waitForFunction(() => window.__printed);
  assert.equal(await page.locator(".badge-print-sheet").count(), 4);
  assert.equal(
    await page.locator(".badge-print-sheet svg").first().getAttribute("width"),
    "106mm",
  );
  const bleedPdf = await page.pdf({
    path: "/tmp/sdlcai-badge-bleed-test.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal(
    [...bleedPdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
    4,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile horizontal overflow",
  );
  await page.goto(`${origin}/admin/organizers/`);
  await page
    .getByText("Homepage visibility and badge inclusion are independent.")
    .waitFor();
  const first = page.locator("[data-admin-organizers] form").first();
  await first.getByLabel("Attending").check();
  await first
    .getByRole("button", { name: "Save organizer", exact: true })
    .click();
  await page.getByText("Organizer saved. Homepage changes are live.").waitFor();
  await page.goto(`${origin}/admin/badges/`);
  await page.getByText("Saved badge list loaded.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Refresh organizers" }).click();
  await page.getByText(/organizers refreshed/).waitFor();
  assert.equal(
    await page.getByRole("article").filter({ hasText: "organizers" }).count(),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Badge browser checks passed: Unicode, overflow, imports, duplicates, encrypted persistence, sources, print pagination, and mobile layout.",
  );
  console.log(JSON.stringify(layouts));
} finally {
  await browser?.close();
  await fixture.dispose();
}
