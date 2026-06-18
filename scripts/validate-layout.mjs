import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const buildDir = path.resolve("build");
const routes = [
  "/",
  "/404/",
  "/admin/",
  "/contact/",
  "/design-system/",
  "/for-sponsors/",
  "/privacy-policy/",
];
const viewports = [
  { name: "small-mobile", width: 320, height: 740 },
  { name: "mobile", width: 390, height: 844 },
  { name: "large-mobile", width: 640, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "hero-rail-start", width: 900, height: 900 },
  { name: "small-desktop", width: 1024, height: 900 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "large-desktop", width: 1920, height: 1080 },
  { name: "wide-short", width: 2560, height: 800 },
];
const homePageViewports = [
  ...viewports,
  { name: "before-tablet", width: 767, height: 1024 },
  { name: "before-hero-rail", width: 899, height: 900 },
];

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
    "No Chromium-compatible browser found. Set LAYOUT_BROWSER_PATH to run layout validation.",
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

async function waitForJson(url, timeoutMs = 5000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Browser may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function getFreePort() {
  const server = createServer();

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

class CdpSession {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.socket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
        return;
      }

      const listeners = this.events.get(message.method) ?? [];
      for (const listener of listeners) {
        listener(message.params);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;

    const id = this.nextId;
    this.nextId += 1;

    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  once(method) {
    return new Promise((resolve) => {
      const listener = (params) => {
        const listeners = this.events.get(method) ?? [];
        this.events.set(
          method,
          listeners.filter((item) => item !== listener),
        );
        resolve(params);
      };

      this.events.set(method, [...(this.events.get(method) ?? []), listener]);
    });
  }

  close() {
    this.socket.close();
  }
}

async function createPage(browserPort) {
  const response = await fetch(`http://127.0.0.1:${browserPort}/json/new`, {
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`Could not create browser tab: ${response.status}`);
  }

  const target = await response.json();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("DOM.enable");
  return session;
}

async function navigate(session, url, viewport) {
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 700,
  });

  const loaded = session.once("Page.loadEventFired");
  await session.send("Page.navigate", { url });
  await loaded;
}

async function evaluateLayout(session) {
  const expression = String.raw`
    (async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);

      const selector = [
        "address",
        "button",
        "figcaption",
        "h1",
        "h2",
        "h3",
        "p",
        "a",
        "strong",
        "td",
        "th",
        "time"
      ].join(",");
      const overflowTolerance = 8;

      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) !== 0 &&
          rect.width > 1 &&
          rect.height > 1 &&
          element.textContent.trim().length > 0
        );
      };

      const hasHorizontalOverflowContainer = (element) => {
        let current = element.parentElement;

        while (current && current !== document.body) {
          const style = getComputedStyle(current);
          if (["auto", "scroll"].includes(style.overflowX)) {
            return true;
          }
          current = current.parentElement;
        }

        return false;
      };

      const describe = (element) => {
        const label = element.textContent.trim().replace(/\s+/g, " ").slice(0, 80);
        const id = element.id ? "#" + element.id : "";
        return element.tagName.toLowerCase() + id + " " + JSON.stringify(label);
      };

      const elements = [...document.querySelectorAll(selector)]
        .filter(isVisible)
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          const rects = [...element.getClientRects()]
            .filter((item) => item.width > 1 && item.height > 1)
            .map((item) => ({
              left: item.left,
              top: item.top,
              right: item.right,
              bottom: item.bottom,
              width: item.width,
              height: item.height,
            }));

          return {
            element,
            index,
            label: describe(element),
            rect: {
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
            },
            rects,
            allowsHorizontalOverflow: hasHorizontalOverflowContainer(element),
          };
        });

      const failures = [];

      for (const item of elements) {
        if (!item.allowsHorizontalOverflow) {
          for (const rect of item.rects) {
            if (
              rect.left < -overflowTolerance ||
              rect.right > window.innerWidth + overflowTolerance
            ) {
              failures.push({
                type: "viewport-overflow",
                element: item.label,
                rect,
              });
              break;
            }
          }
        }
      }

      for (let i = 0; i < elements.length; i += 1) {
        for (let j = i + 1; j < elements.length; j += 1) {
          const first = elements[i];
          const second = elements[j];

          if (
            first.element.contains(second.element) ||
            second.element.contains(first.element)
          ) {
            continue;
          }

          for (const firstRect of first.rects) {
            for (const secondRect of second.rects) {
              const left = Math.max(firstRect.left, secondRect.left);
              const right = Math.min(firstRect.right, secondRect.right);
              const top = Math.max(firstRect.top, secondRect.top);
              const bottom = Math.min(firstRect.bottom, secondRect.bottom);
              const width = right - left;
              const height = bottom - top;

              if (width <= 2 || height <= 2) {
                continue;
              }

              const area = width * height;
              const firstArea = firstRect.width * firstRect.height;
              const secondArea = secondRect.width * secondRect.height;
              const overlapRatio = area / Math.min(firstArea, secondArea);

              if (overlapRatio >= 0.08) {
                failures.push({
                  type: "overlap",
                  first: first.label,
                  second: second.label,
                  overlap: {
                    left,
                    right,
                    top,
                    bottom,
                    width,
                    height,
                    ratio: Number(overlapRatio.toFixed(3)),
                  },
                });
              }
            }
          }
        }
      }

      const headlineElements = [...document.querySelectorAll("h1,h2,h3")]
        .filter(isVisible);

      for (const element of headlineElements) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

        while (walker.nextNode()) {
          const node = walker.currentNode;
          const text = node.textContent;
          const words = text.matchAll(/[A-Za-z][A-Za-z0-9]{3,}/g);

          for (const word of words) {
            const range = document.createRange();
            range.setStart(node, word.index);
            range.setEnd(node, word.index + word[0].length);

            const lineTops = [
              ...new Set(
                [...range.getClientRects()]
                  .filter((item) => item.width > 1 && item.height > 1)
                  .map((item) => Math.round(item.top)),
              ),
            ];

            range.detach();

            if (lineTops.length > 1) {
              failures.push({
                type: "word-fragmentation",
                element: describe(element),
                word: word[0],
              });
            }
          }
        }
      }

      return failures;
    })()
  `;

  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  return result.result.value;
}

