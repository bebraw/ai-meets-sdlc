import Ajv from "ajv";
import addFormats from "ajv-formats";
import { blocks as print } from "./blocks/print.mjs";
import { blocks as programme } from "./blocks/programme.mjs";
import { blocks as workflows } from "./blocks/workflows.mjs";
import { blocks as engagement } from "./blocks/engagement.mjs";
import { validateEventId } from "./event-id.mjs";

const allBlocks = [...print, ...programme, ...workflows, ...engagement];
export const blockIds = Object.freeze(allBlocks.map((block) => block.id));
export const roles = Object.freeze([
  "organizer",
  "public",
  "staff",
  "speaker",
  "moderator",
  "mc",
  "attendee",
]);
const trustedLocal = { role: "organizer", actor: "local-organizer" };

async function defaultStorage(options) {
  const { openStorage } = await import("./storage.mjs");
  return openStorage(options);
}

export function createToolkit({
  enabled = blockIds,
  eventId = "example-event",
  directory,
  storage: openStorage = defaultStorage,
  services = {},
} = {}) {
  validateEventId(eventId);
  if (typeof openStorage !== "function")
    throw new Error(
      "Storage must be a factory that opens the event and installation scopes",
    );
  if (!Array.isArray(enabled) || enabled.some((id) => !blockIds.includes(id)))
    throw new Error("Unknown block in enabled configuration");
  const blocks = allBlocks.filter((block) => enabled.includes(block.id));
  const ajv = new Ajv({ strict: false, allErrors: true, ownProperties: true });
  addFormats(ajv);
  const operations = new Map();
  const migrated = new Set();
  const scopes = new Map();
  const active = new Set();
  let storage;
  let closed = false;
  let closing;
  for (const block of blocks) {
    for (const op of block.operations) {
      if (operations.has(op.name))
        throw new Error("Duplicate operation: " + op.name);
      operations.set(op.name, {
        block,
        op,
        validate: ajv.compile(op.inputSchema),
      });
    }
  }
  function visible(op, principal) {
    return (op.roles ?? ["organizer"]).includes(principal.role);
  }
  function assertPrincipal(principal) {
    if (
      !principal ||
      !roles.includes(principal.role) ||
      typeof principal.actor !== "string" ||
      !principal.actor.trim()
    )
      throw Object.assign(
        new Error("A recognized role and actor are required"),
        { status: 403 },
      );
  }
  async function context(block, principal) {
    const ctx = { eventId, ...principal, services };
    if (!block.migrate || block.usesExternalStore?.(services)) return ctx;
    storage ??= Promise.resolve()
      .then(() => openStorage({ directory, eventId }))
      .catch((error) => {
        storage = undefined;
        throw error;
      });
    const connection = await storage;
    const shared = block.scope === "installation";
    const scope = shared ? "shared" : "event";
    if (!scopes.has(scope)) scopes.set(scope, connection[scope]());
    const scoped = scopes.get(scope);
    ctx.db = scoped.db;
    ctx.seal = scoped.seal.bind(scoped);
    ctx.open = scoped.open.bind(scoped);
    ctx.fingerprint = scoped.fingerprint.bind(scoped);
    if (shared) ctx.sharedDb = scoped.db;
    if (!migrated.has(block.id)) {
      scoped.db.exec("BEGIN IMMEDIATE");
      try {
        block.migrate(scoped.db);
        scoped.db.exec("COMMIT");
      } catch (error) {
        scoped.db.exec("ROLLBACK");
        throw error;
      }
      migrated.add(block.id);
    }
    return ctx;
  }
  async function track(work) {
    if (closed) throw new Error("Toolkit closed");
    const pending = work();
    active.add(pending);
    try {
      return await pending;
    } finally {
      active.delete(pending);
    }
  }
  return {
    eventId,
    catalog(principal = trustedLocal) {
      assertPrincipal(principal);
      return blocks
        .map(({ id, title, description, scope, operations: ops, migrate }) => ({
          id,
          title,
          description,
          storage: migrate ? (scope ?? "event") : "none",
          operations: ops
            .filter((op) => visible(op, principal))
            .map(({ run, ...info }) => structuredClone(info)),
        }))
        .filter((block) => block.operations.length);
    },
    run(name, input = {}, principal = trustedLocal) {
      return track(async () => {
        assertPrincipal(principal);
        const entry = operations.get(name);
        if (!entry)
          throw Object.assign(new Error("Unknown operation: " + name), {
            status: 404,
          });
        const { op, block, validate } = entry;
        if (!visible(op, principal))
          throw Object.assign(
            new Error("This operation requires a different role"),
            { status: 403 },
          );
        if (!validate(input))
          throw Object.assign(
            new Error(ajv.errorsText(validate.errors, { dataVar: "input" })),
            { status: 400 },
          );
        const ctx = await context(block, {
          actor: principal.actor,
          role: principal.role,
        });
        if (block.cleanup) await block.cleanup(ctx);
        return op.run(input, ctx);
      });
    },
    maintain() {
      return track(async () => {
        for (const block of blocks)
          if (block.cleanup)
            await block.cleanup(await context(block, trustedLocal));
      });
    },
    close() {
      closed = true;
      closing ??= (async () => {
        await Promise.allSettled(active);
        if (storage) await (await storage).close();
      })();
      return closing;
    },
  };
}
