import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  socialRenderContract,
  socialRenderManifestPath,
  socialRenderPresets,
  speakerPromotionManifestPath,
} from "./social-render-presets.mjs";

const buildDir = "build";
const fontBudgetBytes = 70 * 1024;
const fontSubsetCharactersPath = "assets/fonts/subset-characters.txt";
const speakerImageBudgetBytes = 50 * 1024;
const speakerImagesDir = "assets/speakers";
const venueImageBudgetBytes = 80 * 1024;
const venueImagePath = "assets/marsio-saastamoinen-stage.webp";

try {
  await access(path.join(buildDir, "index.html"));
} catch {
  console.error(
    "Build output is missing. Expected Gustwind to generate build/index.html.",
  );
  process.exit(1);
}

const htmlFiles = await getHtmlFiles(buildDir);
const cssFiles = await getFilesByExtension(buildDir, ".css");
const speakerImageFiles = await getFilesByExtension(speakerImagesDir, ".webp");
const failures = [];
const sitemap = await readFile(path.join(buildDir, "sitemap.xml"), "utf8");
const slideDeckHtml = await readFile(
  path.join(buildDir, "slides/deck/index.html"),
  "utf8",
);
const slideLibraryHtml = await readFile(
  path.join(buildDir, "slides/index.html"),
  "utf8",
);
const socialRenderManifest = JSON.parse(
  await readFile(path.join(buildDir, socialRenderManifestPath), "utf8"),
);
const speakerPromotionManifest = JSON.parse(
  await readFile(path.join(buildDir, speakerPromotionManifestPath), "utf8"),
);
const fontSubsetCharacters = new Set(
  [...(await readFile(fontSubsetCharactersPath, "utf8"))].filter(
    (character) => !/\s/u.test(character),
  ),
);

for (const pathname of ["/slides/", "/slides/deck/", "/slides/schedule/"]) {
  if (!sitemap.includes(`<loc>https://sdlcai.org${pathname}</loc>`)) {
    failures.push(`sitemap.xml: missing public slide route ${pathname}`);
  }
}

for (const pathname of [
  "/admin/",
  "/admin/login/",
  "/admin/speakers/",
  "/admin/dinner/",
  "/admin/posters/",
  "/admin/interests/",
  "/admin-slides/",
  "/admin-slide-deck/",
  "/admin-slide-schedule/",
  "/speaker/",
]) {
  if (sitemap.includes(`<loc>https://sdlcai.org${pathname}</loc>`)) {
    failures.push(`sitemap.xml: includes private/internal route ${pathname}`);
  }
}

for (const filePath of htmlFiles) {
  const html = await readFile(filePath, "utf8");
  const imageTags = html.match(/<img\b[^>]*>/g) ?? [];
  const unsupportedCharacters = getUnsupportedTextCharacters(
    html,
    fontSubsetCharacters,
  );

  if (unsupportedCharacters.length > 0) {
    failures.push(
      `${filePath}: text includes characters outside ${fontSubsetCharactersPath}: ${unsupportedCharacters
        .map(formatCharacter)
        .join(", ")}`,
    );
  }

  for (const tag of imageTags) {
    const loading = getAttribute(tag, "loading");
    const decoding = getAttribute(tag, "decoding");
    const width = getAttribute(tag, "width");
    const height = getAttribute(tag, "height");

    if (loading !== "lazy") {
      failures.push(`${filePath}: image missing loading="lazy": ${tag}`);
    }

    if (decoding !== "async") {
      failures.push(`${filePath}: image missing decoding="async": ${tag}`);
    }

    if (!isPositiveInteger(width)) {
      failures.push(`${filePath}: image missing positive width: ${tag}`);
    }

    if (!isPositiveInteger(height)) {
      failures.push(`${filePath}: image missing positive height: ${tag}`);
    }
  }
}

