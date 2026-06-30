import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const buildDir = path.resolve("build");
const routesConfig = JSON.parse(await readFile("site/routes.json", "utf8"));
const routes = Object.keys(routesConfig)
  .filter((route) => !route.endsWith(".xml"))
  .map((route) => (route === "/" ? "/" : `/${route}/`));
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];
const pageTimeoutMs = 10000;
const axeSource = await readFile("node_modules/axe-core/axe.min.js", "utf8");
const debug = (...args) => {
  if (process.env.A11Y_DEBUG) {
    console.error("[a11y]", ...args);
  }
};
const axeRunOptions = {
  runOnly: {
    type: "tag",
    values: [
      "wcag2a",
      "wcag2aa",
      "wcag21a",
      "wcag21aa",
      "wcag22aa",
      "best-practice",
    ],
  },
  rules: {
    // scripts/validate-layout.mjs has a project-specific touch-target check that
    // permits inline text links while still guarding standalone controls.
    "target-size": { enabled: false },
  },
};

const browserCandidates = [
  process.env.LAYOUT_BROWSER_PATH,
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findBrowser() {
  for (const candidate of browserCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "No Chromium-compatible browser found. Set LAYOUT_BROWSER_PATH to run accessibility validation.",
  );
}

function startServer() {
  const contentTypes = new Map([
    [".css", "text/css"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript"],
    [".jpg", "image/jpeg"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
  ]);

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const safePath = path
      .normalize(decodeURIComponent(requestUrl.pathname))
      .replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(buildDir, safePath);

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
    } catch {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath)) ?? "text/plain",
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

function summarizeViolation({ route, viewport, violation }) {
  return {
    route,
    viewport: viewport.name,
    size: `${viewport.width}x${viewport.height}`,
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.slice(0, 5).map((node) => ({
      target: node.target,
      summary: node.failureSummary,
    })),
    hiddenNodeCount: Math.max(violation.nodes.length - 5, 0),
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function main() {
  debug("finding browser");
  const browserPath = await findBrowser();
  debug("starting static server");
  const { server, port } = await startServer();
  debug("launching browser", browserPath);
  const browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--headless=new"],
  });
  const failures = [];
  let validationCount = 0;

  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      try {
        page.setDefaultTimeout(pageTimeoutMs);

        for (const route of routes) {
          debug("checking", route, viewport.name);
          const started = Date.now();

          await page.goto(`http://127.0.0.1:${port}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: pageTimeoutMs,
          });
          debug("loaded", route, viewport.name, `${Date.now() - started}ms`);
          await page.addScriptTag({ content: axeSource });
          debug(
            "injected axe",
            route,
            viewport.name,
            `${Date.now() - started}ms`,
          );

          const results = await withTimeout(
            page.evaluate((options) => {
              return window.axe.run(document, options);
            }, axeRunOptions),
            pageTimeoutMs,
            `Timed out running axe for ${route} at ${viewport.name}`,
          );
          debug("ran axe", route, viewport.name, `${Date.now() - started}ms`);

          validationCount += 1;

          for (const violation of results.violations) {
            failures.push(summarizeViolation({ route, viewport, violation }));
          }
        }
      } finally {
        await context.close();
        debug("closed context", viewport.name);
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failures.length > 0) {
    console.error("Accessibility validation failed:");

    for (const failure of failures.slice(0, 20)) {
      console.error(JSON.stringify(failure, null, 2));
    }

    if (failures.length > 20) {
      console.error(`...and ${failures.length - 20} more failures.`);
    }

    process.exit(1);
  }

  console.log(
    `Validated accessibility for ${routes.length} routes across ${validationCount} route/viewport combinations.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
