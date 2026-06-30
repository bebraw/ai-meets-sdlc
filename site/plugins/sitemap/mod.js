import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const excludedPaths = new Set(["/404/", "/admin/"]);

const plugin = {
  meta: {
    name: "sdlcai-sitemap-plugin",
    description: "Writes sitemap.xml while excluding noindex pages.",
    dependsOn: ["gustwind-meta-plugin"],
  },
  init({ cwd, outputDirectory }) {
    return {
      finishBuild: async ({ send }) => {
        const meta = await send("gustwind-meta-plugin", {
          type: "getMeta",
          payload: undefined,
        });
        const sitemapXML = await buildSitemapXml({
          siteUrl: meta.url,
          outputDirectory: path.join(cwd, outputDirectory),
        });

        return [
          {
            type: "writeTextFile",
            payload: {
              outputDirectory,
              file: "sitemap.xml",
              data: sitemapXML,
            },
          },
        ];
      },
    };
  },
};

async function buildSitemapXml({ siteUrl, outputDirectory }) {
  const entries = await listPublicPaths(outputDirectory);
  const urls = [];

  for (const entry of entries) {
    if (entry === "sitemap.xml") continue;

    const pathname = toSitemapPath(entry);

    if (excludedPaths.has(pathname)) continue;
    if (await isNoindexHtml(path.join(outputDirectory, entry))) continue;

    urls.push(
      [
        "  <url>",
        `    <loc>${escapeXml(urlJoin(siteUrl, pathname))}</loc>`,
        "  </url>",
      ].join("\n"),
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
  ].join("\n");
}

async function listPublicPaths(directoryPath, parentPath = "") {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const publicPaths = [];

  for (const entry of entries) {
    const relativePath = parentPath
      ? path.join(parentPath, entry.name)
      : entry.name;
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      publicPaths.push(...(await listPublicPaths(absolutePath, relativePath)));
      continue;
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith(".html") || entry.name.endsWith(".xml"))
    ) {
      publicPaths.push(relativePath);
    }
  }

  return publicPaths;
}

async function isNoindexHtml(filePath) {
  if (!filePath.endsWith(".html")) return false;

  const html = await readFile(filePath, "utf8");

  return /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html);
}

function toSitemapPath(relativePath) {
  if (relativePath === "index.html") {
    return "/";
  }

  if (relativePath.endsWith(path.join(path.sep, "index.html"))) {
    const withoutIndex = relativePath.slice(0, -"index.html".length);

    return `/${withoutIndex.replaceAll(path.sep, "/")}`;
  }

  return `/${relativePath.replaceAll(path.sep, "/")}`;
}

function urlJoin(...parts) {
  return parts
    .filter(Boolean)
    .reduce((ret, part, index) => {
      if (!index) return part.replace(/\/+$/, "");

      return `${ret.replace(/\/+$/, "")}/${part.replace(/^\/+/, "")}`;
    }, "")
    .replace(/(?<!:)\/{2,}/g, "/");
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export { plugin };
