import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import { unzipSync } from "fflate";
import { readCuration, defaultOutput, repoRoot } from "./catalog.mjs";

const temporary = await mkdtemp(path.join(tmpdir(), "sdlcai-photo-check-"));
const port = 3012;
const origin = `http://127.0.0.1:${port}`;
let browser, server;
try {
  for (const name of ["inventory.json", "source.json"])
    await cp(path.join(defaultOutput, name), path.join(temporary, name));
  await writeFile(
    path.join(temporary, "curation.json"),
    JSON.stringify(await readCuration()),
  );
  await symlink(
    path.join(defaultOutput, "images"),
    path.join(temporary, "images"),
  );
  server = spawn(
    process.execPath,
    [
      "scripts/media-bank/review-server.mjs",
      "--output",
      temporary,
      "--curation",
      path.join(temporary, "curation.json"),
      "--port",
      String(port),
    ],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  let serverError = "";
  server.stderr.on("data", (chunk) => {
    serverError += chunk;
  });
  let response;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (server.exitCode !== null)
      throw new Error(serverError || "Review server exited.");
    try {
      response = await fetch(`${origin}/api/catalog`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(response?.ok, "Review server started");
  const catalog = await response.json();
  assert.equal(catalog.photos.length, 188);
  assert.equal(
    catalog.photos.filter(
      (photo) =>
        photo.sourceId === "insta360" && photo.clockShiftSeconds === -3600,
    ).length,
    65,
  );
  assert.equal(
    catalog.photos.filter((photo) => photo.selection === "selected").length,
    30,
  );
  assert.equal(
    catalog.photos.filter((photo) => photo.category === "uncategorized").length,
    0,
  );
  assert.equal(new Set(catalog.photos.map((photo) => photo.sha256)).size, 188);
  const { input } = JSON.parse(
    await readFile(path.join(temporary, "source.json")),
  );
  for (const photo of catalog.photos) {
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(
      path.join(input, photo.filename),
    ))
      hash.update(bytes);
    assert.equal(
      hash.digest("hex"),
      photo.sha256,
      `Source remains unchanged: ${photo.filename}`,
    );
  }
  const first = catalog.photos[0];
  const mutation = (body, requestOrigin = origin) =>
    fetch(`${origin}/api/photos/${first.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: requestOrigin },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await mutation(first, "https://unrelated.example")).status,
    403,
  );
  assert.equal(
    (
      await mutation({
        ...first,
        depictedSpeakerIds: [catalog.speakers[0].id],
        associationEvidence: "",
      })
    ).status,
    400,
  );

  let executablePath;
  for (const candidate of [
    process.env.LAYOUT_BROWSER_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    chromium.executablePath(),
  ].filter(Boolean)) {
    try {
      await access(candidate);
      executablePath = candidate;
      break;
    } catch {}
  }
  browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.locator(".card").last().waitFor();
  assert.equal(await page.locator(".card").count(), 188);
  await page.locator("#selection").selectOption("selected");
  assert.equal(await page.locator(".card").count(), 30);
  await page.reload();
  await page.locator(".card").last().waitFor();
  assert.equal(
    await page.locator(".card").count(),
    30,
    "Collection filters survive reloads",
  );
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.locator("#photographer").selectOption("Bulent Sahin");
  assert.equal(await page.locator(".card").count(), 65);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Open ${first.filename}`, exact: true })
    .click();
  await page
    .getByLabel("Caption", { exact: true })
    .fill("A saved review caption for validation.");
  await page
    .getByRole("button", { name: "Save photo details", exact: true })
    .click();
  await page
    .getByText("Saved to the photo catalog.", { exact: true })
    .waitFor();
  const saved = await (await fetch(`${origin}/api/catalog`)).json();
  assert.equal(
    saved.photos.find((photo) => photo.id === first.id).caption,
    "A saved review caption for validation.",
  );
  assert.equal(
    (await mutation(first)).status,
    409,
    "Stale edits reject instead of replacing a newer review",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await page.locator("#search").fill("A saved review caption for validation.");
  assert.equal(await page.locator(".card").count(), 1);
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  const photoPair = [
    catalog.photos.find((photo) => photo.sourceId === "fujifilm"),
    catalog.photos.find((photo) => photo.sourceId === "insta360"),
  ];
  for (const photo of photoPair)
    await page
      .getByRole("checkbox", {
        name: `Select ${photo.filename} for download`,
        exact: true,
      })
      .check();
  const completed = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download selection ZIP", exact: true })
    .click();
  const download = await completed;
  const files = unzipSync(
    new Uint8Array(await readFile(await download.path())),
  );
  assert.equal(
    Object.keys(files).filter((name) => name.endsWith(".jpg")).length,
    2,
  );
  const credits = new TextDecoder().decode(files["CREDITS.txt"]);
  assert.match(credits, /Juho Vepsäläinen/);
  assert.match(credits, /Bulent Sahin/);
  assert.match(credits, /https:\/\/creativecommons.org\/licenses\/by\/4.0\//);
  assert.match(credits, /Resized and re-encoded/);
  assert.equal(
    JSON.parse(new TextDecoder().decode(files["catalog.json"])).photos.length,
    2,
  );
  const original = await fetch(`${origin}/download/${first.id}/original`);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await original.arrayBuffer()))
      .digest("hex"),
    first.sha256,
  );
  const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Gallery overflow at ${width}px`,
    );
    await page.addScriptTag({ content: axe });
    let violations = await page.evaluate(async () =>
      (
        await window.axe.run({
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map(({ id }) => id),
    );
    assert.deepEqual(violations, [], `Gallery accessibility at ${width}px`);
    await page
      .getByRole("button", { name: `Open ${first.filename}`, exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector("dialog").scrollWidth >
          document.querySelector("dialog").clientWidth,
      ),
      false,
      `Photo detail overflow at ${width}px`,
    );
    violations = await page.evaluate(async () =>
      (
        await window.axe.run("dialog", {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map(({ id }) => id),
    );
    assert.deepEqual(
      violations,
      [],
      `Photo details accessibility at ${width}px`,
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.screenshot({
      path: path.join(defaultOutput, `review-${width}.png`),
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Photo media bank passed: 188 source checksums, 65 clock corrections, categorization, shortlist, filters, saved edits, stale-write protection, credit-bearing ZIPs, original downloads, responsive layouts and accessibility.",
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const ended = once(server, "exit");
    server.kill("SIGTERM");
    await ended;
  }
  await rm(temporary, { recursive: true, force: true });
}
