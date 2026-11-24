import { writeFile } from "node:fs/promises";
import { blockIds, createToolkit } from "@sdlcai/event-toolkit";

const [block, outputFile] = process.argv.slice(2);
if (!blockIds.includes(block)) {
  console.error("Choose a block: " + blockIds.join(", "));
  process.exitCode = 1;
} else {
  // Each invocation starts with fictional data and an empty in-memory store.
  const toolkit = createToolkit({ enabled: [block] });
  try {
    const [operation] = toolkit.catalog()[0].operations;
    const { artifact, ...result } = await toolkit.run(
      operation.name,
      operation.example,
    );
    console.log(JSON.stringify({ operation: operation.name, result }, null, 2));
    if (artifact && outputFile) {
      await writeFile(outputFile, artifact.bytes, { flag: "wx" });
      console.log("Saved " + artifact.mimeType + " to " + outputFile);
    }
  } finally {
    await toolkit.close();
  }
}
