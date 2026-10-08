import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import ts from "typescript";
import { encryptText } from "../worker/form-utils.ts";
import { defaultSettings } from "../site/scripts/badge-model.ts";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as apiOrigin,
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
    if (
      !["badge-layout.ts", "badge-roles.ts", "admin-toolkit.ts"].includes(file)
    )
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
  const send = async (method, body) => {
    const response = await fixture.worker.fetch(
      `${apiOrigin}/api/admin/attendees`,
      {
        method,
        headers: {
          authorization: receiptAdmin,
          origin: apiOrigin,
          "content-type": "application/json",
          "x-admin-action": "manage-attendees",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  const earlier = {
    id: "earlier-no-email",
    name: "Earlier manual person",
    email: "",
    company: "",
    role: "attendee",
    source: "Manual",
    included: false,
    duplicateReviewed: false,
  };
  const encrypted = await encryptText(
    JSON.stringify({ people: [earlier], settings: defaultSettings }),
    "isolated-receipt-test-encryption",
  );
  await fixture.runSql(
    `UPDATE badge_workspace SET ciphertext = '${encrypted.ciphertext}', iv = '${encrypted.iv}' WHERE id = 1`,
  );
  const inputs = [
    {
      name: "Łukasz Żółć",
      company: "Aalto",
      email: "one@example.test",
      ticketCode: "ONE",
      status: "active",
      badge: true,
    },
    {
      name: "Nguyễn Thị Minh Khai",
      company: "Research",
      email: "two@example.test",
      ticketCode: "TWO",
      status: "active",
      badge: true,
    },
  ];
  await send("POST", { revision: 0, source: "tito", attendees: inputs });
  const ready =
    "Badge studio ready. People are loaded from attendee and team records.";
  const summary = page.locator("[data-badge-summary]");
  const readSummary = async () => ({
    rows: await summary.locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) => ({
        role: row.dataset.badgeSummaryRole,
        ...Object.fromEntries(
          Array.from(row.querySelectorAll("[data-badge-summary-count]")).map(
            (cell) => [
              cell.dataset.badgeSummaryCount,
              Number(cell.textContent),
            ],
          ),
        ),
      })),
    ),
    total: Number(await summary.locator("[data-lanyard-total]").textContent()),
  });
  // A failed initial load must not present a zero-lanyard shopping total.
  await page.route("**/api/admin/badges", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary badge outage" }),
    }),
  );
  await page.goto(`${origin}/admin/badges/`);
  await page.getByText("Temporary badge outage", { exact: true }).waitFor();
  assert.equal(await summary.isVisible(), false);
  await page.unroute("**/api/admin/badges");
  await page.goto(`${origin}/admin/badges/`);
  await page.getByText(ready, { exact: true }).waitFor();
  assert.ok(await summary.isVisible());
  const initialSummary = await readSummary();
  assert.equal(initialSummary.total, await page.getByRole("article").count());
  assert.equal(await page.getByLabel("CSV file").count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Add a manual badge" }).count(),
    0,
  );
  assert.equal(await page.getByLabel("Include in print run").count(), 0);
  const earlierCard = page
    .getByRole("article")
    .filter({ hasText: "attendee · Manual" });
  assert.equal(
    await earlierCard.count(),
    0,
    "Earlier exclusions start retired",
  );
  await page
    .getByRole("button", {
      name: "Restore retired earlier badges",
      exact: true,
    })
    .click();
  await page
    .getByText(
      "Earlier badge retirement choices cleared. Current registration and team choices still apply.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await earlierCard.count(), 1);
  assert.equal((await readSummary()).total, initialSummary.total + 1);
  assert.equal(
    (await readSummary()).rows[0].named,
    initialSummary.rows[0].named + 1,
  );
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await page
    .getByRole("button", { name: "Print / save PDF — attendee", exact: true })
    .click();
  await page.waitForFunction(() => window.__printed);
  assert.equal(await page.locator(".badge-print-sheet").count(), 3);
  assert.ok(
    (await page.locator(".badge-print-root text").allTextContents())
      .join(" ")
      .includes(earlier.name),
    "A restored earlier exclusion is printable",
  );
  await page.evaluate(() => {
    window.dispatchEvent(new Event("afterprint"));
    window.__printed = false;
  });
  assert.equal(
    await page
      .getByRole("article")
      .filter({ hasText: "attendee · attendees" })
      .getByRole("button", { name: "Retire earlier badge" })
      .count(),
    0,
  );
  await earlierCard
    .getByRole("button", { name: "Retire earlier badge", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await page
    .getByText("Print settings and badge text saved.", { exact: true })
    .waitFor();
  await page.reload();
  await page.getByText(ready, { exact: true }).waitFor();
  assert.equal(
    await earlierCard.count(),
    0,
    "Retirement survives reload without a matching email",
  );
  assert.deepEqual(await readSummary(), initialSummary);
  await page
    .getByRole("button", {
      name: "Restore retired earlier badges",
      exact: true,
    })
    .click();
  await page
    .getByText(
      "Earlier badge retirement choices cleared. Current registration and team choices still apply.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await earlierCard.count(), 1);
  await earlierCard
    .getByRole("button", { name: "Retire earlier badge", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await page
    .getByText("Print settings and badge text saved.", { exact: true })
    .waitFor();
  const previousProof = page.getByRole("button", {
    name: "← Previous",
    exact: true,
  });
  const nextProof = page.getByRole("button", { name: "Next →", exact: true });
  const proofNavigation = page.getByRole("group", { name: "Proof navigation" });
  const total = await page.getByRole("article").count();
  assert.ok(
    total > 2,
    "Speakers are loaded automatically alongside registrations",
  );
  assert.ok(await previousProof.isEnabled());
  assert.ok(await nextProof.isEnabled());
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
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    `1 / ${total}`,
  );
  await nextProof.click();
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    `2 / ${total}`,
  );
  assert.ok(
    (await page.locator(".badge-preview").textContent()).includes("Nguyễn"),
  );
  await previousProof.press("ArrowLeft");
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    `1 / ${total}`,
  );
  await previousProof.click();
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    `${total} / ${total}`,
  );
  await nextProof.press("ArrowRight");
  assert.equal(
    await proofNavigation.getByRole("status").textContent(),
    `1 / ${total}`,
  );
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page
    .getByText(new RegExp(`${total} badges passed layout and duplicate checks`))
    .waitFor();
  const firstBadge = page.getByRole("article").first();
  await firstBadge.getByLabel("Badge name").fill("Łukasz\nŻółć");
  await firstBadge.getByLabel("Badge name").press("Tab");
  await page.getByRole("button", { name: "Save print settings" }).click();
  await page.getByText("Print settings and badge text saved.").waitFor();
  await page.reload();
  await page.getByText(ready, { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("article")
      .first()
      .getByLabel("Badge name")
      .inputValue(),
    "Łukasz\nŻółć",
  );
  let roster = await send("GET");
  await send("POST", {
    revision: roster.revision,
    source: "webropol",
    attendees: [{ ...inputs[0], name: "Duplicate", ticketCode: "DUPLICATE" }],
  });
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page
    .getByText(
      "People changed since this preview. Review the updated badges, then check or print again.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page.getByText(/2 badges need attention/).waitFor();
  roster = await send("GET");
  const duplicate = roster.attendees.find((p) => p.source === "webropol");
  await send("PUT", {
    revision: roster.revision,
    id: duplicate.id,
    attendee: { ...duplicate, badge: false },
  });
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page
    .getByText(
      "People changed since this preview. Review the updated badges, then check or print again.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Check all included badges" }).click();
  await page
    .getByText(new RegExp(`${total} badges passed layout and duplicate checks`))
    .waitFor();
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
  await page.getByText(ready, { exact: true }).waitFor();

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
    for (const role of ["attendee", "speaker", "organizer", "sponsor"]) {
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
  assert.deepEqual(svgColors, ["#ffffff", "#000000", "#f58220", "#64c4bc"]);
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
  await page.getByText(ready, { exact: true }).waitFor();

  assert.equal(
    await page.getByRole("article").filter({ hasText: "organizers" }).count(),
    1,
  );
  const attendeeCard = page
    .getByRole("article")
    .filter({ hasText: "attendee · attendees" })
    .first();
  await attendeeCard.getByLabel("Badge name").fill("張偉");
  await attendeeCard.getByLabel("Badge name").press("Tab");
  await page.evaluate(() => {
    window.__printed = false;
    window.print = () => {
      window.__printed = true;
    };
  });
  await page
    .getByRole("button", { name: "Print / save PDF — attendee", exact: true })
    .click();
  await page
    .getByText(/Font lacks/)
    .first()
    .waitFor();
  assert.equal(await page.evaluate(() => window.__printed), false);
  await attendeeCard.getByRole("button", { name: "Reset badge text" }).click();
  roster = await send("GET");
  const cancelled = roster.attendees.find((p) => p.ticketCode === "ONE");
  await send("PUT", {
    revision: roster.revision,
    id: cancelled.id,
    attendee: { ...cancelled, status: "cancelled" },
  });
  await page
    .getByRole("button", { name: "Print / save PDF — attendee", exact: true })
    .click();
  await page
    .getByText(
      "People changed since this preview. Review the updated badges, then check or print again.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.__printed),
    false,
    "A source change must be reviewed before printing",
  );
  await page
    .getByRole("button", { name: "Print / save PDF — attendee", exact: true })
    .click();
  await page.waitForFunction(() => window.__printed);
  assert.equal(await page.locator(".badge-print-sheet").count(), 1);
  assert.doesNotMatch(
    (await page.locator(".badge-print-root text").allTextContents()).join(" "),
    /Łukasz/,
  );
  // Spares are print preferences, not fabricated registrations. Check the
  // import hand-off, saved count, blank artwork, and actual PDF pagination.
  const registrationsBeforeSpares = (await send("GET")).attendees;
  await page.goto(`${origin}/admin/badges/?spares=13`);
  await page
    .getByText(
      "13 spare attendee badges prepared. Adjust the count and save print settings to keep it.",
      { exact: true },
    )
    .waitFor();
  const spareCount = page.getByLabel("Spare attendee badges", { exact: true });
  assert.equal(await spareCount.inputValue(), "13");
  assert.equal(new URL(page.url()).searchParams.has("spares"), false);
  await page
    .getByRole("button", { name: "Preview spare badge", exact: true })
    .click();
  assert.equal(
    await page.locator(".badge-preview svg").getAttribute("aria-label"),
    "Spare attendee badge",
  );
  assert.deepEqual(
    await page.locator(".badge-preview text").allTextContents(),
    ["ATTENDEE"],
  );
  await nextProof.click();
  assert.notEqual(
    await page.locator(".badge-preview svg").getAttribute("aria-label"),
    "Spare attendee badge",
  );
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await page
    .getByText("Print settings and badge text saved.", { exact: true })
    .waitFor();
  await page.reload();
  await page.getByText(ready, { exact: true }).waitFor();
  assert.equal(await spareCount.inputValue(), "13");
  const namedAttendees = await page
    .getByRole("article")
    .filter({ hasText: "attendee · attendees" })
    .count();
  const printRun = async (role) => {
    await page.evaluate(() => {
      window.__printed = false;
      window.print = () => {
        window.__printed = true;
      };
    });
    await page
      .getByRole("button", { name: `Print / save PDF — ${role}`, exact: true })
      .click();
    await page.waitForFunction(() => window.__printed);
  };
  await printRun("attendee");
  assert.equal(
    await page.locator(".badge-print-sheet").count(),
    namedAttendees + 13,
  );
  assert.equal(await page.locator("[data-spare-badge]").count(), 13);
  await printRun("all");
  assert.equal(
    await page.locator(".badge-print-sheet").count(),
    (await page.getByRole("article").count()) + 13,
  );
  await printRun("speaker");
  assert.equal(await page.locator("[data-spare-badge]").count(), 0);
  await printRun("spares");
  assert.equal(await page.locator(".badge-print-sheet").count(), 13);
  assert.deepEqual(
    [
      ...new Set(
        await page.locator(".badge-print-root text").allTextContents(),
      ),
    ],
    ["ATTENDEE"],
  );
  assert.equal(await page.locator(".badge-print-root image").count(), 13);
  const sparePdf = await page.pdf({
    path: "/tmp/sdlcai-spare-badges-test.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal(
    [...sparePdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
    13,
  );
  await page
    .getByRole("button", { name: "Preview spare badge", exact: true })
    .click();
  await page
    .locator(".badge-preview")
    .screenshot({ path: "/tmp/sdlcai-spare-attendee-badge.png" });
  await page.getByText("Printer settings", { exact: true }).click();
  await page.getByLabel("Repeat each badge for an identical back").check();
  await printRun("spares");
  assert.equal(await page.locator(".badge-print-sheet").count(), 26);
  const blankNameGuard = await page.evaluate(async () => {
    const { loadBadgeFont, renderBadge } =
      await import("/test-scripts/badge-layout.ts");
    const font = await loadBadgeFont();
    return renderBadge(
      { name: "", company: "", role: "attendee" },
      {
        diameter: 100,
        bleed: 0,
        safe: 5,
        top: 14,
        minName: 18,
        maxName: 30,
        companySize: 12,
        guides: false,
        doubleSided: false,
      },
      font,
    ).issues;
  });
  assert.ok(blankNameGuard.includes("Name is required."));
  const sponsorSpareCount = page.getByLabel("Spare sponsor badges", {
    exact: true,
  });
  assert.equal(await sponsorSpareCount.inputValue(), "0");
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await page
    .getByText("Print settings and badge text saved.", { exact: true })
    .waitFor();
  await page.goto(`${origin}/admin/badges/?sponsor-spares=7`);
  await page
    .getByText(
      "7 spare sponsor badges prepared. Adjust the count and save print settings to keep it.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await sponsorSpareCount.inputValue(), "7");
  assert.equal(new URL(page.url()).searchParams.has("sponsor-spares"), false);
  await page.getByText("Printer settings", { exact: true }).click();
  await page.getByLabel("Repeat each badge for an identical back").uncheck();
  assert.equal(await spareCount.inputValue(), "13");
  await page
    .getByRole("button", { name: "Preview spare sponsor badge", exact: true })
    .click();
  assert.equal(
    await page.locator(".badge-preview svg").getAttribute("aria-label"),
    "Spare sponsor badge",
  );
  assert.deepEqual(
    await page.locator(".badge-preview text").allTextContents(),
    ["SPONSOR"],
  );
  assert.equal(
    await page.locator(".badge-preview rect").first().getAttribute("fill"),
    "#64c4bc",
  );
  await page
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await page
    .getByText("Print settings and badge text saved.", { exact: true })
    .waitFor();
  await page.reload();
  await page.getByText(ready, { exact: true }).waitFor();
  assert.equal(await sponsorSpareCount.inputValue(), "7");
  assert.equal(await spareCount.inputValue(), "13");
  const expectedSummaryRows = [];
  for (const role of ["attendee", "speaker", "organizer", "sponsor"]) {
    const named = await page
      .getByRole("article")
      .filter({ hasText: `${role} ·` })
      .count();
    const spares = role === "attendee" ? 13 : role === "sponsor" ? 7 : 0;
    expectedSummaryRows.push({ role, named, spares, lanyards: named + spares });
  }
  const expectedSummary = {
    rows: expectedSummaryRows,
    total: (await page.getByRole("article").count()) + 20,
  };
  assert.deepEqual(await readSummary(), expectedSummary);
  assert.deepEqual(await summary.locator("tfoot td").allTextContents(), [
    String(expectedSummary.total - 20),
    "20",
    String(expectedSummary.total),
  ]);
  await page
    .getByLabel("Find a badge")
    .fill("no matching badge for this search");
  assert.equal(await page.getByRole("article").count(), 0);
  assert.deepEqual(await readSummary(), expectedSummary);
  await page.getByLabel("Find a badge").fill("");
  await page
    .context()
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await summary
    .getByRole("button", { name: "Copy lanyard summary", exact: true })
    .click();
  await summary.getByText("Lanyard summary copied.", { exact: true }).waitFor();
  const copiedSummary = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  assert.ok(copiedSummary.includes(`Total: ${expectedSummary.total} lanyards`));
  assert.match(
    copiedSummary,
    /Sponsors \(teal badges\): \d+ lanyards \(\d+ named \+ 7 spare\)/,
  );
  assert.doesNotMatch(copiedSummary, /example\.test/);
  const downloadEvent = page.waitForEvent("download");
  await summary
    .getByRole("button", { name: "Download lanyard summary", exact: true })
    .click();
  const summaryDownload = await downloadEvent;
  assert.equal(
    summaryDownload.suggestedFilename(),
    "sdlcai-lanyard-summary.txt",
  );
  assert.equal(
    await readFile(await summaryDownload.path(), "utf8"),
    copiedSummary,
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });
  await summary
    .getByRole("button", { name: "Copy lanyard summary", exact: true })
    .click();
  await summary
    .getByText(
      "Copy is unavailable. Download the summary or select the table to copy it.",
      { exact: true },
    )
    .waitFor();
  for (const invalid of ["-1", "0.5", "2001"]) {
    await sponsorSpareCount.fill(invalid);
    await sponsorSpareCount.press("Tab");
    assert.equal(await sponsorSpareCount.inputValue(), "7");
  }
  const namedSponsors = await page
    .getByRole("article")
    .filter({ hasText: "sponsor ·" })
    .count();
  await printRun("sponsor");
  assert.equal(
    await page.locator(".badge-print-sheet").count(),
    namedSponsors + 7,
  );
  assert.equal(await page.locator('[data-spare-badge="sponsor"]').count(), 7);
  assert.equal(await page.locator('[data-spare-badge="attendee"]').count(), 0);
  await printRun("attendee");
  assert.equal(
    await page.locator(".badge-print-sheet").count(),
    namedAttendees + 13,
  );
  assert.equal(await page.locator('[data-spare-badge="sponsor"]').count(), 0);
  await printRun("all");
  assert.equal(
    await page.locator(".badge-print-sheet").count(),
    (await page.getByRole("article").count()) + 20,
  );
  assert.equal(await page.locator('[data-spare-badge="sponsor"]').count(), 7);
  assert.equal(await page.locator('[data-spare-badge="attendee"]').count(), 13);
  await printRun("speaker");
  assert.equal(await page.locator("[data-spare-badge]").count(), 0);
  await printRun("sponsor spares");
  assert.equal(await page.locator(".badge-print-sheet").count(), 7);
  assert.deepEqual(
    [
      ...new Set(
        await page.locator(".badge-print-root text").allTextContents(),
      ),
    ],
    ["SPONSOR"],
  );
  assert.equal(await page.locator(".badge-print-root image").count(), 7);
  const sponsorSparePdf = await page.pdf({
    path: "/tmp/sdlcai-spare-sponsor-badges-test.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal(
    [...sponsorSparePdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
    7,
  );
  await page
    .getByRole("button", { name: "Preview spare sponsor badge", exact: true })
    .click();
  await page
    .locator(".badge-preview")
    .screenshot({ path: "/tmp/sdlcai-spare-sponsor-badge.png" });
  await page.getByText("Printer settings", { exact: true }).click();
  await page.getByLabel("Repeat each badge for an identical back").check();
  assert.deepEqual(
    await readSummary(),
    expectedSummary,
    "Identical backs need no extra lanyards",
  );
  await printRun("sponsor spares");
  assert.equal(await page.locator(".badge-print-sheet").count(), 14);
  await page
    .getByRole("button", { name: "Preview spare sponsor badge", exact: true })
    .click();
  const axeSource = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  await page.addScriptTag({ content: axeSource });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    assert.deepEqual(
      await page.evaluate(async () =>
        (
          await window.axe.run(document, {
            runOnly: {
              type: "tag",
              values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
            },
            rules: { "target-size": { enabled: false } },
          })
        ).violations.map(({ id }) => id),
      ),
      [],
    );
    await page.locator("[data-spare-badges]").screenshot({
      path: "/tmp/sdlcai-spare-badge-controls-" + viewport.width + ".png",
    });
    await summary.screenshot({
      path: "/tmp/sdlcai-lanyard-summary-" + viewport.width + ".png",
    });
  }
  await sponsorSpareCount.fill("0");
  await sponsorSpareCount.press("Tab");
  await page.evaluate(() => {
    window.__printed = false;
  });
  await page
    .getByRole("button", {
      name: "Print / save PDF — sponsor spares",
      exact: true,
    })
    .click();
  await page
    .getByText("No badges selected for this print run.", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__printed), false);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Spare badge controls fit mobile",
  );
  await spareCount.fill("0");
  await spareCount.press("Tab");
  assert.equal(
    (await readSummary()).total,
    await page.getByRole("article").count(),
  );
  assert.ok((await readSummary()).rows.every((row) => row.spares === 0));
  await summary
    .getByText("Counts include unsaved changes in this tab.", { exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.__printed = false;
  });
  await page
    .getByRole("button", { name: "Print / save PDF — spares", exact: true })
    .click();
  await page
    .getByText("No badges selected for this print run.", { exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => window.__printed), false);
  assert.deepEqual((await send("GET")).attendees, registrationsBeforeSpares);
  assert.deepEqual(errors, []);
  console.log(
    "Badge browser checks passed: lanyard summaries, retired badges, search-independent totals, copy/download and clipboard fallback, independent attendee and sponsor spares, saved quantities, role-specific artwork and print runs, PDF pagination, repeated backs, Unicode, overflow, live records, duplicates, print preferences, source corrections, desktop/mobile layout and accessibility.",
  );
  console.log(JSON.stringify(layouts));
} finally {
  await browser?.close();
  await fixture.dispose();
}