for (const filePath of cssFiles) {
  const css = await readFile(filePath, "utf8");
  const fontUrls = [...css.matchAll(/url\("?(\/assets\/fonts\/[^")]+)"?\)/g)]
    .map((match) => match[1])
    .sort();

  for (const fontUrl of fontUrls) {
    if (!fontUrl.endsWith(".woff2")) {
      failures.push(`${filePath}: font is not WOFF2: ${fontUrl}`);
    }
  }

  const uniqueFontUrls = new Set(fontUrls);

  if (uniqueFontUrls.size > 3) {
    failures.push(
      `${filePath}: expected at most 3 font files, found ${uniqueFontUrls.size}: ${[
        ...uniqueFontUrls,
      ].join(", ")}`,
    );
  }

  const fontBytes = await getFontBytes(uniqueFontUrls);

  if (fontBytes > fontBudgetBytes) {
    failures.push(
      `${filePath}: referenced fonts are ${formatBytes(
        fontBytes,
      )}, above the ${formatBytes(fontBudgetBytes)} budget`,
    );
  }
}

for (const filePath of speakerImageFiles) {
  const imageBytes = (await stat(filePath)).size;

  if (imageBytes > speakerImageBudgetBytes) {
    failures.push(
      `${filePath}: speaker image is ${formatBytes(
        imageBytes,
      )}, above the ${formatBytes(speakerImageBudgetBytes)} budget`,
    );
  }
}

const venueImageBytes = (await stat(venueImagePath)).size;

if (venueImageBytes > venueImageBudgetBytes) {
  failures.push(
    `${venueImagePath}: venue image is ${formatBytes(
      venueImageBytes,
    )}, above the ${formatBytes(venueImageBudgetBytes)} budget`,
  );
}

verifySocialRenderManifest(
  socialRenderManifest,
  slideDeckHtml,
  slideLibraryHtml,
  failures,
);
verifySpeakerPromotionManifest(
  speakerPromotionManifest,
  socialRenderManifest,
  failures,
);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));

  return match?.[1];
}

function isPositiveInteger(value) {
  return /^\d+$/.test(value ?? "") && Number(value) > 0;
}

async function getFontBytes(fontUrls) {
  let total = 0;

  for (const fontUrl of fontUrls) {
    const fontPath = path.join(buildDir, fontUrl.slice(1));

    try {
      total += (await stat(fontPath)).size;
    } catch {
      failures.push(`Missing font asset: ${fontUrl}`);
    }
  }

  return total;
}

function formatBytes(value) {
  return `${Math.round(value / 1024)} KB`;
}

function verifySocialRenderManifest(manifest, deckHtml, libraryHtml, errors) {
  const slideCount = (deckHtml.match(/data-presentation-slide/gu) ?? []).length;
  const expectedPresetIds = new Set(
    socialRenderPresets.map((preset) => preset.id),
  );
  const assetIds = new Set();
  const assetPaths = new Set();

  if (manifest.schemaVersion !== 2) {
    errors.push("Social render manifest has an unsupported schema version.");
  }

  if (manifest.renderer !== socialRenderContract) {
    errors.push("Social render manifest has an unexpected renderer contract.");
  }

  if (!/^[a-f0-9]{64}$/u.test(manifest.version ?? "")) {
    errors.push("Social render manifest version is not a SHA-256 digest.");
  }

  if (
    !Array.isArray(manifest.slides) ||
    manifest.slides.length !== slideCount
  ) {
    errors.push(
      `Social render manifest describes ${manifest.slides?.length ?? 0} slides; deck contains ${slideCount}.`,
    );
  }

  if (
    !Array.isArray(manifest.assets) ||
    manifest.assets.length !== slideCount * socialRenderPresets.length
  ) {
    errors.push(
      `Social render manifest must contain ${slideCount * socialRenderPresets.length} assets.`,
    );
    return;
  }

  for (const asset of manifest.assets) {
    const expectedDimensions = `${asset.width}x${asset.height}`;

    if (assetIds.has(asset.id))
      errors.push(`Duplicate social asset id: ${asset.id}`);
    if (assetPaths.has(asset.path)) {
      errors.push(`Duplicate social asset path: ${asset.path}`);
    }

    assetIds.add(asset.id);
    assetPaths.add(asset.path);

    if (!expectedPresetIds.has(asset.presetId)) {
      errors.push(`Unknown social render preset: ${asset.presetId}`);
    }

    if (!/^[a-f0-9]{64}$/u.test(asset.version ?? "")) {
      errors.push(`Social asset ${asset.id} has an invalid version.`);
    }

    if (
      asset.path !==
      `/assets/social/${asset.presetId}/sdlcai-2026-${asset.slideId}-${asset.presetId}-${expectedDimensions}.jpg`
    ) {
      errors.push(`Social asset ${asset.id} has an unexpected stable path.`);
    }

    if (!libraryHtml.includes(asset.path)) {
      errors.push(`Slide library does not link to ${asset.path}.`);
    }

    if (
      !Array.isArray(asset.speakerIds) ||
      asset.speakerIds.some(
        (speakerId) =>
          typeof speakerId !== "string" ||
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(speakerId),
      )
    ) {
      errors.push(`Social asset ${asset.id} has invalid speaker dependencies.`);
    }
  }
}

