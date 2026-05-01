import { access } from "node:fs/promises";

try {
  await access("build/index.html");
} catch {
  console.error(
    "Build output is missing. Expected Gustwind to generate build/index.html.",
  );
  process.exit(1);
}
