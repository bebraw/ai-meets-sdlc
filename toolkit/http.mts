import { createServer } from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  printFontIds,
  printFonts,
  printFontUrl,
} from "./blocks/print-fonts.mjs";
import { artifactStore, splitResult } from "./artifacts.mjs";
import * as v from "valibot";
import { principalSchema } from "./index.mjs";
import type { Toolkit, Principal } from "./contracts.mjs";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
export const credentialSchema = v.object({
  ...principalSchema.entries,
  token: v.pipe(v.string(), v.regex(/\S/)),
});
const sessionSchema = v.object({
  ...principalSchema.entries,
  until: v.number(),
});
export interface WebOptions {
  toolkit: Toolkit;
  port?: number;
  host?: string;
  publicOrigin?: string;
  principals?: (Principal & { token: string })[];
  eventLabel?: string;
  challengeSiteKey?: string;
}

const assets = new Map<string, [string, string]>([
  ["/types.js", ["./ui/types.js", "text/javascript"]],
  [
    "/blocks/badge-artwork.mjs",
    ["./blocks/badge-artwork.mjs", "text/javascript"],
  ],
  ["/", ["../ui/index.html", "text/html"]],
  ["/app.js", ["./ui/app.js", "text/javascript"]],
  ["/workflows.js", ["./ui/workflows.js", "text/javascript"]],
  ["/engagement.js", ["./ui/engagement.js", "text/javascript"]],
  ["/engagement.css", ["../ui/engagement.css", "text/css"]],
  ["/style.css", ["../ui/style.css", "text/css"]],
  ["/badge-proof.js", ["./ui/badge-proof.js", "text/javascript"]],
  [
    "/blocks/badge-sheets.mjs",
    ["./blocks/badge-sheets.mjs", "text/javascript"],
  ],
  ["/badge-sheets.mjs", ["./blocks/badge-sheets.mjs", "text/javascript"]],
  ["/badge-artwork.mjs", ["./blocks/badge-artwork.mjs", "text/javascript"]],
  ["/blocks/print-fonts.mjs", ["./blocks/print-fonts.mjs", "text/javascript"]],
  [
    "/blocks/registration-csv.mjs",
    ["./blocks/registration-csv.mjs", "text/javascript"],
  ],
  ...printFontIds.map((id): [string, [string, string]] => [
    printFontUrl(id),
    ["../assets/print/" + printFonts[id].file, "font/ttf"],
  ]),
  ["/badge-font.ttf", ["../assets/print/NotoSans.ttf", "font/ttf"]],
]);
const failure = (message: string, status: number) =>
  Object.assign(new Error(message), { status });
const safeEqual = (a: Buffer, b: Buffer) =>
  a.length === b.length && timingSafeEqual(a, b);
export const isLocalHost = (host: string) =>
  ["127.0.0.1", "localhost", "::1"].includes(host);
