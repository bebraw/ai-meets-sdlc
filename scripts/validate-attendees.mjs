import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  createReceiptFixture,
  receiptAdmin,
} from "../test/helpers/receipt-fixture.mjs";

const fixture = await createReceiptFixture({
  vars: {
    POSTER_PROPOSAL_DEADLINE: "2099-09-27T20:59:59Z",
    SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
    TURNSTILE_SECRET_KEY: "",
  },
});
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
  await adminContext.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin,
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
    'Name;Email;Company;Reference;Status;Diet\nZoë Åström;zoe@example.test;Example Ltd;ABC-123;valid;"Vegan and gluten free\nplease"\n李 小明;li@example.test;;ABC-124;cancelled;Dairy free\nAlexandria Verylonglastname;alex@example.test;A Long Company Name;ABC-125;confirmed;Allergic to raw apple';
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
  assert.equal(
    await admin
      .getByLabel("Dietary requirements column", { exact: true })
      .inputValue(),
    "5",
  );
  await admin.getByText(/Detected semicolon delimiter/).waitFor();
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
  const catering = admin.locator("[data-attendee-catering]");
  const cateringCount = (label) =>
    catering
      .locator("dl")
      .first()
      .locator("div")
      .filter({ has: admin.getByText(label, { exact: true }) })
      .locator("dd")
      .textContent();
  assert.equal(await cateringCount("Active registrations"), "2");
  const sourceResponse = await adminContext.request.get(
    `${origin}/api/admin/attendees/catering`,
  );
  assert.equal(sourceResponse.status(), 200);
  const sourceData = await sourceResponse.json();
  const speakerHeadcount = sourceData.sources.filter(
    (source) => source.kind === "speaker",
  ).length;
  assert.equal(
    await cateringCount("Catering headcount"),
    String(speakerHeadcount + 2),
  );
  assert.equal(await cateringCount("Requirements reported"), "2");
  assert.equal(await catering.locator('[data-diet-review="true"]').count(), 1);
  await catering
    .getByRole("button", { name: "Copy catering summary", exact: true })
    .click();
  await catering
    .getByText("Catering summary copied.", { exact: true })
    .waitFor();
  const copiedReport = await admin.evaluate(() =>
    navigator.clipboard.readText(),
  );
  assert.match(copiedReport, /Active registrations: 2/);
  assert.match(copiedReport, /1 x Vegan and gluten free\nplease/);
  assert.match(copiedReport, /1 x Allergic to raw apple/);
  assert.doesNotMatch(
    copiedReport,
    /Dairy free|zoe@example|Zoë Åström|ABC-123/,
  );
  await admin.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await catering
    .getByRole("button", { name: "Copy catering summary", exact: true })
    .click();
  const copyFallback = catering.getByLabel(
    "Catering summary (select and copy)",
    { exact: true },
  );
  await copyFallback.waitFor({ state: "visible" });
  assert.match(await copyFallback.inputValue(), /Active registrations: 2/);
  await admin.evaluate(() => Reflect.deleteProperty(navigator, "clipboard"));
  const downloadPromise = admin.waitForEvent("download");
  await catering
    .getByRole("button", { name: "Download catering summary", exact: true })
    .click();
  const reportDownload = await downloadPromise;
  assert.equal(
    reportDownload.suggestedFilename(),
    "sdlcai-2026-attendee-catering-summary.txt",
  );
  assert.match(
    await readFile(await reportDownload.path(), "utf8"),
    /Allergic to raw apple/,
  );
  await catering
    .getByRole("button", { name: "Copy catering summary", exact: true })
    .click();
  await catering
    .getByText("Catering summary copied.", { exact: true })
    .waitFor();
  assert.equal(await copyFallback.isVisible(), false);
  const firstMatch = admin.locator("[data-attendee-id]").filter({
    has: admin.getByRole("heading", { name: "Zoë Åström", exact: true }),
  });
  const first = admin.locator(
    `[data-attendee-id="${await firstMatch.getAttribute("data-attendee-id")}"]`,
  );
  await first
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  assert.equal(
    await first
      .getByLabel("Dietary requirements (original response)", { exact: true })
      .inputValue(),
    "Vegan and gluten free\nplease",
  );
  await first
    .getByLabel("Company", { exact: true })
    .fill("First draft company");
  await admin.getByLabel("Find an attendee").fill("李");
  assert.equal(
    await cateringCount("Active registrations"),
    "2",
    "Catering counts must ignore list filters",
  );
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
    (
      await (
        await adminContext.request.get(`${origin}/api/admin/attendees`)
      ).json()
    ).attendees.find((person) => person.email === "zoe@example.test").diet,
    "Vegan and gluten free\nplease",
    "Unrelated edits preserve multiline diet responses",
  );
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
  assert.equal(await staff.locator("[data-attendee-catering]").count(), 0);
  const deskData = await (
    await staffContext.request.get(`${origin}/api/registration/attendees`)
  ).json();
  assert.ok(
    deskData.attendees.every((person) => !Object.hasOwn(person, "diet")),
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

  // A dinner alias is linked to an organizer without adding a registration row.
  const dinnerForm = new URLSearchParams();
  for (const [key, value] of Object.entries({
    name: "Organizer browser alias",
    attendance: "attending",
    meal_preference: "vegetarian",
    food_requirements: "Gluten free",
    cross_contamination: "no",
    consent: "yes",
  }))
    dinnerForm.set(key, value);
  const guestSave = await fixture.worker.fetch(
    "https://sdlcai.org/api/admin/speaker-dinner/guests",
    {
      method: "POST",
      headers: {
        authorization: receiptAdmin,
        origin: "https://sdlcai.org",
        "x-admin-action": "add-dinner-guest",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: dinnerForm.toString(),
    },
  );
  assert.equal(guestSave.status, 200);
  await reload.click();
  await admin.getByText("Registrations updated.", { exact: true }).waitFor();
  await catering.getByText(/1 catering source needs mapping/).waitFor();
  await catering.locator("summary").click();
  const mapping = catering.getByLabel(
    "Catering mapping for Organizer browser alias",
    { exact: true },
  );
  const organizerId = sourceData.organizers[0].id;
  await mapping.selectOption(`organizer:${organizerId}`);
  assert.equal(
    await catering
      .getByRole("button", { name: "Copy catering summary", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await admin.evaluate(
      () =>
        !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
    true,
  );
  await catering
    .getByRole("button", { name: "Save catering mappings", exact: true })
    .click();
  await catering
    .getByText("Catering mappings saved.", { exact: true })
    .waitFor();
  assert.equal(
    await cateringCount("Catering headcount"),
    String(speakerHeadcount + 3),
  );
  await admin.reload();
  await admin.getByText(/Registrations loaded/).waitFor();
  await catering.locator("summary").click();
  assert.equal(await mapping.inputValue(), `organizer:${organizerId}`);
  assert.equal(
    await cateringCount("Catering headcount"),
    String(speakerHeadcount + 3),
  );
  await catering.locator("summary").click();
  const failCatering = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary catering outage" }),
    });
  await admin.route("**/api/admin/attendees/catering", failCatering);
  await reload.click();
  await catering
    .getByText("Temporary catering outage", { exact: true })
    .waitFor();
  assert.equal(
    await catering
      .getByRole("button", { name: "Download catering summary", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await admin.locator("[data-attendee-id]").count(), 3);
  await admin.unroute("**/api/admin/attendees/catering", failCatering);
  await reload.click();
  await admin.getByText("Registrations updated.", { exact: true }).waitFor();

  const axeSource = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  await catering.locator("summary").click();
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
  await catering
    .locator("[data-catering-source]")
    .filter({
      has: admin.getByRole("heading", {
        name: "Organizer browser alias",
        exact: true,
      }),
    })
    .screenshot({ path: "/private/tmp/sdlcai-catering-organizer-mapping.png" });
  await catering.locator("summary").click();
  await admin.screenshot({
    path: "/private/tmp/sdlcai-attendees-admin.png",
    fullPage: true,
  });
  await catering.screenshot({
    path: "/private/tmp/sdlcai-attendee-catering.png",
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  await catering.screenshot({
    path: "/private/tmp/sdlcai-attendee-catering-mobile.png",
  });
  await admin.setViewportSize({ width: 1440, height: 1000 });
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
  const webropolCsv = [
    ";Tapahtuman nimi;SDLCAI 2026;;;;;;;;;",
    "#;Ilm.aika;Etunimi;Sukunimi;Sähköposti;Matkapuhelin;;Tila;-;;;",
    "-;-;-;-;-;-;-;-;Etunimi;Sukunimi;Sähköposti;Ruokarajoitteet",
    "1;;Booker;Name;booker@example.test;;;Ilmoittautunut;Actual;Webropol;actual@example.test;Laktoositon",
  ].join("\n");
  await admin.getByLabel("CSV file (UTF-8, up to 2 MB)").setInputFiles({
    name: "webropol.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(webropolCsv),
  });
  await admin
    .getByText(
      "CSV loaded. Review column mappings and preview before importing.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await admin.getByLabel("Registration source", { exact: true }).inputValue(),
    "webropol",
  );
  assert.equal(
    await admin
      .getByLabel("Dietary requirements column", { exact: true })
      .inputValue(),
    "11",
  );
  assert.equal(
    await admin.getByLabel("Attendee email", { exact: true }).inputValue(),
    "10",
  );
  await admin
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await admin
    .getByText("1 registrations · 0 cancelled", { exact: true })
    .waitFor();
  await admin
    .getByRole("button", { name: "Import registrations", exact: true })
    .click();
  await admin
    .getByText(
      "1 registrations imported. Existing arrival records preserved.",
      { exact: true },
    )
    .waitFor();
  await admin
    .getByRole("heading", { name: "Actual Webropol", exact: true })
    .waitFor();
  assert.equal(await cateringCount("Active registrations"), "3");
  await admin
    .getByLabel("Import attendee type", { exact: true })
    .selectOption("sponsor");
  await admin.getByLabel("CSV file (UTF-8, up to 2 MB)").setInputFiles({
    name: "tito-sponsors.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Ticket Full Name,Ticket Email,Ticket Company Name,Ticket Reference,Void Status,What kind of food restrictions do you have?\n,,,SP-UNASSIGNED,,\nSponsor Zoë,sponsor@example.test,Sponsor Company,SP-1,,Vegan and gluten free",
    ),
  });
  await admin
    .getByText(
      "CSV loaded. Review column mappings and preview before importing.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await admin.getByLabel("Registration source", { exact: true }).inputValue(),
    "tito",
  );
  await admin
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await admin
    .getByText(/Sponsor Zoë · sponsor@example.test · SP-1 · sponsor · active/)
    .waitFor();
  const skippedTicketNote =
    "1 unassigned Tito ticket skipped. Assign attendee details in Tito and re-import.";
  await admin
    .getByText("1 registrations · 0 cancelled", { exact: true })
    .waitFor();
  await admin.getByText(skippedTicketNote, { exact: true }).waitFor();
  await admin
    .getByRole("button", { name: "Import registrations", exact: true })
    .click();
  await admin
    .getByText(
      `1 registrations imported. Existing arrival records preserved. ${skippedTicketNote}`,
      { exact: true },
    )
    .waitFor();
  assert.equal(await cateringCount("Active registrations"), "4");
  await admin
    .getByLabel("Registration type", { exact: true })
    .selectOption("sponsor");
  assert.equal(await admin.locator("[data-attendee-id]").count(), 1);
  const sponsorCard = admin.locator("[data-attendee-id]");
  const sponsorId = await sponsorCard.getAttribute("data-attendee-id");
  await sponsorCard
    .getByText("SPONSOR · TITO · Ticket SP-1", { exact: true })
    .waitFor();
  await sponsorCard
    .getByText("Diet: Vegan and gluten free", { exact: true })
    .waitFor();
  assert.equal(
    await cateringCount("Active registrations"),
    "4",
    "Type filters do not change catering totals",
  );
  await sponsorCard
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  assert.equal(
    await sponsorCard.getByLabel("Attendee type", { exact: true }).inputValue(),
    "sponsor",
  );
  await sponsorCard
    .getByLabel("Attendee type", { exact: true })
    .selectOption("attendee");
  await sponsorCard
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await admin.getByText("Attendee saved.", { exact: true }).waitFor();
  assert.equal(await admin.locator("[data-attendee-id]").count(), 0);
  await admin
    .getByLabel("Registration type", { exact: true })
    .selectOption("all");
  const restoredSponsor = admin.locator(`[data-attendee-id="${sponsorId}"]`);
  await restoredSponsor
    .getByRole("button", { name: "Edit attendee", exact: true })
    .click();
  await restoredSponsor
    .getByLabel("Attendee type", { exact: true })
    .selectOption("sponsor");
  await restoredSponsor
    .getByRole("button", { name: "Save attendee", exact: true })
    .click();
  await restoredSponsor
    .getByText("SPONSOR · TITO · Ticket SP-1", { exact: true })
    .waitFor();
  await admin.goto(`${origin}/admin/badges/`);
  await admin
    .getByText(
      "Badge studio ready. People are loaded from attendee and team records.",
      { exact: true },
    )
    .waitFor();
  await admin.getByLabel("Find a badge", { exact: true }).fill("sponsor");
  const sponsorBadge = admin
    .getByRole("article")
    .filter({ hasText: "sponsor · attendees" });
  assert.equal(await sponsorBadge.count(), 1);
  await sponsorBadge
    .getByRole("button", { name: "Preview", exact: true })
    .click();
  await admin
    .locator(".badge-preview")
    .screenshot({ path: "/private/tmp/sdlcai-sponsor-badge.png" });
  await admin.evaluate(() => {
    window.print = () => {
      window.__sponsorPrinted = true;
    };
  });
  await admin
    .getByRole("button", { name: "Print / save PDF — sponsor", exact: true })
    .click();
  await admin.waitForFunction(() => window.__sponsorPrinted);
  assert.equal(await admin.locator(".badge-print-sheet").count(), 1);
  const printedBadge = admin.locator(".badge-print-sheet svg");
  assert.equal(
    await printedBadge.locator("rect").getAttribute("fill"),
    "#64c4bc",
  );
  assert.ok(
    (await printedBadge.locator("text").allTextContents()).includes("SPONSOR"),
  );
  const sponsorPdf = await admin.pdf({
    path: "/private/tmp/sdlcai-sponsor-badge.pdf",
    preferCSSPageSize: true,
    printBackground: true,
  });
  assert.equal(
    [...sponsorPdf.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
    1,
  );
  // Canonical poster and volunteer entries need no CSV import.
  const posterForm = {
    name: "Poster Browser Presenter",
    email: "poster-browser@example.test",
    organization: "Poster Lab",
    title: "Browser-tested poster",
    abstract:
      "This poster covers attendee registration, safe event check-in, and dietary requirements provided through dinner registration.",
    terms: "yes",
    consent: "yes",
  };
  const proposalResponse = await adminContext.request.post(
    `${origin}/api/poster-proposals`,
    { form: posterForm },
  );
  assert.equal(proposalResponse.status(), 201, await proposalResponse.text());
  const proposalId = (
    await fixture.runSql(
      "SELECT id FROM poster_proposals ORDER BY id DESC LIMIT 1",
    )
  )[0].id;
  await fixture.runSql(
    `UPDATE poster_proposals SET status = 'accepted' WHERE id = ${proposalId}`,
  );
  const volunteerResponse = await adminContext.request.post(
    `${origin}/api/admin/volunteers`,
    {
      headers: { origin, "x-admin-action": "manage-volunteers" },
      form: {
        name: "Browser Volunteer",
        email: "browser-volunteer@example.test",
        task: "Private desk task",
        badge: "false",
      },
    },
  );
  assert.equal(volunteerResponse.status(), 201, await volunteerResponse.text());
  const canonicalVolunteer = (await volunteerResponse.json()).volunteer;
  const dinnerResponse = await adminContext.request.post(
    `${origin}/api/admin/speaker-dinner/guests`,
    {
      headers: { origin, "x-admin-action": "add-dinner-guest" },
      form: {
        name: posterForm.name,
        attendance: "attending",
        meal_preference: "vegan",
        food_requirements: "Sesame allergy",
        cross_contamination: "yes",
        consent: "yes",
      },
    },
  );
  assert.equal(dinnerResponse.status(), 200, await dinnerResponse.text());
  await admin.goto(`${origin}/admin/attendees/`);
  await admin
    .getByText(
      "Registrations loaded. Changes and arrivals are saved immediately.",
      { exact: true },
    )
    .waitFor();
  const posterCard = admin.locator(`[data-attendee-id="poster-${proposalId}"]`);
  const volunteerCard = admin.locator(
    `[data-attendee-id="volunteer-${canonicalVolunteer.id}"]`,
  );
  await posterCard
    .getByText("ATTENDEE · POSTER · No ticket code", { exact: true })
    .waitFor();
  await posterCard
    .getByText(/Diet: vegan; Sesame allergy; Cross-contamination/)
    .waitFor();
  assert.equal(
    await posterCard
      .getByRole("button", { name: "Edit attendee", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await posterCard
      .getByRole("link", { name: "Manage poster proposal", exact: true })
      .count(),
    1,
  );
  await volunteerCard
    .getByText("ORGANIZER · VOLUNTEER · No ticket code", { exact: true })
    .waitFor();
  await admin
    .getByLabel("Registration type", { exact: true })
    .selectOption("organizer");
  assert.equal(await admin.locator("[data-attendee-id]").count(), 1);
  await volunteerCard
    .getByRole("button", { name: "Mark arrived", exact: true })
    .click();
  await volunteerCard.getByText(/Arrived/).waitFor();
  await admin
    .getByLabel("Registration type", { exact: true })
    .selectOption("attendee");
  await posterCard
    .getByRole("button", { name: "Mark arrived", exact: true })
    .click();
  await posterCard.getByText(/Arrived/).waitFor();
  const grantResponse = await adminContext.request.post(
    `${origin}/api/admin/attendees/access`,
    {
      headers: { origin, "x-admin-action": "manage-attendees" },
      data: { action: "create", label: "Canonical source desk" },
    },
  );
  const canonicalGrant = (await grantResponse.json()).grants.find(
    (grant) => grant.label === "Canonical source desk",
  );
  await staff.goto(
    `${origin}/registration/access/${new URL(canonicalGrant.link).hash}`,
  );
  await staff
    .getByRole("button", { name: "Open registration desk", exact: true })
    .click();
  await staff.waitForURL("**/registration/");
  await staff
    .getByLabel("Registration type", { exact: true })
    .selectOption("organizer");
  await staff
    .locator(`[data-attendee-id="volunteer-${canonicalVolunteer.id}"]`)
    .getByText(/Arrived/)
    .waitFor();
  assert.equal(
    await staff.getByText(/Sesame allergy|Private desk task|Diet:/).count(),
    0,
  );
  await staff.addScriptTag({ content: axeSource });
  assert.deepEqual(
    await staff.evaluate(async () =>
      (
        await window.axe.run(document, {
          runOnly: {
            type: "tag",
            values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
          },
          rules: { "target-size": { enabled: false } },
        })
      ).violations.map((item) => item.id),
    ),
    [],
  );
  await staff.screenshot({
    path: "/private/tmp/sdlcai-canonical-registration-mobile.png",
    fullPage: true,
  });
  await admin
    .getByLabel("Registration type", { exact: true })
    .selectOption("all");
  await catering.locator("summary").click();
  await catering
    .locator(`[data-catering-source="poster:${proposalId}"]`)
    .getByText(/Diet from dinner: vegan; Sesame allergy/)
    .waitFor();
  await admin.screenshot({
    path: "/private/tmp/sdlcai-canonical-attendees.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Attendee browser check passed: canonical poster and volunteer registration/check-in, organizer roles, poster dinner restrictions, Tito/Webropol diet imports, separate sponsor imports, type filtering/editing, sponsor badges/PDF output, catering groups, copy/download, multiline diet edits, filter-independent totals, organizer-only diets, load recovery, preserved edit drafts, concurrent corrections, source refresh, scoped staff access, exact ticket lookup, arrivals, cancellation, undo, badge seeding, sign-out/reuse, revocation, mobile layout and accessibility.",
  );
} finally {
  await browser?.close();
  await fixture.dispose();
}
