import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { getContentInventory } from "../site/content-inventory.ts";
import { createWorkerFixture } from "./helpers/worker-fixture.mjs";

test("inventory preserves published sources, candidate status and attribution limits", async () => {
  const inventory = getContentInventory();
  assert.equal(inventory.items.length, 80);
  assert.equal(new Set(inventory.items.map((item) => item.id)).size, 80);
  assert.equal(
    inventory.items.filter((item) => item.status === "published").length,
    17,
  );
  assert.equal(
    inventory.items.filter((item) => item.status === "review").length,
    51,
  );
  const finalQuote = inventory.items.find(
    (item) => item.id === "final-panel-q01",
  );
  assert.match(finalQuote.notes.join(" "), /individual speaker is unconfirmed/);
  assert.equal(finalQuote.status, "review");
  assert.equal(
    inventory.items.find((item) => item.id === "mood-q01").links[1].url,
    "https://www.youtube.com/watch?v=q-4H3JMNDE4&t=186s",
  );
  const clip = inventory.items.find((item) => item.id === "mo-talk-clip-01");
  assert.equal(
    clip.links[0].url,
    "https://www.youtube.com/watch?v=l8quIPHmakI&t=1589s",
  );
  assert.match(clip.notes.join(" "), /before rendering or publishing/);
  for (const item of inventory.items) {
    for (const link of item.links)
      assert.equal(new URL(link.url).protocol, "https:");
    assert.doesNotMatch(
      JSON.stringify(item),
      /127\.0\.0\.1|\/Volumes\/|\.wav|\.srt/,
    );
  }
  const library = JSON.parse(
    await readFile(
      "output/video-analysis/2026-10-22/content-library.json",
      "utf8",
    ),
  );
  const release = JSON.parse(
    await readFile("production/video-release/2026-10-22/release.json", "utf8"),
  );
  assert.equal(release.closeout.status, "closed");
  const published = new Map(
    release.items.map((item) => [item.id, item.youtubeId]),
  );
  for (const video of library.items) {
    for (const key of ["takeaways", "quoteCandidates", "clipCandidates"]) {
      for (const excerpt of video[key]) {
        const url = new URL(excerpt.youtubeUrl);
        assert.equal(url.searchParams.get("v"), published.get(video.id));
        assert.equal(
          Number.parseInt(url.searchParams.get("t") ?? "0", 10),
          Math.floor(excerpt.start),
        );
        assert.ok(excerpt.start >= 0 && excerpt.end <= video.durationSeconds);
      }
    }
  }
});

test("editorial inventory stays behind admin authentication and out of public scripts", async (t) => {
  const fixture = await createWorkerFixture({
    vars: {
      ADMIN_USERNAME: "inventory-admin",
      ADMIN_PASSWORD: "local-inventory-password",
      TURNSTILE_SITE_KEY: "",
    },
  });
  t.after(() => fixture.dispose());
  for (const pathname of [
    "/admin/content-inventory/",
    "/admin/content-inventory/index.html",
    "/%61dmin/content-inventory/",
    "/admin%2Fcontent-inventory/",
  ]) {
    let response = await fixture.worker.fetch(`https://sdlcai.org${pathname}`, {
      redirect: "manual",
    });
    if ([307, 308].includes(response.status)) {
      const location = new URL(
        response.headers.get("location"),
        "https://sdlcai.org",
      );
      assert.ok(location.pathname.startsWith("/admin/"));
      assert.doesNotMatch(await response.text(), /data-inventory-item/);
      response = await fixture.worker.fetch(location.href, {
        redirect: "manual",
      });
    }
    assert.ok(
      [303, 404].includes(response.status),
      `${pathname}: ${response.status}`,
    );
    assert.doesNotMatch(await response.text(), /data-inventory-item/);
  }
  const response = await fixture.worker.fetch(
    "https://sdlcai.org/admin/content-inventory/",
    {
      headers: {
        authorization: `Basic ${Buffer.from("inventory-admin:local-inventory-password").toString("base64")}`,
      },
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.match(response.headers.get("x-robots-tag"), /noindex/);
  assert.equal(
    (await response.text()).match(/data-inventory-item/g).length,
    80,
  );
  const privatePhrase =
    "The deployment near miss and the permissions it exposed";
  for (const file of await readdir("build/assets")) {
    if (file.endsWith(".js"))
      assert.ok(
        !(await readFile(`build/assets/${file}`, "utf8")).includes(
          privatePhrase,
        ),
        file,
      );
  }
});
