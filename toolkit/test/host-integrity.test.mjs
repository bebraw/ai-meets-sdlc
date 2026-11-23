import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startWeb } from "../http.mjs";
import { createToolkit } from "../index.mjs";
import { createMcpServer } from "../mcp.mjs";
import { openStorage } from "../storage.mjs";
import { splitResult } from "../artifacts.mjs";

const execute = promisify(execFile);

test("network hosts require explicit, distinct principals and a bare public origin", async () => {
  const toolkit = createToolkit({ enabled: [] });
  const settings = {
    toolkit,
    host: "0.0.0.0",
    publicOrigin: "https://gathering.example",
    port: 0,
  };
  const principal = { actor: "host", role: "organizer", token: "fixture" };
  await assert.rejects(startWeb(settings), /explicit access credentials/);
  await assert.rejects(
    startWeb({ ...settings, principals: [principal], publicOrigin: undefined }),
    /public origin/,
  );
  await assert.rejects(
    startWeb({
      ...settings,
      principals: [principal, { ...principal, role: "staff" }],
    }),
    /exactly one principal/,
  );
  await assert.rejects(
    startWeb({
      ...settings,
      principals: [principal],
      publicOrigin: "https://gathering.example/hidden",
    }),
    /public origin/,
  );
  assert.throws(() => createMcpServer(toolkit), /explicit role and actor/);
  await toolkit.close();
});

test("the public workspace serves badge proofs, artwork and the packaged font", async (t) => {
  const toolkit = createToolkit({ enabled: ["badges"] });
  const web = await startWeb({ toolkit, port: 0 });
  t.after(async () => {
    await web.close();
    await toolkit.close();
  });
  for (const [path, type] of [
    ["/badge-proof.js", "text/javascript"],
    ["/badge-artwork.mjs", "text/javascript"],
    ["/badge-font.ttf", "font/ttf"],
  ]) {
    const response = await fetch(new URL(path, web.origin));
    assert.equal(response.status, 200, path);
    assert.equal(
      response.headers.get("content-type").split(";")[0],
      type,
      path,
    );
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
});

test("concurrent processes initialize one durable key and event database; mismatched backups are rejected", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "event-toolkit-host-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const storageModule = new URL("../storage.mjs", import.meta.url).href;
  const worker = `import {openStorage} from ${JSON.stringify(storageModule)};
    const storage=openStorage({directory:process.argv[1], eventId:"weekend"});
    const connection=storage.event();
    console.log(connection.fingerprint("example"));
    storage.close();`;
  const workers = await Promise.all(
    Array.from({ length: 8 }, () =>
      execute(process.execPath, [
        "--input-type=module",
        "-e",
        worker,
        directory,
      ]),
    ),
  );
  assert.equal(new Set(workers.map((child) => child.stdout.trim())).size, 1);
  const options = { directory, eventId: "weekend" };
  const storage = openStorage(options);
  const ciphertext = storage.event().seal("sample response");
  storage.close();
  const filename = join(directory, "encryption.key"),
    backup = filename + ".saved";
  const original = await readFile(filename);
  await rename(filename, backup);
  assert.throws(() => openStorage(options), /missing its encryption key/);
  await writeFile(filename, randomBytes(32), { mode: 0o600 });
  const wrong = openStorage(options);
  assert.throws(() => wrong.event(), /key does not match/);
  wrong.close();
  await writeFile(filename, original);
  const restored = openStorage(options);
  assert.equal(restored.event().open(ciphertext), "sample response");
  restored.close();
});

test("injected storage opens once on demand, isolates scopes, and closes after outstanding work", async () => {
  assert.deepEqual(splitResult(null), { data: null, file: null });
  assert.throws(() => openStorage({ eventId: "../invalid" }), /event ID/);
  const calls = [];
  const started = Promise.withResolvers(),
    finish = Promise.withResolvers();
  const toolkit = createToolkit({
    enabled: ["lanyards", "audience-qa", "newsletter"],
    eventId: "weekend",
    async storage(options) {
      calls.push("open:" + options.eventId);
      const sqlite = openStorage(options);
      return {
        event() {
          calls.push("event");
          return sqlite.event();
        },
        shared() {
          calls.push("shared");
          return sqlite.shared();
        },
        close() {
          calls.push("close");
          sqlite.close();
        },
      };
    },
    services: {
      async sendMail() {
        started.resolve();
        await finish.promise;
      },
    },
  });
  const example = (name) =>
    toolkit
      .catalog()
      .flatMap((block) => block.operations)
      .find((op) => op.name === name).example;
  await toolkit.run("lanyards_count", example("lanyards_count"));
  await assert.rejects(
    toolkit.run("qa_configure_room", example("qa_configure_room"), {
      role: "public",
      actor: "guest",
    }),
    { status: 403 },
  );
  assert.deepEqual(calls, []);
  await Promise.all([toolkit.run("qa_rooms"), toolkit.run("qa_rooms")]);
  await toolkit.run("newsletter_configure", example("newsletter_configure"));
  const pending = toolkit.run(
    "newsletter_subscribe",
    example("newsletter_subscribe"),
  );
  await started.promise;
  const close = toolkit.close();
  assert.deepEqual(calls, ["open:weekend", "event", "shared"]);
  await assert.rejects(toolkit.run("qa_rooms"), /closed/);
  finish.resolve();
  await pending;
  await close;
  await toolkit.close();
  assert.deepEqual(calls, ["open:weekend", "event", "shared", "close"]);
});

test("a recoverable storage initialization failure can be retried", async (t) => {
  let attempts = 0;
  const toolkit = createToolkit({
    enabled: ["audience-qa"],
    storage(options) {
      if (++attempts === 1) throw new Error("temporarily unavailable");
      return openStorage(options);
    },
  });
  t.after(() => toolkit.close());
  await assert.rejects(toolkit.run("qa_rooms"), /temporarily unavailable/);
  assert.deepEqual((await toolkit.run("qa_rooms")).rooms, []);
  assert.equal(attempts, 2);
});
