import {
  getPublishedTalks,
  getPublishedTalk,
  publishedGraphicPackUrl,
} from "../site/published-talks.ts";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { getContentInventory } from "../site/content-inventory.ts";
import { getTalkPreviews, getTalkPreview } from "../site/talk-previews.ts";
import { getTalkGraphics, talkGraphicPackUrl } from "../site/talk-graphics.ts";
import { unzipSync } from "fflate";
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

test("talk companions preserve sourced key points, context and editorial status", () => {
  const previews = getTalkPreviews();
  assert.equal(previews.items.length, 10);
  assert.equal(new Set(previews.items.map((item) => item.slug)).size, 10);
  const talks = previews.items.map((item) => getTalkPreview(item.slug));
  for (const talk of talks) {
    assert.equal(talk.keyPoints.length, 5);
    assert.ok(talk.chapters.length > 0);
    assert.equal(new URL(talk.programmeUrl).hash, `#${talk.slug}`);
    assert.ok(talk.qualifications.length > 0);
    assert.match(talk.pageTitle, /Editorial preview/);
    assert.doesNotMatch(
      JSON.stringify(talk),
      /127\.0\.0\.1|\/Volumes\/|\.wav|\.srt|quoteCandidates/,
    );
    for (const point of talk.keyPoints) {
      assert.equal(
        new URL(point.url).searchParams.get("v"),
        new URL(talk.youtubeUrl).searchParams.get("v"),
      );
    }
    for (const related of talk.related) {
      assert.notEqual(related.id, talk.id);
      assert.ok(previews.items.some((item) => item.href === related.href));
      assert.ok(related.connection);
    }
  }
  const zak = talks.find((talk) => talk.id === "zak-talk");
  assert.match(zak.synopsis, /preprint/);
  assert.match(
    zak.qualifications.map((note) => note.text).join(" "),
    /do not imply.*regulatory approval/,
  );
  assert.equal(talks.find((talk) => talk.id === "mo-talk").qa, undefined);
  assert.match(
    talks.find((talk) => talk.id === "joongi-talk").qa.title,
    /Generative UI/,
  );
  assert.throws(() => getTalkPreview("missing-talk"), /Unknown talk preview/);
});

test("takeaway graphics preserve attribution, source passages and review context", async () => {
  const library = JSON.parse(
    await readFile(
      "output/video-analysis/2026-10-22/content-library.json",
      "utf8",
    ),
  );
  const graphics = getTalkGraphics();
  assert.equal(graphics.length, 10);
  for (const graphic of graphics) {
    const talk = library.items.find((item) => item.id === graphic.id);
    assert.ok(talk.speakerNames.includes(graphic.speaker));
    assert.equal(graphic.points.length, 3);
    assert.match(graphic.alt, /paraphrased/i);
    assert.match(graphic.handoff, /EDITORIAL DRAFT/);
    for (const point of graphic.points) {
      assert.equal(
        point.sourceUrl,
        talk.takeaways[point.sourceIndex - 1].youtubeUrl,
      );
      assert.ok(graphic.handoff.includes(point.sourceUrl));
    }
    for (const qualification of talk.editorialCaveats)
      assert.ok(graphic.handoff.includes(qualification));
    assert.ok(
      graphic.assets.every((asset) =>
        asset.src.startsWith(`/admin/talk-previews/${graphic.slug}/`),
      ),
    );
    assert.equal(graphic.landscape.width, 1200);
    assert.equal(graphic.portrait.height, 1350);
  }
  assert.match(
    graphics.find((graphic) => graphic.id === "viljami-talk").caption,
    /do not establish a delivery-speed improvement/,
  );
  assert.match(
    graphics.find((graphic) => graphic.id === "zak-talk").handoff,
    /do not imply.*regulatory approval/,
  );
});

