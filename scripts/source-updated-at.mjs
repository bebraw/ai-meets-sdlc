import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

// Checkout mtimes describe the build machine, not when public content changed.
export async function sourceUpdatedAt(
  files,
  { cwd = process.cwd(), epoch = process.env.SOURCE_DATE_EPOCH } = {},
) {
  if (epoch !== undefined) {
    if (!/^\d+$/u.test(epoch))
      throw new Error("SOURCE_DATE_EPOCH must be Unix seconds");
    const date = new Date(Number(epoch) * 1000);
    if (!Number.isFinite(date.getTime()))
      throw new Error("Invalid SOURCE_DATE_EPOCH");
    return date.toISOString();
  }
  const git = async (...args) =>
    (await exec("git", args, { cwd })).stdout.trim();
  if ((await git("rev-parse", "--is-shallow-repository")) === "true") {
    throw new Error(
      "Event feed timestamps require full Git history (checkout fetch-depth: 0), or SOURCE_DATE_EPOCH for source archives.",
    );
  }
  const timestamp = await git("log", "-1", "--format=%cI", "--", ...files);
  if (!timestamp)
    throw new Error(
      "No Git history for event feed sources; set SOURCE_DATE_EPOCH for source archives.",
    );
  return new Date(timestamp).toISOString();
}
