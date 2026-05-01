import { rm } from "node:fs/promises";

await rm(".gustwind/persistent-assets/tailwind", {
  force: true,
  recursive: true,
});
