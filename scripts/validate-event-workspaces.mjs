import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createEventFixture } from "../test/helpers/event-fixture.mjs";

const fixture = await createEventFixture();
const origin = `http://127.0.0.1:${fixture.worker.port}`;
try {
  await mkdir(".cache/event-workspaces-review", { recursive: true });
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ]) {
    await fixture.env.INTERESTS.prepare("DELETE FROM volunteers").run();
    await fixture.eventDb.prepare("DELETE FROM volunteers").run();
    let executablePath;
    if (name === "chromium") {
      for (const path of [
        process.env.LAYOUT_BROWSER_PATH,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        chromium.executablePath(),
      ].filter(Boolean)) {
        try {
          await access(path);
          executablePath = path;
          break;
        } catch {}
      }
    }
    const browser = await engine.launch({
      ...(executablePath ? { executablePath } : {}),
    });
    try {
      const context = await browser.newContext({
        extraHTTPHeaders: {
          authorization: `Basic ${Buffer.from("events-admin:events-password").toString("base64")}`,
        },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin + "/admin/");
      assert.equal(await page.locator("h1").textContent(), "Admin desk");
      await page
        .getByLabel("Event workspace", { exact: true })
        .selectOption("/events/2026/admin/");
      await page.waitForURL("**/events/2026/admin/");
      for (const width of [375, 768, 1024, 1440]) {
        // A viewport change during a cross-document transition rejects its ready
        // promise in Chromium. Start each responsive check on a blank page.
        const responsivePage = await context.newPage();
        responsivePage.on("pageerror", (error) => errors.push(error.message));
        await responsivePage.setViewportSize({ width, height: 1000 });
        await responsivePage.goto(origin + "/events/2026/admin/");
        await responsivePage.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        assert.equal(await responsivePage.locator("h1").count(), 1);
        const spacing = await responsivePage
          .locator("h1")
          .evaluate((heading) => {
            const title = heading.getBoundingClientRect();
            const description =
              heading.parentElement.nextElementSibling.getBoundingClientRect();
            return {
              stacked: description.top >= title.bottom,
              gap: description.left - title.right,
            };
          });
        assert.ok(
          width < 1024 ? spacing.stacked : spacing.gap >= 60,
          `${name}: heading and description are separated at ${width}px`,
        );
        assert.ok(
          await responsivePage.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${name}: event navigation fits ${width}px`,
        );
        await responsivePage.screenshot({
          path: `.cache/event-workspaces-review/${name}-${width}.png`,
          fullPage: false,
          animations: "disabled",
        });
        await responsivePage.close();
      }
      await page.goto(origin + "/events/2026/admin/volunteers/");
      await page.locator("[data-volunteer-fields]").waitFor();
      await page
        .getByLabel("Name", { exact: true })
        .fill(`${name} 2026 volunteer`);
      await page
        .getByLabel("Email", { exact: true })
        .fill(`${name}@example.test`);
      await page.locator("[data-volunteer-save]").click();
      await page
        .locator("[data-volunteer-list]")
        .getByText(`${name} 2026 volunteer`, { exact: true })
        .waitFor();
      const future = await context.newPage();
      future.on("pageerror", (error) => errors.push(error.message));
      await future.goto(origin + "/events/fixture-b/admin/volunteers/");
      await future.waitForFunction(
        () =>
          document
            .querySelector("[data-volunteer-list]")
            ?.getAttribute("aria-busy") === "false",
      );
      assert.equal(
        await future.locator("[data-volunteer-list] article").count(),
        0,
      );
      await future
        .getByLabel("Name", { exact: true })
        .fill(`${name} fixture volunteer`);
      await future
        .getByLabel("Email", { exact: true })
        .fill(`${name}-fixture@example.test`);
      await future.locator("[data-volunteer-save]").click();
      await future
        .locator("[data-volunteer-list]")
        .getByText(`${name} fixture volunteer`, { exact: true })
        .waitFor();
      await page.reload();
      await page
        .locator("[data-volunteer-list]")
        .getByText(`${name} 2026 volunteer`, { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByText(`${name} fixture volunteer`, { exact: true })
          .count(),
        0,
      );

      await page.goto(origin + "/events/2026/admin/content-inventory/");
      await page.locator("[data-inventory-pick]").first().check();
      await page
        .getByLabel("Event workspace", { exact: true })
        .selectOption("/events/fixture-b/admin/");
      await page.waitForURL("**/events/fixture-b/admin/");
      assert.equal(
        await page.getByRole("link", { name: /Content inventory/ }).count(),
        0,
      );
      const sharedRequest = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === "/api/admin/newsletter",
      );
      await page
        .getByRole("link", { name: "SDLCAI news", exact: true })
        .click();
      await page.waitForURL("**/admin/newsletter/");
      await sharedRequest;
      assert.equal(
        await page.locator("[data-admin-scope-label]").textContent(),
        "Shared SDLCAI",
      );
      await page
        .getByLabel("Event workspace", { exact: true })
        .selectOption("/events/2026/admin/");
      await page.waitForURL("**/events/2026/admin/");
      await page.goto(origin + "/events/2026/admin/content-inventory/");
      assert.equal(
        await page.locator("[data-inventory-pick]:checked").count(),
        1,
      );
      assert.deepEqual(errors, []);
      await context.close();
    } finally {
      await browser.close();
    }
  }
  console.log(
    "Event workspaces passed in Chromium and WebKit: event selection, isolated writes in simultaneous tabs, shared news, retained shortlists and responsive navigation.",
  );
} finally {
  await fixture.dispose();
}
