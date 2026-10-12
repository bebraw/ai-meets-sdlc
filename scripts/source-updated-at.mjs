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
    (
      await exec("git", args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        timeout: 120_000,
      })
    ).stdout.trim();
  if ((await git("rev-parse", "--is-shallow-repository")) === "true") {
    const historyError =
      "Could not retrieve full Git history for event feed timestamps. Allow fetching from origin, use checkout fetch-depth: 0, or set SOURCE_DATE_EPOCH for source archives.";
    try {
      // Fetch the checked-out revision, even if the remote branch has moved.
      const head = await git("rev-parse", "HEAD");
      await git("fetch", "--unshallow", "--no-tags", "origin", head);
    } catch {
      throw new Error(historyError);
    }
    if ((await git("rev-parse", "--is-shallow-repository")) === "true")
      throw new Error(historyError);
  }
  const timestamp = await git("log", "-1", "--format=%cI", "--", ...files);
  if (!timestamp)
    throw new Error(
      "No Git history for event feed sources; set SOURCE_DATE_EPOCH for source archives.",
    );
  return new Date(timestamp).toISOString();
}
