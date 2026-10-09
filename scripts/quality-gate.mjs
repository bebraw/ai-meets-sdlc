import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const consolePreload = new URL("./quality-console-errors.mjs", import.meta.url);
const tasks = [
  "quality:build",
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
];
const defaultSteps = tasks.map((name) => ({
  name,
  command: "npm",
  args: ["run", name],
}));

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
  process.exitCode = await runQualityGate();
}
