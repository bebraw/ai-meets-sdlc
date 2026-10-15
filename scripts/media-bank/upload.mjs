import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import { defaultOutput, readJson, repoRoot, run } from "./catalog.mjs";

config({ quiet: true });
const args = process.argv.slice(2);
const outputIndex = args.indexOf("--output");
const output = path.resolve(
  outputIndex < 0 ? defaultOutput : args[outputIndex + 1],
);
const plan = await readJson(path.join(output, "upload-plan.json"));
const { input } = await readJson(path.join(output, "source.json"));
const bucket = "ai-meets-sdlc-speaker-uploads";
if (!args.includes("--remote")) {
  console.log(
    `Prepared ${plan.uploads.length} objects for private bucket ${bucket}. Pass --remote to upload.`,
  );
  process.exit(0);
}
const statePath = path.join(output, "r2-upload-state.json");
const state = await readJson(statePath, { bucket, uploaded: {} });
if (state.bucket !== bucket)
  throw new Error("Upload state belongs to a different bucket.");
let next = 0,
  completed = 0,
  failure,
  saving = Promise.resolve();
const jobs = plan.uploads;
await Promise.allSettled(
  Array.from({ length: 4 }, async () => {
    while (!failure && next < jobs.length) {
      const job = jobs[next++];
      try {
        const filename =
          job.source === "original"
            ? path.join(input, job.localFilename)
            : path.join(output, job.path);
        const hash = createHash("sha256");
        for await (const bytes of createReadStream(filename))
          hash.update(bytes);
        const checksum = hash.digest("hex");
        if (job.sha256 && job.sha256 !== checksum)
          throw new Error(`Source changed: ${job.localFilename}`);
        if (state.uploaded[job.key] !== checksum) {
          await run(process.execPath, [
            path.join(repoRoot, "node_modules/wrangler/bin/wrangler.js"),
            "r2",
            "object",
            "put",
            `${bucket}/${job.key}`,
            "--remote",
            "--file",
            filename,
            "--content-type",
            "image/jpeg",
            "--cache-control",
            "private, no-store",
          ]);
          state.uploaded[job.key] = checksum;
          saving = saving.then(async () => {
            await writeFile(
              `${statePath}.tmp`,
              JSON.stringify(state, null, 2) + "\n",
            );
            await rename(`${statePath}.tmp`, statePath);
          });
          await saving;
        }
        completed++;
        if (completed % 25 === 0 || completed === jobs.length)
          console.log(
            `Uploaded/verified ${completed}/${jobs.length} private objects`,
          );
      } catch (error) {
        failure ??= error;
      }
    }
  }),
);
await saving;
if (failure) throw failure;
console.log(
  `All ${completed} photo objects are uploaded to private R2 storage.`,
);
