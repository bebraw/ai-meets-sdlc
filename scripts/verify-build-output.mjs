import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

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
const fontSubsetCharacters = new Set(
  [...(await readFile(fontSubsetCharactersPath, "utf8"))].filter(
    (character) => !/\s/u.test(character),
  ),
);

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
