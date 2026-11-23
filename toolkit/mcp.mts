import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { artifactStore, splitResult } from "./artifacts.mjs";
import { createRequire } from "node:module";
const metadata: { version: string } = createRequire(import.meta.url)(
  "../package.json",
);

import type { Toolkit, Principal } from "./contracts.mjs";
export function createMcpServer(toolkit: Toolkit, principal: Principal) {
  if (!principal)
    throw new Error("Choose an explicit role and actor for this MCP server.");
  // An MCP server and its artifact cache belong to a single authenticated principal.
  const actor = Object.freeze({ role: principal.role, actor: principal.actor });
  const server = new Server(
    { name: "event-toolkit", version: metadata.version },
    { capabilities: { tools: {}, resources: {} } },
  );
  const files = artifactStore();
  const catalog = toolkit.catalog(actor);
  const ops = catalog.flatMap((block) =>
    block.operations.map((op) => ({ ...op, block: block.title })),
  );
  const catalogUri = "event-toolkit://catalog";
  const prefix = "event-toolkit://artifacts/";
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: ops.map((op) => ({
      name: op.name,
      description: op.block + ". " + op.description,
      inputSchema: op.inputSchema,
      ...(op.outputSchema ? { outputSchema: op.outputSchema } : {}),
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const { data, file } = splitResult(
        await toolkit.run(params.name, params.arguments ?? {}, actor),
      );
      const structuredContent: Record<string, unknown> =
        data === null || Array.isArray(data) || typeof data !== "object"
          ? { result: data }
          : { ...data };
      const content: (
        | { type: "text"; text: string }
        | { type: "resource_link"; uri: string; name: string; mimeType: string }
      )[] = [];
      if (file) {
        const id = files.put(file, "connection");
        const uri = prefix + id;
        const link = {
          uri,
          name: file.name,
          mimeType: file.mimeType,
        };
        structuredContent.artifact = link;
        content.push({ type: "resource_link", ...link });
      }
      content.unshift({
        type: "text",
        text: JSON.stringify(structuredContent),
      });
      return { content, structuredContent };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [
      {
        uri: catalogUri,
        name: "Enabled event tools",
        mimeType: "application/json",
      },
    ],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, ({ params: { uri } }) => {
    if (uri === catalogUri)
      return {
        contents: [
          { uri, mimeType: "application/json", text: JSON.stringify(catalog) },
        ],
      };
    const file =
      uri.startsWith(prefix) &&
      files.get(uri.slice(prefix.length), "connection");
    if (!file) throw new Error("Artifact unavailable or expired");
    return {
      contents: [
        { uri, mimeType: file.mimeType, blob: file.bytes.toString("base64") },
      ],
    };
  });
  return server;
}