export function canonicalOrigin(value: string | undefined) {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error(
      "Set the public origin to an HTTP(S) scheme, hostname and optional port.",
    );
  return url.origin;
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  if (
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw failure("Expected application/json", 415);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 12 * 1024 * 1024) throw failure("Request exceeds 12 MiB", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw failure("Invalid JSON", 400);
  }
}
export async function startWeb({
  toolkit,
  port = 3000,
  host = "127.0.0.1",
  publicOrigin,
  principals = [],
  eventLabel,
  challengeSiteKey = "",
}: WebOptions) {
  const files = artifactStore();
  const secret = randomBytes(32);
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("base64url");
  let origin = canonicalOrigin(publicOrigin);
  if (!Array.isArray(principals))
    throw new Error("Principals must be a list of access credentials.");
  if (!isLocalHost(host) && (!origin || principals.length === 0))
    throw new Error(
      "Set a public origin and explicit access credentials when binding to a network interface.",
    );
  const credentials = new Map<string, Principal>();
  for (const p of principals) {
    if (!v.is(credentialSchema, p))
      throw new Error("Each principal needs a token, role and actor.");
    const digest = sign(p.token);
    if (credentials.has(digest))
      throw new Error("Each access token must identify exactly one principal.");
    credentials.set(digest, { role: p.role, actor: p.actor });
  }
  const identify = (token: string) => credentials.get(sign(token));
  const server = createServer(async (req, res) => {
    const json = (code: number, value: unknown) => {
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    try {
      if (!origin || req.headers.host !== new URL(origin).host)
        throw failure("Unrecognized host", 403);
      const url = new URL(req.url ?? "/", origin);
      const method = req.method;
      if (
        method === "POST" &&
        req.headers.origin !== origin &&
        !(
          req.headers.authorization?.startsWith("Bearer ") &&
          !req.headers.origin
        )
      )
        throw failure("Cross-origin action refused", 403);
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (req.headers.authorization !== undefined && !bearer)
        throw failure("Expected a bearer access token.", 401);
      let principal = bearer ? identify(bearer) : null;
      if (bearer && !principal) throw failure("Invalid access token", 401);
      const rawCookie = /(?:^|; *)event_toolkit=([A-Za-z0-9_.-]+)/.exec(
        req.headers.cookie ?? "",
      )?.[1];
      if (!principal && rawCookie) {
        const [payload, signature] = rawCookie.split(".");
        if (
          signature &&
          safeEqual(Buffer.from(sign(payload)), Buffer.from(signature))
        ) {
          const data: unknown = JSON.parse(
            Buffer.from(payload, "base64url").toString(),
          );
          if (v.is(sessionSchema, data) && data.until > Date.now())
            principal = data;
        }
      }
      function setSession(p: Principal) {
        const payload = Buffer.from(
          JSON.stringify({
            role: p.role,
            actor: p.actor,
            until: Date.now() + 12 * 3600_000,
          }),
        ).toString("base64url");
        res.setHeader(
          "set-cookie",
          "event_toolkit=" +
            payload +
            "." +
            sign(payload) +
            "; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200" +
            (origin?.startsWith("https:") ? "; Secure" : ""),
        );
      }
      if (!principal) {
        principal = {
          role: "public",
          actor: "visitor-" + randomBytes(16).toString("hex"),
        };
        setSession(principal);
      }
      const owner = JSON.stringify([principal.role, principal.actor]);
      if (method === "POST" && url.pathname === "/api/session") {
        const data = await readBody(req);
        const token = v.safeParse(v.object({ token: v.string() }), data);
        const p = token.success && identify(token.output.token);
        if (!p) throw failure("Invalid access token", 401);
        setSession(p);
        return json(200, { role: p.role });
      }
      if (method === "POST" && url.pathname === "/api/logout") {
        setSession({
          role: "public",
          actor: "visitor-" + randomBytes(16).toString("hex"),
        });
        return json(200, { ok: true });
      }
      if (method === "GET" && url.pathname === "/api/catalog")
        return json(200, {
          eventId: toolkit.eventId,
          eventLabel: eventLabel ?? toolkit.eventId,
          role: principal.role,
          challengeSiteKey,
          blocks: toolkit.catalog(principal),
        });
      if (method === "POST" && url.pathname.startsWith("/api/run/")) {
        const op = url.pathname.slice("/api/run/".length);
        const input = await readBody(req);
        const { data, file } = splitResult(
          await toolkit.run(op, input, principal),
        );
        let artifact;
        if (file)
          artifact = {
            name: file.name,
            mimeType: file.mimeType,
            url: "/artifacts/" + files.put(file, owner),
          };
        return json(200, { data, artifact });
      }
      if (method === "GET" && url.pathname.startsWith("/artifacts/")) {
        const file = files.get(url.pathname.slice("/artifacts/".length), owner);
        if (!file) throw failure("Artifact unavailable or expired", 404);
        const filename = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
        res.setHeader(
          "content-security-policy",
          "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
        );
        res.writeHead(200, {
          "content-type": file.mimeType,
          "content-disposition":
            (url.searchParams.has("download") ? "attachment" : "inline") +
            '; filename="' +
            filename +
            '"',
        });
        return res.end(file.bytes);
      }
      if (method === "GET" && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname)!;
        const bytes = await readFile(new URL(file, import.meta.url));
        const challenge = challengeSiteKey
          ? " https://challenges.cloudflare.com"
          : "";
        res.setHeader(
          "content-security-policy",
          "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'" +
            challenge +
            "; frame-src 'self'" +
            challenge,
        );
        res.writeHead(200, {
          "content-type": type.startsWith("text/")
            ? type + "; charset=utf-8"
            : type,
        });
        return res.end(bytes);
      }
      throw failure("Not found", 404);
    } catch (error) {
      if (!res.headersSent)
        json(
          error instanceof Error &&
            "status" in error &&
            typeof error.status === "number"
            ? error.status
            : 400,
          { error: error instanceof Error ? error.message : String(error) },
        );
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  origin ??=
    "http://" +
    (host.includes(":") ? "[" + host + "]" : host) +
    ":" +
    (server.address() as AddressInfo).port;
  return {
    origin,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}
