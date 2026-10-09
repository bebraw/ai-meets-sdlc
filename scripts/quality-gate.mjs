import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const consolePreload = new URL("./quality-console-errors.mjs", import.meta.url);
export const browserGroups = {
  organizers: [
    "activity:browser-check",
    "qa:browser-check",
    "announcements:browser-check",
  ],
  guests: ["attendees:browser-check", "dinner:browser-check"],
  assets: [
    "badges:browser-check",
    "speaker-slides:browser-check",
    "slides:check",
  ],
  presentation: ["layout:check", "a11y:check"],
};
const npmStep = (name) => ({ name, command: "npm", args: ["run", name] });
const defaultSteps = [
  "quality:build",
  ...Object.values(browserGroups).flat(),
].map(npmStep);

// Each CI job uses the same error-log guard as the complete local gate.
// Reject unknown groups and invalid shards instead of silently skipping checks.
export function selectSteps(args) {
  if (!args.length) return defaultSteps;
  let group;
  let shard;
  for (const arg of args) {
    if (arg.startsWith("--group=") && group === undefined) {
      group = arg.slice("--group=".length);
    } else if (arg.startsWith("--shard=") && shard === undefined) {
      shard = arg.slice("--shard=".length);
    } else {
      throw new Error(`Unknown or duplicate quality-gate option: ${arg}`);
    }
  }
  if (group === "integration") {
    if (shard !== undefined) {
      const match = /^([1-9]\d*)\/([1-9]\d*)$/u.exec(shard);
      if (
        !match ||
        !Number.isSafeInteger(Number(match[1])) ||
        !Number.isSafeInteger(Number(match[2])) ||
        Number(match[1]) > Number(match[2])
      ) {
        throw new Error(`Invalid integration-test shard: ${shard}`);
      }
    }
    return [
      npmStep("worker:test-build"),
      {
        name: shard ? `integration tests (${shard})` : "integration tests",
        command: process.execPath,
        args: [
          "--test",
          "--test-timeout=180000",
          ...(shard ? [`--test-shard=${shard}`] : []),
        ],
      },
      npmStep("validate"),
    ];
  }
  if (shard !== undefined) {
    throw new Error("--shard requires --group=integration");
  }
  if (!Object.hasOwn(browserGroups, group)) {
    throw new Error(`Unknown quality-gate group: ${group ?? "(missing)"}`);
  }
  return ["worker:test-build", ...browserGroups[group]].map(npmStep);
}

export async function runQualityGate(
  steps = defaultSteps,
  { cwd = root, stdout = process.stdout, stderr = process.stderr } = {},
) {
  for (const step of steps) {
    const passed = await runStep(step, { cwd, stdout, stderr });
    if (!passed) return 1;
  }
  return 0;
}

function runStep(step, { cwd, stdout, stderr }) {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd,
      env: {
        ...process.env,
        NODE_OPTIONS:
          `${process.env.NODE_OPTIONS ?? ""} --import=${consolePreload.href}`.trim(),
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Terminate npm, its scripts, and local Workers together on a failure.
      detached: process.platform !== "win32",
    });
    let failed = false;
    let killTimer;
    const kill = (signal) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const stop = () => {
      if (failed) return;
      failed = true;
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 2_000);
      killTimer.unref();
    };
    const interrupted = () => stop();
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);

    for (const [stream, target] of [
      [child.stdout, stdout],
      [child.stderr, stderr],
    ]) {
      let tail = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        target.write(chunk);
        const output = tail + chunk;
        // Keep enough context for a marker or ANSI escape split across chunks.
        tail = output.slice(-256);
        if (/\[(?:ERROR|FATAL)\]/u.test(stripVTControlCharacters(output))) {
          if (!failed) {
            stderr.write(
              `\nQuality gate stopped: ${step.name} emitted an unexpected error log.\n`,
            );
          }
          stop();
        }
      });
    }
    child.once("error", (error) => {
      failed = true;
      stderr.write(
        `Quality gate could not start ${step.name}: ${error.message}\n`,
      );
    });
    child.once("close", (code, signal) => {
      clearTimeout(killTimer);
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
      if (!failed && code !== 0) {
        stderr.write(
          `Quality gate stopped: ${step.name} exited with ${signal ?? code}.\n`,
        );
      }
      resolve(!failed && code === 0);
    });
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    process.exitCode = await runQualityGate(selectSteps(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
