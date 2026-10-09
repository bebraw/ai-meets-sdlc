import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { sourceUpdatedAt } from "../scripts/source-updated-at.mjs";

const exec = promisify(execFile);

test("feed source time survives fresh checkouts and unrelated commits, and advances with content", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sdlcai-feed-source-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = (...args) => exec("git", args, { cwd: directory });
  await git("init", "--initial-branch=main");
  await git("config", "user.name", "Feed test");
  await git("config", "user.email", "feed@example.test");
  const commit = async (date) => {
    await git("add", ".");
    await exec(
      "git",
      ["-c", "commit.gpgsign=false", "commit", "-m", "Fixture content"],
      {
        cwd: directory,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      },
    );
  };
  const source = path.join(directory, "source.json");
  const original = "2026-09-01T10:00:00.000Z";
  await writeFile(source, "original");
  await commit(original);
  const options = { cwd: directory, epoch: undefined };
  assert.equal(await sourceUpdatedAt(["source.json"], options), original);
  await utimes(source, new Date(), new Date());
  await writeFile(path.join(directory, "unrelated.txt"), "code-only edit");
  await commit("2026-09-02T10:00:00Z");
  assert.equal(await sourceUpdatedAt(["source.json"], options), original);

  const checkout = path.join(directory, "checkout");
  await exec("git", ["clone", "--no-local", directory, checkout]);
  assert.equal(
    await sourceUpdatedAt(["source.json"], { cwd: checkout }),
    original,
  );
  await writeFile(source, "updated public content");
  await commit("2026-09-03T10:00:00Z");
  assert.equal(
    await sourceUpdatedAt(["source.json"], options),
    "2026-09-03T10:00:00.000Z",
  );

  const shallow = path.join(directory, "shallow");
  await exec("git", ["clone", "--depth=1", `file://${directory}`, shallow]);
  await assert.rejects(
    sourceUpdatedAt(["source.json"], { cwd: shallow }),
    /full Git history/u,
  );
});

test("source archives accept an explicit reproducible timestamp and reject malformed values", async () => {
  assert.equal(
    await sourceUpdatedAt([], { cwd: "/nonexistent", epoch: "1788256800" }),
    "2026-09-01T10:00:00.000Z",
  );
  for (const epoch of ["", "yesterday", "1.5", "-1", "9".repeat(100)]) {
    await assert.rejects(sourceUpdatedAt([], { epoch }), /SOURCE_DATE_EPOCH/u);
  }
});
