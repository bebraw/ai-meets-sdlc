import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkWorkflowUi } from "./workflows-ui.mjs";

const toolkitDir = fileURLToPath(new URL("../", import.meta.url));
const project = await mkdtemp(join(tmpdir(), "event-toolkit-consumer-"));
const packDirectory = resolve(process.env.TOOLKIT_PACK_DESTINATION || project);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const samples = {
  badges: "badges_export_pdf",
  lanyards: "lanyards_count",
  "registration-import": "registration_import_csv",
  "venue-signs": "venue_signs_export_pdf",
  "table-tents": "table_tents_export_pdf",
  catering: "catering_prepare_brief",
  "programme-feed": "programme_build_feed",
  schedule: "schedule_render",
  "talk-graphics": "talk_graphics_export",
  "organizer-directory": "organizers_list",
  "check-in": "checkin_roster",
  "poster-proposals": "posters_call",
  "dinner-rsvps": "dinner_list",
  "speaker-workspace": "speaker_programme",
  "audience-qa": "qa_rooms",
  "event-feedback": "feedback_publish_form",
  "attendee-messages": "messages_audience",
  newsletter: "newsletter_subscribers",
  "publication-queue": "publication_list",
};

function checkBadgePdf(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-"));
  assert.equal([...text.matchAll(/\/Type \/Page\b/gu)].length, 3);
  const media = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/u.exec(text);
  assert.ok(media, "PDF includes physical page dimensions");
  for (const size of media.slice(1))
    assert.ok(Math.abs((Number(size) * 25.4) / 72 - 106) < 0.5);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = once(child, "exit");
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
function startCli(cmd, env) {
  const child = spawn(process.execPath, [cmd, "ui"], {
    cwd: project,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const origin = new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Timed out starting the packaged UI: " + output)),
      15000,
    );
    function read(data) {
      output += data.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    }
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("UI exited with " + code + " " + output));
    });
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return { child, origin };
}

