import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  socialRenderContract,
  socialRenderManifestPath,
  socialRenderPresets,
} from "./social-render-presets.mjs";

const deckPath = "slides/deck/index.html";
const slidePattern =
  /<section\b(?=[^>]*\bdata-presentation-slide\b)[\s\S]*?<\/section>/gu;
const rootReferencePattern = /(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/gu;
const cssReferencePattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gu;
const importReferencePattern =
  /(?:from\s*|import\s*\(|import\s*)["']([^"']+)["']/gu;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function getAttribute(html, name) {
  return html.match(new RegExp(`\\s${name}="([^"]+)"`, "u"))?.[1];
}

function toBuildPath(buildDir, pathname) {
  const decodedPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolvedPath = path.resolve(buildDir, decodedPath);
  const resolvedBuildDir = `${path.resolve(buildDir)}${path.sep}`;

  if (!resolvedPath.startsWith(resolvedBuildDir)) {
    throw new Error(
      `Social render input escapes the build directory: ${pathname}`,
    );
  }

  return resolvedPath;
}

function resolveReference(reference, parentPathname) {
  if (
    !reference ||
    reference.startsWith("data:") ||
    reference.startsWith("#") ||
    /^[a-z]+:/iu.test(reference)
  ) {
    return null;
  }

  const pathname = reference.startsWith("/")
    ? reference
    : path.posix.resolve(path.posix.dirname(parentPathname), reference);

  return pathname.split(/[?#]/u, 1)[0];
}

function collectReferences(source, parentPathname) {
  const references = new Set();

  for (const match of source.matchAll(rootReferencePattern)) {
    references.add(match[1]);
  }

  if (parentPathname.endsWith(".css")) {
    for (const match of source.matchAll(cssReferencePattern)) {
      const reference = resolveReference(match[1], parentPathname);
      if (reference) references.add(reference);
    }
  }

  if (parentPathname.endsWith(".js")) {
    for (const match of source.matchAll(importReferencePattern)) {
      const reference = resolveReference(match[1], parentPathname);
      if (reference) references.add(reference);
    }
  }

  return [...references].sort();
}

async function hashDependencies(buildDir, initialReferences) {
  const pending = [...new Set(initialReferences)].sort();
  const visited = new Set();
  const inputs = [];

  while (pending.length > 0) {
    const pathname = pending.shift();

    if (!pathname || visited.has(pathname)) continue;
    visited.add(pathname);

    const filePath = toBuildPath(buildDir, pathname);
    const content = await readFile(filePath);

    inputs.push({ path: pathname, hash: digest(content) });

    if (pathname.endsWith(".css") || pathname.endsWith(".js")) {
      const nestedReferences = collectReferences(
        content.toString("utf8"),
        pathname,
      );

      for (const nestedReference of nestedReferences) {
        if (!visited.has(nestedReference)) pending.push(nestedReference);
      }

      pending.sort();
    }
  }

  return inputs;
}

export async function buildSocialRenderManifest({ buildDir = "build" } = {}) {
  const resolvedBuildDir = path.resolve(buildDir);
  const html = await readFile(path.join(resolvedBuildDir, deckPath), "utf8");
  const sections = [...html.matchAll(slidePattern)].map((match) => match[0]);

  if (sections.length === 0) {
    throw new Error(`${deckPath} does not contain presentation slides.`);
  }

  const globalHtml = html.replace(
    slidePattern,
    "<section data-presentation-slide></section>",
  );
  const globalInputs = await hashDependencies(
    resolvedBuildDir,
    collectReferences(globalHtml, `/${deckPath}`),
  );
  const globalVersion = digest(
    JSON.stringify({
      contract: socialRenderContract,
      globalHtml,
      globalInputs,
    }),
  );
  const slideIds = new Set();
  const slideNumbers = new Set();
  const slides = [];
  const assets = [];

  for (const section of sections) {
    const id = getAttribute(section, "data-slide-id");
    const numberValue = getAttribute(section, "data-slide-number");
    const number = Number(numberValue);

    if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
      throw new Error(
        `Presentation slide has an invalid data-slide-id: ${id ?? "missing"}`,
      );
    }

    if (!Number.isSafeInteger(number) || number < 1) {
      throw new Error(
        `Presentation slide ${id} has an invalid data-slide-number.`,
      );
    }

    if (slideIds.has(id) || slideNumbers.has(number)) {
      throw new Error(
        `Presentation slide identifiers must be unique: ${id} / ${number}`,
      );
    }

    slideIds.add(id);
    slideNumbers.add(number);

    const slideInputs = await hashDependencies(
      resolvedBuildDir,
      collectReferences(section, `/${deckPath}`),
    );
    const slideVersion = digest(
      JSON.stringify({ globalVersion, section, slideInputs }),
    );

    slides.push({ id, number, version: slideVersion });

    for (const preset of socialRenderPresets) {
      const dimensions = `${preset.width}x${preset.height}`;
      const pathname = `/assets/social/${preset.id}/sdlcai-2026-${id}-${preset.id}-${dimensions}.jpg`;
      const legacyPath = `/assets/social/${preset.id}/sdlcai-2026-slide-${String(number).padStart(2, "0")}-${preset.id}-${dimensions}.jpg`;
      const version = digest(
        JSON.stringify({
          contract: socialRenderContract,
          preset,
          slideVersion,
        }),
      );

      assets.push({
        id: `${id}:${preset.id}`,
        slideId: id,
        slideNumber: number,
        presetId: preset.id,
        width: preset.width,
        height: preset.height,
        quality: preset.quality,
        maxBytes: preset.maxBytes,
        path: pathname,
        legacyPath,
        version,
      });
    }
  }

  slides.sort((a, b) => a.number - b.number);
  assets.sort(
    (a, b) =>
      a.slideNumber - b.slideNumber || a.presetId.localeCompare(b.presetId),
  );

  for (const [index, slide] of slides.entries()) {
    if (slide.number !== index + 1) {
      throw new Error(
        "Presentation slide numbers must be contiguous and start at one.",
      );
    }
  }

  const manifest = {
    schemaVersion: 1,
    renderer: socialRenderContract,
    deckPath: "/slides/deck/",
    version: digest(
      JSON.stringify(assets.map(({ id, version }) => ({ id, version }))),
    ),
    presets: socialRenderPresets,
    slides,
    assets,
  };
  const outputPath = path.join(resolvedBuildDir, socialRenderManifestPath);

  for (const preset of socialRenderPresets) {
    await rm(path.join(resolvedBuildDir, "assets/social", preset.id), {
      force: true,
      recursive: true,
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

async function main() {
  const manifest = await buildSocialRenderManifest();
  console.log(
    `Prepared ${manifest.assets.length} content-addressed social render definitions (${manifest.version.slice(0, 12)}).`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