async function evaluatePageLayout(session) {
  const expression = String.raw`
    (async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);

      const failures = [];
      const route = window.location.pathname;
      const viewportWidth = window.innerWidth;
      const minReadableMeasure = 340;

      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();

        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };

      const fail = (type, details) => {
        failures.push({
          type,
          ...details,
        });
      };

      if (route === "/") {
        const title = document.querySelector("h1");
        const intro = [...document.querySelectorAll("p")].find((element) =>
          element.textContent.includes("A focused seminar"),
        );
        const countdown = document.querySelector("aside");

        if (!title || !intro || !countdown) {
          fail("home-hero-missing-elements", {
            hasTitle: Boolean(title),
            hasIntro: Boolean(intro),
            hasCountdown: Boolean(countdown),
          });

          return failures;
        }

        const titleRect = rectOf(title);
        const introRect = rectOf(intro);
        const countdownRect = rectOf(countdown);
        const countdownIsRail = countdownRect.top < titleRect.bottom;

        if (viewportWidth >= 768 && viewportWidth < 900) {
          if (countdownIsRail) {
            fail("home-hero-countdown-rail-too-early", {
              titleRect,
              countdownRect,
            });
          }

          if (introRect.width < minReadableMeasure) {
            fail("home-hero-intro-too-narrow", {
              introRect,
              minReadableMeasure,
            });
          }
        }

        if (viewportWidth >= 900) {
          if (!countdownIsRail) {
            fail("home-hero-countdown-not-railed", {
              titleRect,
              countdownRect,
            });
          }

          if (countdownRect.left <= titleRect.left) {
            fail("home-hero-countdown-not-right-of-title", {
              titleRect,
              countdownRect,
            });
          }
        }

      }

      return failures;
    })()
  `;

  const result = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  return result.result.value;
}

function getRouteViewports(route) {
  if (route === "/") {
    return homePageViewports;
  }

  return viewports;
}

async function main() {
  const browserPath = await findBrowser();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "sdlcai-layout-"));
  const browserPort = await getFreePort();
  const { server, port: serverPort } = await startServer();
  let browserErrorOutput = "";
  const browser = spawn(
    browserPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  browser.stderr.setEncoding("utf8");
  browser.stderr.on("data", (chunk) => {
    browserErrorOutput += chunk;
  });

  const browserExit = new Promise((_, reject) => {
    browser.once("exit", (code, signal) => {
      reject(
        new Error(
          `Chromium exited before layout validation started. code=${code} signal=${signal}\n${browserErrorOutput}`,
        ),
      );
    });
  });

  const failures = [];
  let validationCount = 0;

  try {
    await Promise.race([
      waitForJson(`http://127.0.0.1:${browserPort}/json/version`, 15000),
      browserExit,
    ]);

    for (const route of routes) {
      for (const viewport of getRouteViewports(route)) {
        const session = await createPage(browserPort);
        const url = `http://127.0.0.1:${serverPort}${route}`;

        try {
          await navigate(session, url, viewport);
          validationCount += 1;
          const pageFailures = [
            ...(await evaluateLayout(session)),
            ...(await evaluatePageLayout(session)),
          ];

          for (const failure of pageFailures) {
            failures.push({
              route,
              viewport: viewport.name,
              size: `${viewport.width}x${viewport.height}`,
              ...failure,
            });
          }
        } finally {
          session.close();
        }
      }
    }
  } finally {
    browser.kill();
    server.close();
    await rm(userDataDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error("Layout validation failed:");

    for (const failure of failures.slice(0, 20)) {
      console.error(JSON.stringify(failure, null, 2));
    }

    if (failures.length > 20) {
      console.error(`...and ${failures.length - 20} more failures.`);
    }

    process.exit(1);
  }

  console.log(
    `Validated ${routes.length} routes across ${validationCount} route/viewport combinations.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
