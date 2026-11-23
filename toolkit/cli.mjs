#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { createToolkit, roles } from "./index.mjs";
import { canonicalOrigin, isLocalHost, startWeb } from "./http.mjs";
import {
  createSmtpSender,
  createTurnstileVerifier,
} from "./provider-adapters.mjs";

async function main(mode) {
  if (!["ui", "mcp", "catalog", "maintain"].includes(mode)) {
    console.log("Usage: event-toolkit ui | mcp | catalog | maintain");
    process.exitCode = ["--help", "-h"].includes(mode) ? 0 : 1;
    return;
  }
  const env = process.env;
  let origin = canonicalOrigin(env.TOOLKIT_PUBLIC_ORIGIN);
  const host = env.TOOLKIT_HOST || "127.0.0.1";
  const local = isLocalHost(host);
  const services = {
    actionUrl(name, input) {
      if (!origin) return undefined;
      return new URL(
        "/#" +
          new URLSearchParams({
            operation: name,
            input: JSON.stringify(input),
          }),
        origin,
      ).href;
    },
  };
  if (env.TOOLKIT_SMTP_URL) {
    if (!env.TOOLKIT_MAIL_FROM)
      throw Error("Set TOOLKIT_MAIL_FROM with TOOLKIT_SMTP_URL.");
    services.sendMail = await createSmtpSender({
      url: env.TOOLKIT_SMTP_URL,
      from: env.TOOLKIT_MAIL_FROM,
    });
  }
  if (env.TOOLKIT_TURNSTILE_SECRET || env.TOOLKIT_TURNSTILE_SITE_KEY) {
    if (!env.TOOLKIT_TURNSTILE_SECRET || !env.TOOLKIT_TURNSTILE_SITE_KEY)
      throw Error("Configure both Turnstile keys.");
    services.verifyChallenge = createTurnstileVerifier({
      secret: env.TOOLKIT_TURNSTILE_SECRET,
      publicOrigin: () => origin,
    });
  }
  const toolkit = createToolkit({
    enabled: env.TOOLKIT_BLOCKS?.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    eventId: env.TOOLKIT_EVENT || "local-event",
    directory: env.TOOLKIT_DATA_DIR || join(homedir(), ".event-toolkit"),
    services,
  });
  const principal = {
    role: env.TOOLKIT_ROLE || "organizer",
    actor: env.TOOLKIT_ACTOR || "local-organizer",
  };
  if (!roles.includes(principal.role)) throw Error("Unknown TOOLKIT_ROLE");
  if (mode === "catalog") {
    console.log(JSON.stringify(toolkit.catalog(principal), null, 2));
    return;
  }
  if (mode === "maintain") {
    try {
      await toolkit.maintain();
    } finally {
      await toolkit.close();
    }
    return;
  }
  if (mode === "mcp") {
    const { createMcpServer } = await import("./mcp.mjs");
    const { StdioServerTransport } =
      await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = createMcpServer(toolkit, principal);
    server.onclose = () => {
      void toolkit.close();
    };
    await server.connect(new StdioServerTransport());
    return;
  }
  const principals = JSON.parse(env.TOOLKIT_PRINCIPALS || "[]");
  if (!Array.isArray(principals))
    throw Error("TOOLKIT_PRINCIPALS must be a list.");
  let generated;
  if (env.TOOLKIT_ACCESS_TOKEN)
    principals.push({
      role: "organizer",
      actor: "local-organizer",
      token: env.TOOLKIT_ACCESS_TOKEN,
    });
  else if (local && principals.length === 0) {
    generated = randomBytes(32).toString("base64url");
    principals.push({
      role: "organizer",
      actor: "local-organizer",
      token: generated,
    });
  }
  const web = await startWeb({
    toolkit,
    host,
    port: Number(env.TOOLKIT_PORT ?? 3000),
    publicOrigin: origin,
    eventLabel: env.TOOLKIT_EVENT_LABEL,
    principals,
    challengeSiteKey: env.TOOLKIT_TURNSTILE_SITE_KEY,
  });
  try {
    await toolkit.maintain();
  } catch (error) {
    await web.close();
    await toolkit.close();
    throw error;
  }
  origin = web.origin;
  console.log("Event toolkit: " + origin);
  if (generated)
    console.log(
      "Organizer access (private): " +
        origin +
        "/#" +
        new URLSearchParams({ access: generated }),
    );
  const timer = setInterval(
    () =>
      toolkit
        .maintain()
        .catch((error) =>
          console.error("Toolkit maintenance failed:", error.message),
        ),
    3600_000,
  );
  timer.unref();
  const stop = async () => {
    clearInterval(timer);
    await web.close();
    await toolkit.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
main(process.argv[2] || "ui").catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
