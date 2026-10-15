import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, writeFile, rename } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { Zip, ZipPassThrough } from "fflate";
import {
  applyCuration,
  attribution,
  categories,
  curationPath as defaultCurationPath,
  defaultOutput,
  exportCatalog,
  originalFile,
  readJson,
  readCuration,
  repoRoot,
  selections,
} from "./catalog.mjs";
import {
  originalContentType,
  photoDownloadName,
} from "../../site/scripts/photo-files.ts";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const output = path.resolve(option("--output", defaultOutput));
const curationPath = path.resolve(option("--curation", defaultCurationPath));
const port = Number(option("--port", "3010"));
const inventory = await readJson(path.join(output, "inventory.json"));
const sourceManifest = await readJson(path.join(output, "source.json"));
const byId = new Map(inventory.photos.map((photo) => [photo.id, photo]));
const talkIds = new Set(inventory.talks.map((talk) => talk.id));
const speakerIds = new Set(inventory.speakers.map((speaker) => speaker.id));
let writing = Promise.resolve();

async function catalog() {
  return applyCuration(inventory, await readCuration(curationPath));
}

async function jsonBody(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Send JSON.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

function json(response, value, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function reviewFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid review.");
  if (
    !categories.includes(body.category) ||
    !selections.includes(body.selection)
  )
    throw new Error("Choose a valid category and selection.");
  const result = { category: body.category, selection: body.selection };
  for (const field of ["caption", "altText", "associationEvidence", "notes"]) {
    if (typeof body[field] !== "string" || body[field].length > 2000)
      throw new Error(`Invalid ${field}.`);
    result[field] = body[field].trim();
  }
  for (const [field, allowed] of [
    ["relatedTalkIds", talkIds],
    ["depictedSpeakerIds", speakerIds],
    ["tags", null],
  ]) {
    const values = body[field];
    if (
      !Array.isArray(values) ||
      values.length > 20 ||
      values.some(
        (value) =>
          typeof value !== "string" ||
          value.length > 100 ||
          (allowed && !allowed.has(value)),
      )
    )
      throw new Error(`Invalid ${field}.`);
    result[field] = [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
  }
  if (result.depictedSpeakerIds.length && !result.associationEvidence)
    throw new Error("Record how the depicted people were confirmed.");
  return result;
}

async function serveFile(request, response, filename, type, download) {
  const info = await stat(filename);
  response.writeHead(200, {
    "content-type": type,
    "content-length": info.size,
    ...(download
      ? {
          "content-disposition": `attachment; filename="${download.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        }
      : {}),
  });
  if (request.method === "HEAD") response.end();
  else
    createReadStream(filename)
      .on("error", () => response.destroy())
      .pipe(response);
}

async function downloadZip(response, ids, variant) {
  const current = await catalog();
  let blocked = Promise.resolve();
  const zip = new Zip((error, bytes, final) => {
    if (error) {
      response.destroy(error);
      return;
    }
    if (!response.write(bytes)) blocked = once(response, "drain");
    if (final) response.end();
  });
  const addFile = async (name, filename) => {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    for await (const bytes of createReadStream(filename)) {
      if (response.destroyed) throw new Error("Download disconnected.");
      entry.push(bytes, false);
      await blocked;
    }
    entry.push(new Uint8Array(), true);
    await blocked;
  };
  const selected = current.photos.filter((photo) => ids.includes(photo.id));
  response.writeHead(200, {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="sdlcai-2026-${variant}-${selected.length}-photos.zip"`,
  });
  try {
    for (const photo of selected) {
      const filename =
        variant === "original"
          ? originalFile(photo, sourceManifest)
          : path.join(output, photo.images.share.path);
      await addFile(photoDownloadName(photo.filename, variant), filename);
    }
    const credits = new ZipPassThrough("CREDITS.txt");
    zip.add(credits);
    credits.push(
      new TextEncoder().encode(
        `SDLCAI 2026\n${current.license}: ${current.licenseUrl}\nCredit the photographer and link to the license. Indicate any further edits.\n\n${selected.map((photo) => attribution(photo, current, variant)).join("\n\n")}\n`,
      ),
      true,
    );
    const metadata = new ZipPassThrough("catalog.json");
    zip.add(metadata);
    metadata.push(
      new TextEncoder().encode(
        JSON.stringify(
          {
            eventId: current.eventId,
            license: current.license,
            licenseUrl: current.licenseUrl,
            photos: selected,
          },
          null,
          2,
        ),
      ),
      true,
    );
    zip.end();
  } catch (error) {
    zip.terminate();
    response.destroy(error);
  }
}

const server = createServer(async (request, response) => {
  try {
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (!hosts.has(request.headers.host))
      return json(response, { error: "Host not accepted." }, 403);
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("referrer-policy", "no-referrer");
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const read = request.method === "GET" || request.method === "HEAD";
    if (
      !read &&
      !hosts.has(new URL(request.headers.origin ?? "http://invalid").host)
    )
      return json(response, { error: "Origin not accepted." }, 403);
    if (request.method === "GET" && url.pathname === "/api/catalog")
      return json(response, await catalog());
    const edit = /^\/api\/photos\/(photo-[a-f0-9]{20})$/.exec(url.pathname);
    if (request.method === "POST" && edit) {
      const photoId = edit[1];
      if (!byId.has(photoId))
        return json(response, { error: "Photo not found." }, 404);
      const body = await jsonBody(request),
        fields = reviewFields(body);
      const save = writing.then(async () => {
        const curation = await readCuration(curationPath);
        const previous = curation.photos[photoId];
        if ((body.revision ?? 0) !== (previous?.revision ?? 0))
          return json(
            response,
            {
              error:
                "This photo changed in another window. Reload before saving.",
            },
            409,
          );
        curation.photos[photoId] = {
          ...fields,
          revision: (previous?.revision ?? 0) + 1,
        };
        await writeFile(
          `${curationPath}.tmp`,
          JSON.stringify(curation, null, 2) + "\n",
        );
        await rename(`${curationPath}.tmp`, curationPath);
        const updated = applyCuration(inventory, curation);
        await exportCatalog(updated, output);
        return json(
          response,
          updated.photos.find((photo) => photo.id === photoId),
        );
      });
      writing = save.catch(() => {});
      return await save;
    }
    if (request.method === "POST" && url.pathname === "/api/download") {
      const body = await jsonBody(request);
      if (
        !Array.isArray(body.ids) ||
        !body.ids.length ||
        body.ids.length > inventory.photos.length ||
        body.ids.some((id) => !byId.has(id)) ||
        !["original", "share"].includes(body.variant)
      )
        return json(
          response,
          { error: "Choose photos and a valid download size." },
          400,
        );
      return await downloadZip(response, [...new Set(body.ids)], body.variant);
    }
    const image =
      /^\/images\/(photo-[a-f0-9]{20})\/(thumbnail|preview|share)\.jpg$/.exec(
        url.pathname,
      );
    if (read && image && byId.has(image[1]))
      return await serveFile(
        request,
        response,
        path.join(output, byId.get(image[1]).images[image[2]].path),
        "image/jpeg",
      );
    const download =
      /^\/download\/(photo-[a-f0-9]{20})\/(original|share)$/.exec(url.pathname);
    if (read && download && byId.has(download[1])) {
      const photo = byId.get(download[1]),
        variant = download[2];
      return await serveFile(
        request,
        response,
        variant === "original"
          ? originalFile(photo, sourceManifest)
          : path.join(output, photo.images.share.path),
        variant === "original"
          ? originalContentType(photo.filename)
          : "image/jpeg",
        photoDownloadName(photo.filename, variant),
      );
    }
    if (
      read &&
      [
        "/catalog.json",
        "/catalog.csv",
        "/CREDITS.txt",
        "/curation.json",
        "/collections.json",
      ].includes(url.pathname)
    ) {
      await writing;
      await exportCatalog(await catalog(), output);
      const name = url.pathname.slice(1);
      return await serveFile(
        request,
        response,
        name === "curation.json" ? curationPath : path.join(output, name),
        name.endsWith(".json")
          ? "application/json"
          : "text/plain; charset=utf-8",
        name,
      );
    }
    if (read && url.pathname === "/assets/favicon.svg")
      return await serveFile(
        request,
        response,
        path.join(repoRoot, "assets/favicon.svg"),
        "image/svg+xml",
      );
    if (
      read &&
      /^\/assets\/fonts\/Finlandica(Headline-Black|Text-Regular|Text-Bold)\.woff2$/.test(
        url.pathname,
      )
    )
      return await serveFile(
        request,
        response,
        path.join(repoRoot, url.pathname),
        "font/woff2",
      );
    if (read && url.pathname === "/")
      return await serveFile(
        request,
        response,
        path.join(repoRoot, "site/layouts/photos.html"),
        "text/html; charset=utf-8",
      );
    json(response, { error: "Not found." }, 404);
  } catch (error) {
    if (response.headersSent) response.destroy(error);
    else
      json(
        response,
        { error: error.message },
        error.code === "ENOENT" ? 404 : 400,
      );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Photo media bank: http://127.0.0.1:${port}/`),
);
