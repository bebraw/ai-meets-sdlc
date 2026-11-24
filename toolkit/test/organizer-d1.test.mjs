import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { chromium } from "playwright";
import { createToolkit } from "../dist/index.mjs";
import { startWeb } from "../dist/http.mjs";
import { createMcpServer } from "../dist/mcp.mjs";
import {
  d1OrganizerStore,
  organizerSchema,
} from "../dist/blocks/organizer-store.mjs";

test("D1 directory edits through MCP are visible in the browser and reject stale or unauthorized writes", async (t) => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-04-30",
      d1Databases: ["DIRECTORY"],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DIRECTORY");
  await db.prepare(organizerSchema).run();
  const options = {
    eventId: "local-d1",
    enabled: ["organizer-directory"],
    services: { organizerStore: d1OrganizerStore(db) },
    storage: () =>
      assert.fail("directory selected native SQLite with D1 configured"),
  };
  const api = createToolkit(options),
    webToolkit = createToolkit(options);
  t.after(() => Promise.all([api.close(), webToolkit.close()]));
  async function connect(role) {
    const client = new Client({ name: "directory-test", version: "1.0" });
    const engine = createMcpServer(api, { role, actor: role + "-test" });
    const [caller, receiver] = InMemoryTransport.createLinkedPair();
    await engine.connect(receiver);
    await client.connect(caller);
    t.after(() => client.close());
    return client;
  }
  const organizer = await connect("organizer"),
    visitor = await connect("public");
  const inserted = await organizer.callTool({
    name: "organizers_create",
    arguments: { name: "Coordinator", visible: true },
  });
  const { id, revision } = inserted.structuredContent;
  const web = await startWeb({
    toolkit: webToolkit,
    port: 0,
    principals: [{ role: "organizer", actor: "web", token: "d1-ui-test" }],
  });
  t.after(() => web.close());
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.TOOLKIT_CHROMIUM_PATH || undefined,
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(web.origin + "/#access=d1-ui-test&operation=organizers_list");
  await page.getByRole("button", { name: "Show team", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Coordinator", exact: true })
    .click();
  await page.locator('[data-path="name"]').fill("Old browser edit");
  const updated = await organizer.callTool({
    name: "organizers_update",
    arguments: {
      id,
      revision,
      name: "New MCP edit",
      visible: true,
      badge: false,
      position: 0,
    },
  });
  assert.equal(updated.structuredContent.revision, 2);
  const staleResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/run/organizers_update"),
  );
  await page.locator("#run").click();
  assert.equal((await staleResponse).status(), 409);
  await page
    .getByText("This organizer changed elsewhere. Reload before saving.")
    .waitFor();
  const publicPage = await browser.newPage();
  await publicPage.goto(web.origin + "/#operation=organizers_public");
  await publicPage
    .getByRole("button", { name: "Show public directory", exact: true })
    .click();
  await publicPage
    .getByRole("heading", { name: "New MCP edit", exact: true })
    .waitFor();
  const denied = await publicPage.request.post(
    web.origin + "/api/run/organizers_delete",
    { headers: { origin: web.origin }, data: { id, revision: 2 } },
  );
  assert.equal(denied.status(), 403);
  assert.equal(
    (
      await visitor.callTool({
        name: "organizers_delete",
        arguments: { id, revision: 2 },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT name FROM organizers WHERE id=?")
        .bind(id)
        .first()
    ).name,
    "New MCP edit",
  );
});
