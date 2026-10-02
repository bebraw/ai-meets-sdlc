import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";
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
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  const adminContext = await browser.newContext({
    extraHTTPHeaders: { authorization: receiptAdmin },
    viewport: { width: 1440, height: 1000 },
  });
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const admin = await adminContext.newPage(),
    staff = await staffContext.newPage();
  const errors = [];
  for (const page of [admin, staff]) {
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
  }
  const outage = "Temporary registration outage";
  const failRoster = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: outage }),
    });
  await admin.route("**/api/admin/attendees", failRoster);
  await admin.goto(`${origin}/admin/attendees/`);
  await admin.getByText(outage, { exact: true }).waitFor();
  const reload = admin.getByRole("button", {
    name: "Reload registrations",
    exact: true,
  });
  assert.equal(await reload.isEnabled(), true);
  assert.equal(
    await admin
      .getByRole("button", { name: "Import registrations" })
      .isDisabled(),
    true,
  );
  await admin.unroute("**/api/admin/attendees", failRoster);
  await reload.click();
  await admin.getByText("Registrations updated.", { exact: true }).waitFor();
  await admin.getByLabel("CSV file (UTF-8, up to 2 MB)").setInputFiles({
    name: "invalid-encoding.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Name,Email,Reference\nZoë,zoe@example.test,ONE",
      "latin1",
    ),
  });
  await admin
    .getByText(
      "CSV is not valid UTF-8. Export or save it as UTF-8 and try again.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await admin.locator("[data-attendee-id]").count(), 0);
  const csv =
    "Name,Email,Company,Reference,Status\nZoë Åström,zoe@example.test,Example Ltd,ABC-123,valid\n李 小明,li@example.test,,ABC-124,cancelled\nAlexandria Verylonglastname,alex@example.test,A Long Company Name,ABC-125,confirmed";
  await admin.getByLabel("CSV file (UTF-8, up to 2 MB)").setInputFiles({
    name: "tito.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await admin
    .getByText(
      "CSV loaded. Review column mappings and preview before importing.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await admin.getByLabel("Ticket code", { exact: true }).inputValue(),
    "3",
  );
  await admin
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await admin
    .getByText("3 registrations · 1 cancelled", { exact: true })
    .waitFor();
  await admin
    .getByRole("button", { name: "Import registrations", exact: true })
    .click();
  await admin
    .getByText(
      "3 registrations imported. Existing arrival records preserved.",
      { exact: true },
    )
    .waitFor();
  const firstMatch = admin.locator("[data-attendee-id]").filter({
    has: admin.getByRole("heading", { name: "Zoë Åström", exact: true }),
  });
  const first = admin.locator(
    `[data-attendee-id="${await firstMatch.getAttribute("data-attendee-id")}"]`,
  );
  await first
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await first
    .getByLabel("Company", { exact: true })
    .fill("First draft company");
  await admin.getByLabel("Find an attendee").fill("李");
  assert.equal(await first.count(), 0);
  await admin.getByText(/1 unfinished edit is hidden/).waitFor();
  assert.equal(
    await admin.evaluate(
      () =>
        !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
    true,
    "A filtered-out draft must still guard navigation",
  );
  const secondId = await admin
    .locator("[data-attendee-id]")
    .getAttribute("data-attendee-id");
  const second = admin.locator(`[data-attendee-id="${secondId}"]`);
  await second
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await second
    .getByLabel("Company", { exact: true })
    .fill("Second draft company");
  await admin.getByLabel("Show registrations").selectOption("arrived");
  assert.equal(
    await admin.getByRole("button", { name: "Save attendee" }).count(),
    0,
  );
  await admin.getByText(/2 unfinished edits are hidden/).waitFor();
  await admin.getByLabel("Show registrations").selectOption("all");
  await admin.getByLabel("Find an attendee").fill("");
  assert.equal(
    await first.getByLabel("Company", { exact: true }).inputValue(),
    "First draft company",
  );
  assert.equal(
    await second.getByLabel("Company", { exact: true }).inputValue(),
    "Second draft company",
  );
  await second
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  assert.equal(
    await first.getByLabel("Company", { exact: true }).inputValue(),
    "First draft company",
  );
  await second
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await second
    .getByLabel("Company", { exact: true })
    .fill("Second draft company");
  await first.getByLabel("Include in badge run").uncheck();
  await first
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await admin.getByText("Attendee saved.", { exact: true }).waitFor();
  assert.equal(
    await second.getByLabel("Company", { exact: true }).inputValue(),
    "Second draft company",
  );
  await second
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await second.getByRole("heading", { name: "李 小明", exact: true }).waitFor();
  await first
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await first
    .getByLabel("Company", { exact: true })
    .fill("Conflicting draft company");
  await admin.evaluate(
    async (id) => {
      const data = await (await fetch("/api/admin/attendees")).json();
      const person = data.attendees.find((person) => person.id === id);
      const response = await fetch("/api/admin/attendees", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-admin-action": "manage-attendees",
        },
        body: JSON.stringify({
          revision: data.revision,
          id,
          attendee: { ...person, company: "Company changed elsewhere" },
        }),
      });
      if (!response.ok)
        throw new Error("Unable to create concurrent attendee edit");
    },
    await first.getAttribute("data-attendee-id"),
  );
  await reload.click();
  await admin.getByText("Registrations updated.", { exact: true }).waitFor();
  await first
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await admin
    .getByText("The attendee list changed. Reload before saving again.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await first.getByLabel("Company", { exact: true }).inputValue(),
    "Conflicting draft company",
  );
  await first
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click();
  await first
    .getByText("Company changed elsewhere · zoe@example.test", { exact: true })
    .waitFor();
  await admin
    .getByLabel("Staff name", { exact: true })
    .fill("Front desk browser");
  await admin
    .getByRole("button", { name: "Create staff link", exact: true })
    .click();
  await admin
    .getByText("Staff access link created.", { exact: true })
    .waitFor();
  const link = await admin
    .getByLabel("Private staff link", { exact: true })
    .inputValue();
  await staff.goto(`${origin}/registration/access/${new URL(link).hash}`);
  assert.equal(new URL(staff.url()).hash, "");
  assert.equal(
    (await staff.getByLabel("Staff access token").inputValue()).length,
    43,
  );
  await staff.route("**/api/registration/attendees", failRoster);
  await staff
    .getByRole("button", { name: "Open registration desk", exact: true })
    .click();
  await staff.waitForURL("**/registration/");
  await staff.getByText(outage, { exact: true }).waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Reload registrations", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(
    await staff
      .getByRole("button", { name: "Sign out", exact: true })
      .isEnabled(),
    true,
  );
  assert.equal(await staff.getByLabel("Find an attendee").isDisabled(), true);
  await staff.getByRole("button", { name: "Sign out", exact: true }).click();
  await staff.waitForURL("**/registration/access/");
  await staff.unroute("**/api/registration/attendees", failRoster);
  await staff.goto(`${origin}/registration/access/${new URL(link).hash}`);
  await staff
    .getByRole("button", { name: "Open registration desk", exact: true })
    .click();
  await staff.waitForURL("**/registration/");
  await staff
    .getByText(
      "Registrations loaded. Changes and arrivals are saved immediately.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await staff.getByRole("button", { name: "Edit attendee" }).count(),
    0,
  );
  assert.equal(
    await staff.getByRole("button", { name: "Import registrations" }).count(),
    0,
  );
  await staff.getByLabel("Search by", { exact: true }).selectOption("ticket");
  await staff.getByLabel("Find an attendee").fill("abc");
  await staff
    .getByText(
      "No registration found. Check the spelling or ask an organizer to verify the ticket.",
      { exact: true },
    )
    .waitFor();
  await staff.getByLabel("Find an attendee").fill("abc-123");
  await staff
    .getByRole("heading", { name: "Zoë Åström", exact: true })
    .waitFor();
  // Hold the polling refresh while exercising an intentionally stale preview.
  await staff.evaluate(() =>
    Object.defineProperty(document, "hidden", {
      value: true,
      configurable: true,
    }),
  );
  await first
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await first
    .getByLabel("Ticket code", { exact: true })
    .fill("REPLACEMENT-123");
  await first
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await admin.getByText("Attendee saved.", { exact: true }).waitFor();
  await staff
    .getByRole("button", { name: "Mark arrived", exact: true })
    .click();
  await staff
    .getByText(
      "The registration list changed. Reload and verify the ticket again before confirming arrival.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Mark arrived", exact: true })
      .count(),
    0,
  );
  await first
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await first.getByLabel("Ticket code", { exact: true }).fill("ABC-123");
  await first
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await admin.getByText("Attendee saved.", { exact: true }).waitFor();
  await staff.evaluate(() => Reflect.deleteProperty(document, "hidden"));
  await staff
    .getByRole("button", { name: "Reload registrations", exact: true })
    .click();
  await staff.getByText("Registrations updated.", { exact: true }).waitFor();
  await staff
    .getByRole("button", { name: "Mark arrived", exact: true })
    .click();
  await staff
    .getByText("Zoë Åström marked as arrived.", { exact: true })
    .waitFor();
  await staff.getByText(/Arrived .*Front desk browser/).waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Mark arrived", exact: true })
      .count(),
    0,
  );
  await staff.getByLabel("Find an attendee").fill("ABC-124");
  await staff.getByText("CANCELLED · Not arrived", { exact: true }).waitFor();
  assert.equal(
    await staff
      .getByRole("button", { name: "Mark arrived", exact: true })
      .count(),
    0,
  );
  await staff.getByLabel("Search by", { exact: true }).selectOption("person");
  await staff.getByLabel("Find an attendee").fill("zoe@example.test");
  await staff
    .getByRole("heading", { name: "Zoë Åström", exact: true })
    .waitFor();
  await admin
    .getByRole("button", { name: "Import registrations", exact: true })
    .click();
  await admin
    .getByText(
      "3 registrations imported. Existing arrival records preserved.",
      { exact: true },
    )
    .waitFor();
  await first.getByText(/Arrived .*Front desk browser/).waitFor();
  await admin
    .getByRole("button", { name: "Undo arrival", exact: true })
    .click();
  await admin
    .getByText("Arrival undone for Zoë Åström.", { exact: true })
    .waitFor();

  const axeSource = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const page of [admin, staff]) {
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
        `${page.url()} must fit ${viewport.width}px`,
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
          nodes: item.nodes.map((node) => node.target),
        })),
      );
      assert.deepEqual(violations, [], `Accessibility at ${page.url()}`);
    }
  }
  await admin.screenshot({
    path: "/private/tmp/sdlcai-attendees-admin.png",
    fullPage: true,
  });
  await staff.setViewportSize({ width: 390, height: 844 });
  await staff.screenshot({
    path: "/private/tmp/sdlcai-registration-mobile.png",
    fullPage: true,
  });
  await admin.goto(`${origin}/admin/badges/`);
  await admin
    .getByText(
      "Badge studio ready. People are loaded from attendee and team records.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await admin
      .getByRole("article")
      .filter({ hasText: "attendee · attendees" })
      .count(),
    1,
  );
  assert.equal(await admin.getByLabel("CSV file").count(), 0);
  await admin
    .getByRole("button", { name: "Save print settings", exact: true })
    .click();
  await admin
    .getByText("Print settings and badge text saved.", { exact: true })
    .waitFor();
  await admin.reload();
  await admin
    .getByText(
      "Badge studio ready. People are loaded from attendee and team records.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await admin
      .getByRole("article")
      .filter({ hasText: "attendee · attendees" })
      .count(),
    1,
  );
  await admin.goto(`${origin}/admin/attendees/`);
  await admin
    .getByText(
      "Registrations loaded. Changes and arrivals are saved immediately.",
      { exact: true },
    )
    .waitFor();
  await staff.getByRole("button", { name: "Sign out", exact: true }).click();
  await staff.waitForURL("**/registration/access/");
  await staff.goto(`${origin}/registration/access/${new URL(link).hash}`);
  await staff
    .getByRole("button", { name: "Open registration desk", exact: true })
    .click();
  await staff.waitForURL("**/registration/");
  await staff
    .getByText(
      "Registrations loaded. Changes and arrivals are saved immediately.",
      { exact: true },
    )
    .waitFor();
  await admin
    .getByRole("button", { name: "Revoke access", exact: true })
    .click();
  await admin
    .getByText("Access revoked for Front desk browser on every device.", {
      exact: true,
    })
    .waitFor();
  await staff
    .getByRole("button", { name: "Reload registrations", exact: true })
    .click();
  await staff.waitForURL("**/registration/access/");
  await staff.goto(`${origin}/registration/access/${new URL(link).hash}`);
  await staff
    .getByRole("button", { name: "Open registration desk", exact: true })
    .click();
  await staff
    .getByText(
      "This access link is invalid or has been revoked. Ask an organizer for a new link.",
      { exact: true },
    )
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Attendee browser check passed: load recovery, preserved edit drafts, concurrent corrections, CSV import, source refresh, scoped staff access, exact ticket lookup, arrivals, cancellation, undo, badge seeding, sign-out/reuse, revocation, mobile layout and accessibility.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
