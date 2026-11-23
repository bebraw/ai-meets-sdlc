import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const compiler = spawnSync(
  process.execPath,
  [
    require.resolve("typescript/bin/tsc"),
    "-p",
    "tsconfig.json",
    "--listEmittedFiles",
  ],
  { cwd: fileURLToPath(root), encoding: "utf8" },
);
if (compiler.error) throw compiler.error;
if (compiler.stderr) process.stderr.write(compiler.stderr);
if (compiler.status !== 0) {
  process.stderr.write(compiler.stdout);
  process.exit(compiler.status ?? 1);
}

// Drop obsolete modules after a successful build so a rename cannot leak into the tarball.
const emitted = new Set(
  compiler.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TSFILE: "))
    .map((line) => resolve(line.slice(8))),
);
if (!emitted.size) throw new Error("The toolkit compiler produced no files.");
for (const entry of readdirSync(new URL("dist/", root), {
  recursive: true,
  withFileTypes: true,
})) {
  const path = resolve(entry.parentPath, entry.name);
  if (entry.isFile() && !emitted.has(path)) rmSync(path, { force: true });
}