function verifySpeakerPromotionManifest(manifest, socialManifest, errors) {
  if (manifest.schemaVersion !== 1) {
    errors.push(
      "Speaker promotion manifest has an unsupported schema version.",
    );
  }

  if (!/^[a-f0-9]{64}$/u.test(manifest.version ?? "")) {
    errors.push("Speaker promotion manifest version is not a SHA-256 digest.");
  }

  if (!Array.isArray(manifest.speakers) || manifest.speakers.length === 0) {
    errors.push("Speaker promotion manifest does not contain speakers.");
    return;
  }

  const socialAssets = new Map(
    socialManifest.assets.map((asset) => [asset.path, asset]),
  );
  const speakerIds = new Set();

  for (const speaker of manifest.speakers) {
    if (!speaker.id || speakerIds.has(speaker.id)) {
      errors.push(`Invalid or duplicate promotion speaker id: ${speaker.id}`);
    }

    speakerIds.add(speaker.id);

    if (!Array.isArray(speaker.talks) || speaker.talks.length === 0) {
      errors.push(`Speaker ${speaker.id} has no promotion talks.`);
      continue;
    }

    for (const talk of speaker.talks) {
      if (!Array.isArray(talk.assets) || talk.assets.length === 0) {
        errors.push(`Promotion talk ${talk.id} has no social assets.`);
        continue;
      }

      for (const asset of talk.assets) {
        const socialAsset = socialAssets.get(asset.path);

        if (!socialAsset || socialAsset.version !== asset.version) {
          errors.push(
            `Promotion asset ${asset.path} does not match the render manifest.`,
          );
        }
      }
    }
  }
}

function getUnsupportedTextCharacters(html, supportedCharacters) {
  const text = decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " "),
  );
  const unsupportedCharacters = new Set();

  for (const character of text) {
    if (!/\s/u.test(character) && !supportedCharacters.has(character)) {
      unsupportedCharacters.add(character);
    }
  }

  return [...unsupportedCharacters].sort(
    (a, b) => a.codePointAt(0) - b.codePointAt(0),
  );
}

function decodeHtmlEntities(value) {
  const namedEntities = new Map([
    ["amp", "&"],
    ["apos", "'"],
    ["gt", ">"],
    ["lt", "<"],
    ["nbsp", " "],
    ["quot", '"'],
  ]);

  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }

    return namedEntities.get(entity.toLowerCase()) ?? match;
  });
}

function formatCharacter(character) {
  return `${character} U+${character
    .codePointAt(0)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")}`;
}

async function getHtmlFiles(directory) {
  return getFilesByExtension(directory, ".html");
}

async function getFilesByExtension(directory, extension) {
  const entries = await readdir(directory);
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const entryStat = await stat(entryPath);

    if (entryStat.isDirectory()) {
      files.push(...(await getFilesByExtension(entryPath, extension)));
    } else if (entryPath.endsWith(extension)) {
      files.push(entryPath);
    }
  }

  return files;
}
