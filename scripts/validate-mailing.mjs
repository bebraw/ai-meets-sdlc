import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { closeBrowserServer } from "./layout-browser.mjs";
import { createWorkerFixture } from "../test/helpers/worker-fixture.mjs";
import { encryptText } from "../worker/form-utils.ts";
import { mailFingerprint, signMailToken } from "../worker/mail-utils.ts";

const vars = {
  ADMIN_USERNAME: "browser-mail-admin",
  ADMIN_PASSWORD: "local-browser-password",
  EMAIL_ENCRYPTION_KEY: "local-browser-mail-key",
  NEWSLETTER_ENABLED: "true",
  TURNSTILE_SITE_KEY: "local-browser-site-key",
  TURNSTILE_SECRET_KEY: "local-browser-secret",
  PUBLIC_SITE_ORIGIN: "https://sdlcai.org",
};
const fixture = await createWorkerFixture({ vars });
let server;
try {
  const encrypted = await encryptText(
    JSON.stringify([
      {
        id: "local-attendee",
        source: "tito",
        sourceKey: "ticket:local",
        name: "Local attendee",
        email: "local@example.test",
        company: "",
        ticketCode: "local",
        status: "active",
        badge: true,
        type: "attendee",
      },
    ]),
    vars.EMAIL_ENCRYPTION_KEY,
  );
  await fixture.env.INTERESTS.prepare(
    "UPDATE attendee_roster SET ciphertext = ?, iv = ? WHERE id = 1",
  )
    .bind(encrypted.ciphertext, encrypted.iv)
    .run();
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
  server = await chromium.launchServer({ executablePath });
  const browser = await chromium.connect(server.wsEndpoint());
  const context = await browser.newContext({
    extraHTTPHeaders: {
      authorization: `Basic ${Buffer.from(`${vars.ADMIN_USERNAME}:${vars.ADMIN_PASSWORD}`).toString("base64")}`,
    },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${fixture.worker.port}`;
  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  await mkdir(".cache/mailing-review", { recursive: true });
  let simulatedSends = 0;
  // Delivery is intercepted in this browser check; the backend tests exercise the actual send ledger with a mock binding.
  await page.route("**/api/admin/attendee-messages/send", async (route) => {
    simulatedSends++;
    assert.equal(route.request().postDataJSON().confirm_recipient_count, 1);
    await route.fulfill({ json: { campaign_id: "local-browser-campaign" } });
  });
  await page.route("**/api/admin/attendee-messages/continue", (route) =>
    route.fulfill({
      json: { accepted: 1, pending: 0, failed: 0, unknown: 0, skipped: 0 },
    }),
  );
  await page.route("**/api/admin/attendee-messages/test", (route) =>
    route.fulfill({ json: { message: "Local simulated test accepted." } }),
  );
  // A local stub renders the Turnstile client only. Server-side rejection cases are tested independently.
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: "const f=document.querySelector('[data-newsletter-form]');const i=document.createElement('input');i.type='hidden';i.name='cf-turnstile-response';i.value='local-test-token';f.append(i);const w=f.querySelector('[data-newsletter-turnstile]');const box=document.createElement('div');box.style.cssText='width:150px;height:140px';box.hidden=w.dataset.appearance==='interaction-only';box.setAttribute('aria-hidden','true');w.append(box);window.turnstile={reset(){}};window.onNewsletterTurnstileSuccess();",
      }),
  );
  await page.route("**/api/newsletter/subscribe", async (route) => {
    assert.match(route.request().postData(), /local-test-token/u);
    await route.fulfill({
      json: { message: "Local simulated signup accepted. Check your inbox." },
    });
  });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(origin + "/admin/attendee-messages/");
    await page
      .getByText("Compose a message or start from a draft below.", {
        exact: true,
      })
      .waitFor();
    const savedBody = page.getByLabel(
      "Message (plain text; web links become clickable)",
    );
    await page.getByRole("button", { name: "Use follow-up draft" }).click();
    assert.match(
      await savedBody.inputValue(),
      /https:\/\/sdlcai.org\/feedback\//u,
    );
    assert.match(
      await savedBody.inputValue(),
      /https:\/\/sdlcai.org\/2026\/timeline\//u,
    );
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page
      .getByText("Draft saved. No email was sent.", { exact: true })
      .waitFor();
    const savedSubject = await page
      .getByLabel("Subject", { exact: true })
      .inputValue();
    const savedMessage = await savedBody.inputValue();
    await page.reload();
    await page
      .getByText("Compose a message or start from a draft below.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.getByLabel("Subject", { exact: true }).inputValue(),
      savedSubject,
    );
    assert.equal(await savedBody.inputValue(), savedMessage);
    assert.equal(
      await page
        .getByRole("button", { name: "Send to attendees", exact: true })
        .isDisabled(),
      true,
      "Restored drafts require a fresh preview and confirmation",
    );
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    assert.equal(
      simulatedSends,
      width === 320 ? 0 : 1,
      "Saving and reloading drafts never sends email",
    );
    await visual(`saved-draft-${width}`);
    await page.getByRole("button", { name: "Use welcome draft" }).click();
    assert.match(
      await page
        .getByLabel("Message (plain text; web links become clickable)")
        .inputValue(),
      /Otakaari 2A/u,
    );
    await page
      .getByRole("button", { name: "Preview message and recipients" })
      .click();
    const send = page.getByRole("button", {
      name: "Send event email to 1 addresses",
    });
    await send.waitFor();
    assert.equal(await send.isDisabled(), true);
    await page.getByRole("checkbox").check();
    assert.equal(await send.isEnabled(), true);
    await visual(`composer-${width}`);
    await page
      .getByLabel("Subject", { exact: true })
      .fill("Updated event details");
    assert.equal(
      await page
        .getByRole("button", { name: "Send to attendees", exact: true })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Preview message and recipients" })
      .click();
    await send.waitFor();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await page
      .getByText("Draft saved. No email was sent.", { exact: true })
      .waitFor();
    await send.click();
    await page
      .getByText(
        "1 accepted / 0 pending / 0 rejected / 0 skipped / 0 unknown.",
        { exact: true },
      )
      .waitFor();

    for (const signupPath of ["/", "/subscribe/"]) {
      await page.goto(origin + signupPath);
      await page
        .getByLabel("Email address", { exact: true })
        .fill("local@example.test");
      await page.getByRole("checkbox").check();
      assert.equal(
        await page
          .locator("[data-newsletter-turnstile]")
          .getAttribute("data-size"),
        "compact",
      );
      await visual(`signup-${signupPath === "/" ? "home" : "page"}-${width}`);
      await page.getByRole("button", { name: "Join the mailing list" }).click();
      await page
        .getByText("Local simulated signup accepted. Check your inbox.", {
          exact: true,
        })
        .waitFor();
    }
  }
  assert.equal(simulatedSends, 2);
  const token = await signMailToken(
    { email_hash: await mailFingerprint("local@example.test", fixture.env) },
    fixture.env,
    "attendee-message-unsubscribe",
  );
  await page.goto(`${origin}/event-email/unsubscribe/#token=${token}`);
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(
    (
      await fixture.env.INTERESTS.prepare(
        "SELECT COUNT(*) AS n FROM attendee_message_preferences",
      ).first()
    ).n,
    0,
    "GET navigation does not unsubscribe",
  );
  await page.getByRole("button", { name: "Unsubscribe", exact: true }).click();
  await page
    .getByText(
      "You are unsubscribed from SDLCAI 2026 event emails. This does not cancel your registration.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    (
      await fixture.env.INTERESTS.prepare(
        "SELECT COUNT(*) AS n FROM attendee_message_preferences",
      ).first()
    ).n,
    1,
  );
  await visual("unsubscribe");
  await page.goto(origin + "/admin/newsletter/");
  await page.getByText(/Signup enabled\./u).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Sync with Mailrelay", exact: true })
      .isDisabled(),
    true,
  );
  // Simulate resumable admin sync without connecting to a real provider.
  let syncSteps = 0;
  await page.route(/\/api\/admin\/newsletter(?:\?.*)?$/u, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        counts: [],
        subscribers: [],
        events: [],
        next_offset: null,
        mailrelay: {
          enabled: true,
          ready: true,
          error: null,
          counts: [{ state: syncSteps > 0 ? "synced" : "pending", count: 1 }],
        },
      },
    }),
  );
  await page.route("**/api/admin/newsletter/mailrelay", async (route) => {
    syncSteps++;
    assert.equal(
      route.request().postDataJSON().action,
      syncSteps === 1 ? "start" : "sync",
    );
    await route.fulfill({
      json: {
        processed: syncSteps === 1,
        reason: syncSteps === 1 ? "synced" : "up_to_date",
        mailrelay: {
          enabled: true,
          ready: true,
          error: null,
          counts: [{ state: "synced", count: 1 }],
        },
      },
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Sync with Mailrelay", exact: true })
    .click();
  await page
    .getByText(/Sync stopped: up to date\. 1 contact checked\./u)
    .waitFor();
  assert.equal(syncSteps, 2);
  await page.setViewportSize({ width: 320, height: 1000 });
  await visual("mailrelay-320");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await visual("subscribers");
  assert.deepEqual(errors, []);
  console.log(
    "Mailing browser checks passed: desktop/mobile saved drafts, reload recovery, preview invalidation, consent, signup, unsubscribe, layout and accessibility. No real emails sent.",
  );
  async function visual(name) {
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `${name}: horizontal overflow`,
    );
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(
      async () =>
        (
          await window.axe.run(document, {
            runOnly: {
              type: "tag",
              values: [
                "wcag2a",
                "wcag2aa",
                "wcag21aa",
                "wcag22aa",
                "best-practice",
              ],
            },
          })
        ).violations,
    );
    assert.deepEqual(
      violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
      name,
    );
    await page.screenshot({
      path: `.cache/mailing-review/${name}.png`,
      fullPage: true,
    });
  }
  await context.close();
  await browser.close();
} finally {
  if (server) await closeBrowserServer(server);
  await fixture.dispose();
}
