import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("./", import.meta.url);
const port = Number(process.env.PHOTO_PROTOTYPE_PORT ?? 3085);
const files = new Map([
  ["/", [new URL("index.html", root), "text/html"]],
  ["/timeline/", [new URL("index.html", root), "text/html"]],
  ["/atlas/", [new URL("index.html", root), "text/html"]],
  ["/app.js", [new URL("app.js", root), "text/javascript"]],
  ["/styles.css", [new URL("styles.css", root), "text/css"]],
  [
    "/fonts/headline.woff2",
    [
      new URL("../../assets/fonts/FinlandicaHeadline-Black.woff2", root),
      "font/woff2",
    ],
  ],
  [
    "/fonts/text.woff2",
    [
      new URL("../../assets/fonts/FinlandicaText-Regular.woff2", root),
      "font/woff2",
    ],
  ],
  [
    "/fonts/bold.woff2",
    [
      new URL("../../assets/fonts/FinlandicaText-Bold.woff2", root),
      "font/woff2",
    ],
  ],
]);
let catalogPromise;
async function publicCatalog() {
  // Always request anonymously. Prototypes have no admin or speaker session.
  catalogPromise ??= fetch("https://sdlcai.org/api/photos/catalog", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Public photo collection unavailable");
      return JSON.stringify(await response.json());
    })
    .catch((error) => {
      catalogPromise = undefined;
      throw error;
    });
  return catalogPromise;
}
const server = createServer(async (request, response) => {
  response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405);
    response.end();
    return;
  }
  const path = new URL(request.url, "http://localhost").pathname;
  try {
    const file = files.get(path);
    const body =
      path === "/api/catalog"
        ? await publicCatalog()
        : file
          ? await readFile(fileURLToPath(file[0]))
          : null;
    if (body === null) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.setHeader(
      "Content-Type",
      path === "/api/catalog"
        ? "application/json; charset=utf-8"
        : `${file[1]}${file[1].startsWith("text/") ? "; charset=utf-8" : ""}`,
    );
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      "The public photo collection could not load. Reload to try again.",
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Photo exploration prototypes: http://127.0.0.1:${port}/`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close());