let ui, mcp, browser;
try {
  await mkdir(packDirectory, { recursive: true });
  await writeFile(
    join(project, "package.json"),
    JSON.stringify({
      name: "independent-organizer",
      version: "1.0.0",
      type: "module",
      private: true,
      devDependencies: {
        "@types/node": createRequire(import.meta.url)("../package.json")
          .devDependencies["@types/node"],
      },
    }),
  );
  const [packed] = JSON.parse(
    execFileSync(npm, ["pack", "--pack-destination", packDirectory, "--json"], {
      cwd: toolkitDir,
      encoding: "utf8",
    }),
  );
  execFileSync(
    npm,
    [
      "install",
      process.env.TOOLKIT_CONSUMER_OFFLINE === "1"
        ? "--offline"
        : "--prefer-offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(packDirectory, packed.filename),
    ],
    { cwd: project, stdio: "inherit", timeout: 180000 },
  );
  const lock = JSON.parse(
    await readFile(join(project, "package-lock.json"), "utf8"),
  );
  for (const folder of Object.keys(lock.packages))
    assert.doesNotMatch(
      folder,
      /node_modules\/(?:wrangler|gustwind|miniflare|@cloudflare\/)/u,
    );
  const installed = createRequire(join(project, "package.json"));
  const metadata = installed("@sdlcai/event-toolkit/package.json");
  const installedDir = join(
    project,
    "node_modules",
    "@sdlcai",
    "event-toolkit",
  );
  execFileSync(
    process.execPath,
    [join(installedDir, "examples", "badges.mjs")],
    {
      cwd: project,
      timeout: 30000,
    },
  );
  checkBadgePdf(await readFile(join(project, "badges.pdf")));
  const command = join(
    project,
    "node_modules",
    "@sdlcai",
    "event-toolkit",
    metadata.bin["event-toolkit"],
  );
  const { chromium } = installed("playwright");
  const { Client } = installed("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = installed(
    "@modelcontextprotocol/sdk/client/stdio.js",
  );
  const { createToolkit } = await import(
    installed.resolve("@sdlcai/event-toolkit")
  );
  const small = createToolkit({ enabled: ["lanyards"] });
  assert.deepEqual(
    small.catalog().map((block) => block.id),
    ["lanyards"],
  );
  assert.equal(
    (await small.run("lanyards_count", { people: [{ role: "speaker" }] }))
      .total,
    1,
  );
  await assert.rejects(
    () => small.run("badges_preflight", { people: [] }),
    /unknown operation/iu,
  );
  await small.close();

  // Both processes share the fictional organizer’s SQLite store.
  const env = {
    ...Object.fromEntries(
      [
        "HOME",
        "PATH",
        "TMPDIR",
        "TEMP",
        "USERPROFILE",
        "SystemRoot",
        "PLAYWRIGHT_BROWSERS_PATH",
        "TOOLKIT_CHROMIUM_PATH",
      ]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    ),
    TOOLKIT_PORT: "0",
    TOOLKIT_EVENT: "field-notes",
    TOOLKIT_DATA_DIR: join(project, "data"),
    TOOLKIT_ACCESS_TOKEN: "consumer-test-organizer",
  };
  ui = startCli(command, env);
  const origin = await ui.origin;
  mcp = new Client({ name: "consumer-check", version: "1.0.0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [command, "mcp"],
      cwd: project,
      env,
      stderr: "inherit",
    }),
  );
  const tools = (await mcp.listTools()).tools;
  for (const tool of tools)
    assert.ok(
      tool.outputSchema?.properties,
      tool.name + " documents its result",
    );
  const catalogResource = await mcp.readResource({
    uri: "event-toolkit://catalog",
  });
  const catalog = JSON.parse(catalogResource.contents[0].text);
  const names = catalog.flatMap((block) =>
    block.operations.map((operation) => operation.name),
  );
  await copyFile(
    new URL("./typed-consumer.mts", import.meta.url),
    join(project, "consumer.mts"),
  );
  await writeFile(
    join(project, "catalog-names.mts"),
    [
      'import type { OperationName } from "@sdlcai/event-toolkit";',
      "const names = " +
        JSON.stringify(names) +
        " as const satisfies readonly OperationName[];",
      "const complete: Exclude<OperationName, typeof names[number]> extends never ? true : false = true;",
      "void complete;",
    ].join("\n"),
  );
  execFileSync(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("typescript/bin/tsc"),
      "--noEmit",
      "--strict",
      "--types",
      "node",
      "--module",
      "NodeNext",
      "--target",
      "ES2023",
      "consumer.mts",
      "catalog-names.mts",
    ],
    { cwd: project, stdio: "inherit", timeout: 30000 },
  );
  assert.deepEqual(
    catalog.map((b) => b.id).sort(),
    Object.keys(samples).sort(),
  );
  const guide = await readFile(join(installedDir, "GUIDE.md"), "utf8");
  const documentedBlocks = Array.from(
    guide.matchAll(/^\|[^|\n]+\|\s*`([a-z0-9-]+)`\s*\|/gm),
    (row) => row[1],
  );
  assert.deepEqual(
    documentedBlocks.sort(),
    catalog.map((block) => block.id).sort(),
    "The installed organizer guide must cover every available block exactly once.",
  );
  browser = await chromium.launch({
    executablePath: env.TOOLKIT_CHROMIUM_PATH || undefined,
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const session = await page.request.post(origin + "/api/session", {
    headers: { origin },
    data: { token: env.TOOLKIT_ACCESS_TOKEN },
  });
  assert.equal(session.status(), 200);
  const uiCatalog = await (
    await page.request.get(origin + "/api/catalog")
  ).json();
  assert.deepEqual(
    uiCatalog.blocks.map((b) => b.id).sort(),
    Object.keys(samples).sort(),
  );

  async function callUi(block, operation, input, edit) {
    const params = new URLSearchParams({ block, operation });
    if (input) params.set("input", JSON.stringify(input));
    await page.goto(origin + "/#" + params);
    try {
      await page.waitForFunction(
        (name) =>
          document.querySelector("#operation")?.value === name &&
          !document.querySelector("#run").disabled,
        operation,
      );
    } catch (error) {
      throw new Error(
        "Could not open " +
          operation +
          ": " +
          (await page.locator("body").innerText()).slice(-1800) +
          "; browser errors: " +
          pageErrors.join(", "),
        { cause: error },
      );
    }
    if (!input) await page.locator("#example").click();
    else
      await page.waitForFunction(
        (expected) =>
          JSON.stringify(
            JSON.parse(document.querySelector("#input-json").value),
          ) === JSON.stringify(expected),
        input,
      );
    if (edit) await edit();
    const completed = page.waitForResponse(
      (response) =>
        response.url() === origin + "/api/run/" + operation &&
        response.request().method() === "POST",
    );
    await page.locator("#run").click();
    const response = await completed;
    return { status: response.status(), body: await response.json() };
  }
  async function callMcp(operation, input) {
    const result = await mcp.callTool({ name: operation, arguments: input });
    assert.ok(
      !result.isError,
      operation + " failed: " + JSON.stringify(result.content),
    );
    return result.structuredContent;
  }

  for (const block of catalog) {
    // Exercise the published example independently, with no prior data or other
    // enabled blocks. This also detects accidental cross-block dependencies.
    const demo = join(
      project,
      "node_modules/@sdlcai/event-toolkit/examples/try-block.mjs",
    );
    const output = execFileSync(process.execPath, [demo, block.id], {
      cwd: project,
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(JSON.parse(output).operation, block.operations[0].name);
    const name = samples[block.id],
      spec = block.operations.find((op) => op.name === name);
    assert.ok(
      spec && tools.some((op) => op.name === name),
      block.id + " tool discovered",
    );
    const uiRun = await callUi(block.id, name);
    assert.equal(
      uiRun.status,
      200,
      name + " via UI: " + JSON.stringify(uiRun.body),
    );
    assert.ok(uiRun.body.data !== undefined, name + " returned a UI result");
    // The UI published the first questionnaire to shared storage; publishing again uses its new revision.
    const mcpInput =
      name === "feedback_publish_form"
        ? { ...spec.example, revision: 1 }
        : spec.example;
    const mcpResult = await callMcp(name, mcpInput);
    assert.ok(
      mcpResult && Object.keys(mcpResult).length,
      name + " returned structured data",
    );
    if (name === "programme_build_feed") {
      // Blank required collections and a nullable summary can be supplied by the form.
      const { id, title, contentStatus, url } = spec.example.sessions[0];
      const form = await callUi(block.id, name, {
        event: spec.example.event,
        updatedAt: spec.example.updatedAt,
        sessions: [{ id, title, contentStatus, url }],
      });
      assert.equal(form.status, 200, JSON.stringify(form.body));
      assert.deepEqual(form.body.data.feed.speakers, []);
      assert.deepEqual(form.body.data.feed.sessions[0].speakerIds, []);
      assert.equal(form.body.data.feed.sessions[0].summary, null);
    }
    if (name === "lanyards_count") {
      const excluded = await callUi(block.id, name, undefined, async () => {
        const included = page.locator('[data-path="people.0.included"]');
        assert.equal(await included.isChecked(), true);
        await included.uncheck();
      });
      assert.equal(excluded.body.data.total, mcpResult.total - 1);
    }
    if (name === "registration_import_csv") {
      const previous = mcpResult.records.map((record) => ({
        ...record,
        badge: false,
        type: "volunteer",
      }));
      const refreshed = await callUi(block.id, name, {
        ...spec.example,
        previous,
      });
      assert.deepEqual(refreshed.body.data.records, previous);
    }
    if (name === "badges_export_pdf") {
      assert.equal(uiRun.body.data.ready, true);
      assert.equal(mcpResult.ready, true);
      checkBadgePdf(
        await (await page.request.get(origin + uiRun.body.artifact.url)).body(),
      );
      const resource = await mcp.readResource({ uri: mcpResult.artifact.uri });
      checkBadgePdf(Buffer.from(resource.contents[0].blob, "base64"));
      const branded = {
        ...spec.example,
        colors: [
          { role: "speaker", foreground: "#34204b", background: "#d4c5df" },
        ],
      };
      const preview = await callUi(block.id, "badges_preflight", branded);
      const agentPreview = await callMcp("badges_preflight", branded);
      const selector = page.getByLabel("Badge to preview");
      const proof = page.locator(".badge-artwork svg");
      await selector.selectOption("people.2");
      await proof.getByText("Ari Chen", { exact: true }).waitFor();
      assert.equal(await proof.getAttribute("width"), "106mm");
      assert.equal(
        await proof
          .locator('[data-badge-outline="bleed"]')
          .getAttribute("fill"),
        "#d4c5df",
      );
      assert.equal(
        await proof.locator(":scope > g").getAttribute("fill"),
        "#34204b",
      );
      assert.equal(
        await proof.locator("image").getAttribute("href"),
        spec.example.logo,
      );
      assert.ok(
        await proof.evaluate((svg) =>
          document.fonts.check(
            '16px "' +
              svg.querySelector("text").getAttribute("font-family") +
              '"',
          ),
        ),
      );
      const shape = page.getByLabel("Shape", { exact: true });
      const font = page.getByLabel("Font", { exact: true });
      await shape.selectOption({ label: "Rounded square" });
      await font.selectOption({ label: "Lora" });
      await proof.locator('[data-badge-outline="trim"][rx]').waitFor();
      assert.equal(
        await proof.getAttribute("data-badge-shape"),
        "rounded-square",
      );
      assert.ok(await proof.locator('[data-badge-outline="safe"]').isVisible());
      await page.locator('[data-path="people.1.name"]').fill("Kaisa Vale");
      await proof.getByText("Kaisa Vale", { exact: true }).waitFor();
      await selector.selectOption("spares.1");
      await proof.getByText("ATTENDEE", { exact: true }).waitFor();
      assert.equal(
        await proof.getAttribute("aria-label"),
        "Spare attendee badge",
      );
      await page
        .locator('[data-path="logo"]')
        .fill("data:image/png;base64,AAAA");
      await page
        .locator("#badge-findings")
        .getByText("The supplied badge logo could not be decoded.")
        .waitFor();
      const uiPng = await (
        await page.request.get(origin + preview.body.artifact.url)
      ).body();
      const mcpPng = (
        await mcp.readResource({ uri: agentPreview.artifact.uri })
      ).contents[0].blob;
      for (const encoded of [uiPng.toString("base64"), mcpPng]) {
        const logoPresent = await page.evaluate(async (encoded) => {
          const image = new Image();
          image.src = "data:image/png;base64," + encoded;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(
            0,
            0,
            canvas.width,
            Math.floor(canvas.height / 2),
          ).data;
          for (let i = 0; i < pixels.length; i += 4)
            if (
              pixels[i] === 0x77 &&
              pixels[i + 1] === 0x46 &&
              pixels[i + 2] === 0xb5
            )
              return true;
          return false;
        }, encoded);
        assert.ok(
          logoPresent,
          "the consumer's purple logo is visible on the generated proof",
        );
      }
      const invalid = structuredClone(spec.example);
      invalid.people[0].name = "Unsupported \u{10ffff}";
      const uiBad = await callUi(block.id, name, invalid);
      const mcpBad = await callMcp(name, invalid);
      assert.equal(uiBad.status, 200);
      assert.equal(uiBad.body.data.ready, false);
      assert.equal(mcpBad.ready, false);
      assert.deepEqual(uiBad.body.data.issues, mcpBad.issues);
      assert.equal(mcpBad.issues[0].row, 1);
      assert.ok(!uiBad.body.artifact && !mcpBad.artifact);
      await page
        .locator("#badge-findings")
        .getByText(/Font lacks:/)
        .waitFor();
      assert.equal(await selector.inputValue(), "people.1");
      await selector.selectOption("people.2");
      await page
        .locator("#badge-findings")
        .getByText("This badge fits the print area.")
        .waitFor();
    }
    console.log(
      "Verified package, browser UI and MCP discovery for " + block.id,
    );
  }
  const member = await callMcp("organizers_create", {
    name: "Kai Vale",
    visible: true,
  });
  const details = {
    ...member,
    name: "Kai Vale II",
    company: "",
    visible: true,
    badge: false,
    position: 1,
  };
  await callMcp("organizers_update", details);
  const changed = await callUi("organizer-directory", "organizers_list");
  assert.ok(
    changed.body.data.people.some(
      (p) => p.id === member.id && p.name === "Kai Vale II" && p.revision === 2,
    ),
  );
  const stale = await callUi(
    "organizer-directory",
    "organizers_update",
    details,
  );
  assert.equal(stale.status, 409);
  await checkWorkflowUi(page, origin, callMcp);
  assert.deepEqual(pageErrors, []);
  console.log("All 19 blocks passed the independent consumer check.");
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await mcp?.close();
    } finally {
      await stop(ui?.child);
      await rm(project, { recursive: true, force: true });
    }
  }
}
