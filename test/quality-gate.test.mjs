import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  browserGroups,
  runQualityGate,
  selectSteps,
} from "../scripts/quality-gate.mjs";
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

test("CI browser groups cover every browser check exactly once", () => {
  const expected = [
    "activity:browser-check",
    "qa:browser-check",
    "attendees:browser-check",
    "dinner:browser-check",
    "announcements:browser-check",
    "badges:browser-check",
    "speaker-slides:browser-check",
    "layout:check",
    "slides:check",
    "a11y:check",
  ].sort();
  const grouped = Object.keys(browserGroups).flatMap((group) => {
    const steps = selectSteps([`--group=${group}`]);
    assert.equal(steps[0].name, "worker:build");
    return steps.slice(1).map(({ name }) => name);
  });
  assert.deepEqual(grouped.sort(), expected);
  assert.deepEqual(
    selectSteps([])
      .slice(1)
      .map(({ name }) => name)
      .sort(),
    expected,
  );
});

test("integration sharding preserves build/validation and rejects options that could skip checks", () => {
  const steps = selectSteps(["--group=integration", "--shard=2/4"]);
  assert.equal(steps[0].name, "worker:build");
  assert.equal(steps[1].command, process.execPath);
  assert.deepEqual(steps[1].args, ["--test", "--test-shard=2/4"]);
  assert.equal(steps[2].name, "validate");
  for (const args of [
    ["--group=unknown"],
    ["--group=__proto__"],
    ["--group=guests", "--shard=1/4"],
    ["--shard=1/4"],
    ["--group=integration", "--group=integration"],
    ["--group=integration", "--shard=1/4", "--shard=2/4"],
    ["--group=integration", "--unknown"],
    ...["0/4", "5/4", "1/0", "2", "1/4junk", "1/9007199254740992"].map(
      (shard) => ["--group=integration", `--shard=${shard}`],
    ),
  ]) {
    assert.throws(() => selectSteps(args), Error, args.join(" "));
  }
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