test("editorial inventory and talk previews stay behind admin authentication and out of public scripts", async (t) => {
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
    "/admin/talk-previews/",
    ...getTalkPreviews().items.map((item) => item.href),
    "/admin/talk-previews/genai-software-engineering/index.html",
    "/%61dmin/talk-previews/genai-software-engineering/",
    "/admin%2Ftalk-previews/genai-software-engineering/",
    ...getTalkGraphics().flatMap((graphic) => [
      ...graphic.assets.map((asset) => asset.src),
      graphic.copyUrl,
    ]),
    talkGraphicPackUrl,
    "/%61dmin/talk-previews/genai-software-engineering/summary-landscape.png",
    "/admin%2Ftalk-previews/genai-software-engineering/summary-portrait.png",
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
      assert.doesNotMatch(
        await response.text(),
        /data-inventory-item|data-talk-preview/,
      );
      response = await fixture.worker.fetch(location.href, {
        redirect: "manual",
      });
    }
    assert.ok(
      [303, 404].includes(response.status),
      `${pathname}: ${response.status}`,
    );
    assert.doesNotMatch(
      await response.text(),
      /data-inventory-item|data-talk-preview/,
    );
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
  for (const item of getTalkPreviews().items) {
    const preview = await fixture.worker.fetch(
      `https://sdlcai.org${item.href}`,
      {
        headers: {
          authorization: `Basic ${Buffer.from("inventory-admin:local-inventory-password").toString("base64")}`,
        },
      },
    );
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("cache-control"), /no-store/);
    assert.match(preview.headers.get("x-robots-tag"), /noindex/);
    const html = await preview.text();
    assert.equal((html.match(/data-talk-key-point/g) ?? []).length, 5);
    assert.match(html, /Private editorial preview/);
  }
  const publicIndex = await fixture.worker.fetch(
    "https://sdlcai.org/2026/talks/",
  );
  assert.equal(publicIndex.status, 200);
  assert.equal(
    ((await publicIndex.text()).match(/data-talk-summary-card/g) ?? []).length,
    10,
  );
  const forbidden =
    /EDITORIAL DRAFT|caption review|ASR|wording.*flagged|individual speaker is unconfirmed|quoteCandidates|inventoryUrl|\/admin\/|\/Volumes\/|\.srt/;
  for (const card of getPublishedTalks().items) {
    const published = getPublishedTalk(card.slug);
    assert.doesNotMatch(JSON.stringify(published), forbidden);
    const page = await fixture.worker.fetch(`https://sdlcai.org${card.href}`);
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.headers.get("x-robots-tag") ?? "", /noindex/);
    const html = await page.text();
    assert.doesNotMatch(html, forbidden);
    assert.equal((html.match(/data-talk-key-point/g) ?? []).length, 5);
    assert.ok(html.includes(`content="${published.ogImage}"`));
    for (const asset of card.graphic.assets) {
      const response = await fixture.worker.fetch(
        `https://sdlcai.org${asset.src}`,
      );
      assert.equal(response.status, 200);
      const png = Buffer.from(await response.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), asset.width);
      assert.equal(png.readUInt32BE(20), asset.height);
    }
    const copy = await fixture.worker.fetch(
      `https://sdlcai.org${card.graphic.copyUrl}`,
    );
    assert.equal(copy.status, 200);
    assert.equal(await copy.text(), card.graphic.copy);
    assert.doesNotMatch(card.graphic.copy, forbidden);
  }
  const publicPack = await fixture.worker.fetch(
    `https://sdlcai.org${publishedGraphicPackUrl}`,
  );
  assert.equal(publicPack.status, 200);
  const publicEntries = unzipSync(
    new Uint8Array(await publicPack.arrayBuffer()),
  );
  assert.equal(Object.keys(publicEntries).length, 30);
  for (const [filename, bytes] of Object.entries(publicEntries)) {
    if (filename.endsWith(".txt"))
      assert.doesNotMatch(new TextDecoder().decode(bytes), forbidden);
  }
  assert.match(
    getPublishedTalk("zak-allal-industry-perspective").synopsis,
    /intention to seek regulatory qualification/,
  );
  assert.doesNotMatch(
    getPublishedTalk("zak-allal-industry-perspective").synopsis,
    /has been sought/,
  );
  const graphicHeaders = {
    authorization: `Basic ${Buffer.from("inventory-admin:local-inventory-password").toString("base64")}`,
  };
  for (const graphic of getTalkGraphics()) {
    for (const asset of graphic.assets) {
      const image = await fixture.worker.fetch(
        `https://sdlcai.org${asset.src}`,
        { headers: graphicHeaders },
      );
      assert.equal(image.status, 200);
      assert.match(image.headers.get("content-type"), /image\/png/);
      assert.match(image.headers.get("cache-control"), /no-store/);
      const png = Buffer.from(await image.arrayBuffer());
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), asset.width);
      assert.equal(png.readUInt32BE(20), asset.height);
    }
  }
  const pack = await fixture.worker.fetch(
    `https://sdlcai.org${talkGraphicPackUrl}`,
    { headers: graphicHeaders },
  );
  assert.equal(pack.status, 200);
  assert.match(pack.headers.get("cache-control"), /no-store/);
  const entries = unzipSync(new Uint8Array(await pack.arrayBuffer()));
  assert.equal(
    Object.keys(entries).filter((key) => key.endsWith(".png")).length,
    20,
  );
  assert.equal(
    Object.keys(entries).filter((key) => key.endsWith(".txt")).length,
    10,
  );
  assert.match(
    new TextDecoder().decode(entries["mo-talk-copy.txt"]),
    /EDITORIAL DRAFT/,
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
