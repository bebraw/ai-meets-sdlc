import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright";
import { createWorkerFixture } from "../test/helpers/worker-fixture.mjs";
import { handleFeedbackRequest } from "../worker/feedback.ts";
import { closeBrowserServer } from "./layout-browser.mjs";

const vars = {
  ADMIN_USERNAME: "feedback-browser-admin",
  ADMIN_PASSWORD: "local-browser-password",
  EMAIL_ENCRYPTION_KEY: "local-browser-feedback-key",
  TURNSTILE_SITE_KEY: "local-browser-site-key",
  TURNSTILE_SECRET_KEY: "local-browser-secret",
  TURNSTILE_HOSTNAMES: "sdlcai.org",
};
const fixture = await createWorkerFixture({ vars });
const origin = `http://127.0.0.1:${fixture.worker.port}`;
const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
await mkdir(".cache/feedback-review", { recursive: true });
let server;
const originalFetch = globalThis.fetch;
try {
  const anon = await fixture.worker.fetch(origin + "/api/admin/feedback");
  assert.equal(anon.status, 401);
  await anon.text();
  const login = await fixture.worker.fetch(origin + "/admin/feedback/", {
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  await login.text();
  // Only the external challenge provider is simulated. Submissions use the
  // actual handler and isolated D1; viewing, deleting and admin reads use the
  // compiled Worker over HTTP. No live data or email is involved.
  globalThis.fetch = (url, init) =>
    String(url) === "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      ? Promise.resolve(
          Response.json({
            success: true,
            action: "visitor-feedback",
            hostname: "sdlcai.org",
          }),
        )
      : originalFetch(url, init);
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
  const engines = [["chromium", chromium, { executablePath }]];
  try {
    await access(webkit.executablePath());
    engines.push(["webkit", webkit, {}]);
  } catch {}
  for (const [name, engine, options] of engines) {
    server = await engine.launchServer(options);
    const browser = await engine.connect(server.wsEndpoint());
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route(
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
      (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: "const f=document.querySelector('[data-feedback-form]');const i=document.createElement('input');i.type='hidden';i.name='cf-turnstile-response';i.value='local-test-token';f.appendChild(i);window.turnstile={reset(){}};window.onFeedbackTurnstileSuccess();",
        }),
    );
    await context.route("**/api/feedback", async (route) => {
      const r = route.request();
      const response = await handleFeedbackRequest(
        new Request(r.url(), {
          method: r.method(),
          headers: r.headers(),
          body: r.postDataBuffer(),
        }),
        fixture.env,
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(origin + "/feedback/");
      await page.getByRole("button", { name: "Send feedback" }).waitFor();
      assert.equal(await page.locator("fieldset").count(), 11);
      for (const theme of ["light", "dark"]) {
        if ((await page.locator("html").getAttribute("data-theme")) !== theme)
          await page.locator("[data-theme-toggle]").click();
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        await settleTheme(page);
        await checkPage(`form-${name}-${width}-${theme}`);
      }
    }
    await page.goto(origin + "/feedback/");
    for (const id of [
      "overall",
      "academic",
      "industry",
      "organization",
      "networking",
    ])
      await page.locator(`input[name="${id}"][value="4"]`).check();
    await page.locator('input[name="mix"]').first().check();
    await page.locator('input[name="valuable"]').first().check();
    await page.locator('input[name="return"]').first().check();
    await page
      .getByLabel("What was the best part of SDLCAI 2026?", { exact: true })
      .fill("Panels were excellent. <img src=x onerror=alert('xss')>");
    await page.locator('input[name="consent"]').check();
    await page.getByRole("button", { name: "Send feedback" }).click();
    await page.locator("[data-feedback-thanks]").waitFor({ state: "visible" });
    const privateLink = await page.locator("[data-feedback-link]").inputValue();
    assert.match(privateLink, /\/feedback\/response\/#code=[a-f0-9]{64}$/u);
    await checkPage(`thanks-${name}`);
    const responsePage = await context.newPage();
    await responsePage.goto(privateLink);
    await responsePage
      .locator("[data-feedback-response-body]")
      .waitFor({ state: "visible" });
    assert.match(
      await responsePage
        .locator("[data-feedback-response-answers]")
        .innerText(),
      /<img src=x/u,
    );
    assert.equal(
      await responsePage
        .locator("[data-feedback-response-answers] img")
        .count(),
      0,
    );
    const admin = await browser.newContext({
      extraHTTPHeaders: {
        authorization: `Basic ${Buffer.from(`${vars.ADMIN_USERNAME}:${vars.ADMIN_PASSWORD}`).toString("base64")}`,
      },
    });
    const adminPage = await admin.newPage();
    await adminPage.goto(origin + "/admin/feedback/");
    await adminPage
      .getByText(
        "1 response in the totals. 1 individual response within retention.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await adminPage.getByText("4.0 / 5", { exact: true }).count(),
      5,
    );
    await adminPage.locator("[data-feedback-items] summary").click();
    assert.match(
      await adminPage.locator("[data-feedback-items]").innerText(),
      /<img src=x/u,
    );
    assert.equal(
      await adminPage.locator("[data-feedback-items] img").count(),
      0,
    );
    for (const width of [320, 1440]) {
      await adminPage.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        if (
          (await adminPage.locator("html").getAttribute("data-theme")) !== theme
        )
          await adminPage.locator("[data-theme-toggle]").click();
        await settleTheme(adminPage);
        assert.equal(
          await adminPage.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const violations = await audit(adminPage);
        assert.deepEqual(violations, [], JSON.stringify(violations));
        await adminPage.screenshot({
          path: `.cache/feedback-review/admin-${name}-${width}-${theme}.png`,
          fullPage: true,
        });
      }
    }
    await responsePage.getByRole("checkbox").check();
    await responsePage
      .getByRole("button", { name: "Delete my response" })
      .click();
    await responsePage
      .getByText(
        "Your response has been deleted and removed from the totals. Thank you for taking part.",
        { exact: true },
      )
      .waitFor();
    assert.equal(new URL(responsePage.url()).hash, "");
    await adminPage.getByRole("button", { name: "Refresh results" }).click();
    await adminPage
      .getByText(
        "0 responses in the totals. 0 individual responses within retention.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await adminPage.locator("[data-feedback-totals] section").count(),
      8,
    );
    await adminPage.screenshot({
      path: `.cache/feedback-review/admin-${name}.png`,
      fullPage: true,
    });
    const adminAxe = await audit(adminPage);
    assert.deepEqual(adminAxe, [], JSON.stringify(adminAxe));
    await adminPage.waitForLoadState("networkidle");
    await responsePage.waitForLoadState("networkidle");
    await page.waitForLoadState("networkidle");
    assert.deepEqual(errors, []);
    await admin.close();
    await context.close();
    await browser.close();
    await closeBrowserServer(server);
    server = null;
    console.log(
      `Feedback public form, private deletion and admin results passed in ${name}.`,
    );

    async function checkPage(label) {
      await page.evaluate(() => document.fonts.ready);
      const overflows = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            "main fieldset, main input:not([type=hidden]), main textarea, main section",
          ),
        )
          .filter((el) => {
            if (!el.getClientRects().length) return false;
            const box = el.getBoundingClientRect();
            return box.left < -1 || box.right > innerWidth + 1;
          })
          .map((el) => el.outerHTML.slice(0, 100)),
      );
      assert.deepEqual(overflows, [], `${label} overflow`);
      const violations = await audit(page);
      assert.deepEqual(
        violations,
        [],
        `${label}: ${JSON.stringify(violations)}`,
      );
      await page.screenshot({
        path: `.cache/feedback-review/${label}.png`,
        fullPage: true,
      });
    }
  }
} finally {
  globalThis.fetch = originalFetch;
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}

async function audit(page) {
  await page.addScriptTag({ content: axe });
  return page.evaluate(async () =>
    (
      await window.axe.run(document.querySelector("main"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
      })
    ).violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((n) => n.target),
    })),
  );
}

async function settleTheme(page) {
  // Theme colors transition on navigation links. Audit the finished colors,
  // rather than an intermediate frame where foreground/background differ.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}
