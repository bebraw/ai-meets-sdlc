import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createWorkerFixture } from "./helpers/worker-fixture.mjs";

const origin = "https://sdlcai.org";

test("the 2026 archive preserves resources, canonical content and legacy links while the homepage promotes signup", async (t) => {
  const fixture = await createWorkerFixture({
    vars: {
      ADMIN_USERNAME: "archive-test-admin",
      ADMIN_PASSWORD: "local-archive-test-password",
      NEWSLETTER_ENABLED: "true",
      EMAIL_ENCRYPTION_KEY: "local-archive-test-key",
      TURNSTILE_SITE_KEY: "local-archive-site-key",
    },
  });
  t.after(() => fixture.dispose());
  const { worker, runSql } = fixture;

  for (const section of [
    "schedule",
    "speakers",
    "photos",
    "timeline",
    "announcements",
    "faq",
    "posters",
    "for-sponsors",
  ]) {
    const response = await worker.fetch(`${origin}/2026/${section}/`);
    assert.equal(response.status, 200, section);
    assert.match(
      await response.text(),
      new RegExp(`rel="canonical"[^>]*href="${origin}/2026/${section}/"`),
      section,
    );
    for (const suffix of ["", "/"]) {
      const legacy = await worker.fetch(
        `${origin}/${section}${suffix}?view=archive`,
        { redirect: "manual" },
      );
      assert.equal(legacy.status, 308);
      assert.equal(
        legacy.headers.get("location"),
        `${origin}/2026/${section}/?view=archive`,
      );
    }
  }
  const announcement = await worker.fetch(
    `${origin}/announcements/sdlcai-2026-announced/?source=shared`,
    { redirect: "manual" },
  );
  assert.equal(announcement.status, 308);
  assert.equal(
    announcement.headers.get("location"),
    `${origin}/2026/announcements/sdlcai-2026-announced/?source=shared`,
  );
  const year = await worker.fetch(`${origin}/2026?source=nav`, {
    redirect: "manual",
  });
  assert.equal(year.status, 308);
  assert.equal(year.headers.get("location"), `${origin}/2026/?source=nav`);

  const home = await (await worker.fetch(origin)).text();
  assert.match(home, /data-newsletter-form/);
  assert.match(
    home.replace(/\s+/gu, " "),
    /when the next SDLCAI seminar is announced/,
  );
  assert.match(home, /href="\/2026\/"/);
  assert.doesNotMatch(
    home,
    /data-home-speaker-id|data-registration-status|Watch live on YouTube|"@type":\s*"Event"/,
  );

  await runSql(
    `UPDATE canonical_speaker_content SET content_json = json_set(content_json, '$.talks[0].title', 'An archived talk from D1') WHERE speaker_id = 'ohans-emmanuel'`,
  );
  for (const pathname of ["/2026/", "/2026/schedule/", "/2026/speakers/"]) {
    const response = await worker.fetch(origin + pathname);
    assert.equal(response.headers.get("x-sdlcai-content-source"), "d1");
    assert.match(await response.text(), /An archived talk from D1/);
  }
  const oldFeed = await worker.fetch(origin + "/event.json");
  const yearFeed = await worker.fetch(origin + "/2026/event.json");
  assert.equal(oldFeed.status, 200);
  assert.equal(yearFeed.status, 200);
  assert.deepEqual(await yearFeed.json(), await oldFeed.json());
  const schema = await worker.fetch(origin + "/2026/event.schema.json");
  assert.equal(schema.status, 200);
  const sitemap = await readFile("build/sitemap.xml", "utf8");
  assert.match(sitemap, /<loc>https:\/\/sdlcai.org\/2026\/<\/loc>/);
  assert.doesNotMatch(
    sitemap,
    /<loc>https:\/\/sdlcai.org\/(?:schedule|speakers|photos|timeline|announcements|faq|posters|for-sponsors)\//,
  );
  assert.equal(
    (await worker.fetch(origin + "/api/admin/speakers")).status,
    401,
  );
});
