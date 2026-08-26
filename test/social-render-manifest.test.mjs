import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSocialRenderManifest } from "../scripts/generate-social-render-manifest.mjs";
import {
  matchSocialRenderAsset,
  parseSocialRenderManifest,
} from "../worker/social-render-contract.ts";

const deck = (firstTitle = "First talk") => `<!doctype html>
<html><head><link rel="stylesheet" href="/tailwind-test.css"><script src="/assets/slides.js"></script></head>
<body>
<section data-slide-id="talk-first" data-slide-number="1" data-presentation-slide><h1>${firstTitle}</h1><img src="/assets/first.svg"></section>
<section data-slide-id="talk-second" data-slide-number="2" data-presentation-slide><h1>Second talk</h1><img src="/assets/second.svg"></section>
</body></html>`;

async function createFixture() {
  const buildDir = await mkdtemp(path.join(tmpdir(), "social-manifest-test-"));
  await mkdir(path.join(buildDir, "slides/deck"), { recursive: true });
  await mkdir(path.join(buildDir, "assets"), { recursive: true });
  await writeFile(path.join(buildDir, "slides/deck/index.html"), deck());
  await writeFile(
    path.join(buildDir, "tailwind-test.css"),
    "@font-face{src:url('/assets/font.woff2')} body{color:#fff}",
  );
  await writeFile(path.join(buildDir, "assets/font.woff2"), "font-a");
  await writeFile(path.join(buildDir, "assets/slides.js"), "export {};\n");
  await writeFile(path.join(buildDir, "assets/first.svg"), "<svg>first</svg>");
  await writeFile(
    path.join(buildDir, "assets/second.svg"),
    "<svg>second</svg>",
  );
  return buildDir;
}

function versionsBySlide(manifest) {
  return new Map(manifest.slides.map((slide) => [slide.id, slide.version]));
}

test("social render versions only invalidate affected slides", async (t) => {
  const buildDir = await createFixture();
  t.after(() => rm(buildDir, { force: true, recursive: true }));

  const initial = await buildSocialRenderManifest({ buildDir });
  assert.equal(initial.assets.length, 6);
  const parsedManifest = parseSocialRenderManifest(initial);
  const firstAsset = initial.assets[0];
  const matchedAsset = matchSocialRenderAsset(
    new URL(`https://sdlcai.org${firstAsset.path}?v=${firstAsset.version}`),
    parsedManifest,
  );
  assert.equal(matchedAsset?.asset.id, firstAsset.id);

  const invalidManifest = structuredClone(initial);
  invalidManifest.assets[0].width += 1;
  assert.throws(
    () => parseSocialRenderManifest(invalidManifest),
    /invalid contract/u,
  );
  assert.deepEqual(
    initial.slides.map(({ id, number }) => ({ id, number })),
    [
      { id: "talk-first", number: 1 },
      { id: "talk-second", number: 2 },
    ],
  );

  await writeFile(
    path.join(buildDir, "slides/deck/index.html"),
    deck("Updated talk"),
  );
  const afterCopyChange = await buildSocialRenderManifest({ buildDir });
  const initialVersions = versionsBySlide(initial);
  const copyVersions = versionsBySlide(afterCopyChange);

  assert.notEqual(
    copyVersions.get("talk-first"),
    initialVersions.get("talk-first"),
  );
  assert.equal(
    copyVersions.get("talk-second"),
    initialVersions.get("talk-second"),
  );

  await writeFile(
    path.join(buildDir, "assets/first.svg"),
    "<svg>updated</svg>",
  );
  const afterImageChange = await buildSocialRenderManifest({ buildDir });
  const imageVersions = versionsBySlide(afterImageChange);

  assert.notEqual(
    imageVersions.get("talk-first"),
    copyVersions.get("talk-first"),
  );
  assert.equal(
    imageVersions.get("talk-second"),
    copyVersions.get("talk-second"),
  );

  await writeFile(
    path.join(buildDir, "tailwind-test.css"),
    "@font-face{src:url('/assets/font.woff2')} body{color:#000}",
  );
  const afterGlobalChange = await buildSocialRenderManifest({ buildDir });
  const globalVersions = versionsBySlide(afterGlobalChange);

  assert.notEqual(
    globalVersions.get("talk-first"),
    imageVersions.get("talk-first"),
  );
  assert.notEqual(
    globalVersions.get("talk-second"),
    imageVersions.get("talk-second"),
  );

  const savedManifest = JSON.parse(
    await readFile(path.join(buildDir, "assets/social/manifest.json"), "utf8"),
  );
  assert.equal(savedManifest.version, afterGlobalChange.version);
});
