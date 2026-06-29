import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const buildDir = "build";

try {
  await access(path.join(buildDir, "index.html"));
} catch {
  console.error(
    "Build output is missing. Expected Gustwind to generate build/index.html.",
  );
  process.exit(1);
}

const htmlFiles = await getHtmlFiles(buildDir);
const failures = [];

for (const filePath of htmlFiles) {
  const html = await readFile(filePath, "utf8");
  const imageTags = html.match(/<img\b[^>]*>/g) ?? [];

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

async function getHtmlFiles(directory) {
  const entries = await readdir(directory);
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const entryStat = await stat(entryPath);

    if (entryStat.isDirectory()) {
      files.push(...(await getHtmlFiles(entryPath)));
    } else if (entryPath.endsWith(".html")) {
      files.push(entryPath);
    }
  }

  return files;
}
