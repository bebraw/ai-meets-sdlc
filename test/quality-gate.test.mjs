import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runQualityGate } from "../scripts/quality-gate.mjs";
import { expectConsoleErrors } from "./helpers/expected-console-errors.mjs";

for (const [name, source] of [
  ["plain console errors", 'console.error("simulated Worker outage");'],
  [
    "colored Worker errors split across output chunks",
    String.raw`process.stdout.write("\x1b[31m✘ \x1b[41;31m[\x1b[41;97mERR");
      setTimeout(() => process.stdout.write("OR\x1b[41;31m]\x1b[0m outage\n"), 30);`,
  ],
  ["fatal stderr logs", 'process.stderr.write("[FATAL] outage\\n");'],
]) {
  test(
    `quality gate stops immediately on ${name} and skips later steps`,
    { timeout: 10_000 },
    async (t) => {
      const directory = await mkdtemp(path.join(tmpdir(), "sdlcai-gate-test-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const marker = path.join(directory, "later-step");
      let output = "";
      const stream = { write: (chunk) => (output += chunk) };
      const result = await runQualityGate(
        [
          step("fault", `${source} setInterval(() => {}, 60_000);`),
          step(
            "later",
            `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");`,
          ),
        ],
        { stdout: stream, stderr: stream },
      );
      assert.equal(result, 1);
      assert.match(output, /fault emitted an unexpected error log/u);
      await assert.rejects(access(marker), { code: "ENOENT" });
    },
  );
}

test("quality gate rejects a nonzero exit and a command that cannot start", async () => {
  const stream = { write() {} };
  for (const failed of [
    step("exit", "process.exitCode = 7;"),
    { name: "missing", command: "/nonexistent/sdlcai-command", args: [] },
  ]) {
    assert.equal(
      await runQualityGate([failed], { stdout: stream, stderr: stream }),
      1,
    );
  }
});

test("quality gate runs all successful steps and permits warnings", async () => {
  let output = "";
  const stream = { write: (chunk) => (output += chunk) };
  assert.equal(
    await runQualityGate(
      [
        step("first", 'console.warn("[WARNING] diagnostic");'),
        step("second", 'console.log("completed final check");'),
      ],
      { stdout: stream, stderr: stream },
    ),
    0,
  );
  assert.match(output, /completed final check/u);
});

test("expected error capture checks exact logs and restores console.error", async (t) => {
  const original = console.error;
  await expectConsoleErrors(t, ["intentional { count: 1 }"], async () => {
    console.error("intentional", { count: 1 });
  });
  assert.equal(console.error, original);
  const result = await expectConsoleErrors(
    t,
    (id) => [`intentional ${id}`],
    async () => {
      console.error("intentional", "record-id");
      return "record-id";
    },
  );
  assert.equal(result, "record-id");
  for (const action of [
    async () => {},
    async () => {
      console.error("intentional");
      console.error("unexpected");
    },
  ]) {
    await assert.rejects(expectConsoleErrors(t, ["intentional"], action), {
      code: "ERR_ASSERTION",
    });
    assert.equal(console.error, original);
  }
});

function step(name, source) {
  return { name, command: process.execPath, args: ["-e", source] };
}
