import { readFile } from "node:fs/promises";
import path from "node:path";

// All pages share one event card. Publish the checked-in PNG verbatim: the
// SVG renderer used previously substituted system fonts on production builds.
export const plugin = {
  meta: {
    name: "sdlcai-og-image-plugin",
    description: "Publish the shared event graphic at the existing OG URLs.",
  },
  async init({ cwd, options: { image }, outputDirectory }) {
    const data = await readFile(path.resolve(cwd, image));

    return {
      beforeEachRender({ url }) {
        const route = url.replace(/^\/+|\/+$/gu, "");
        // Match the old OG plugin's exclusions for non-page routes.
        if (route.endsWith(".html") || route.endsWith(".xml")) return [];

        return [
          {
            type: "writeFile",
            payload: {
              outputDirectory,
              file: path.posix.join(route, "og.png"),
              data,
            },
          },
        ];
      },
    };
  },
};
