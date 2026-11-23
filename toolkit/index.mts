import * as v from "valibot";
import type {
  Block,
  Context,
  InternalBlock,
  InternalOperation,
  Principal,
  Role,
  StorageOptions,
  StorageScope,
  QueryDatabase,
  StorageHandle,
  Toolkit,
  ToolkitOptions,
} from "./contracts.mjs";
export type {
  Artifact,
  Block,
  JsonSchema,
  ObjectSchema,
  Operation,
  OperationInput,
  OperationName,
  OperationResult,
  Principal,
  Role,
  SqlValue,
  StorageDatabase,
  StorageFactory,
  StorageHandle,
  StorageOptions,
  StorageScope,
  Toolkit,
  ToolkitOptions,
} from "./contracts.mjs";
import { blocks as print } from "./blocks/print.mjs";
import { blocks as programme } from "./blocks/programme.mjs";
import { blocks as workflows } from "./blocks/workflows.mjs";
import { blocks as engagement } from "./blocks/engagement.mjs";
import { validateEventId } from "./event-id.mjs";

const allBlocks: InternalBlock[] = [
  ...print,
  ...programme,
  ...workflows,
  ...engagement,
];
export const blockIds = Object.freeze(allBlocks.map((block) => block.id));
export const roles = Object.freeze([
  "organizer",
  "public",
  "staff",
  "speaker",
  "moderator",
  "mc",
  "attendee",
] as const);
export const roleSchema = v.picklist(roles);
export const principalSchema = v.object({
  role: roleSchema,
  actor: v.pipe(v.string(), v.regex(/\S/)),
});
const trustedLocal: Principal = { role: "organizer", actor: "local-organizer" };

async function defaultStorage(options: StorageOptions) {
  const { openStorage } = await import("./storage.mjs");
  return openStorage(options);
}

export function createToolkit({
  enabled = blockIds,
  eventId = "example-event",
  directory,
  storage: openStorage = defaultStorage,
  services = {},
}: ToolkitOptions = {}): Toolkit {
  validateEventId(eventId);
  if (typeof openStorage !== "function")
    throw new Error(
      "Storage must be a factory that opens the event and installation scopes",
    );
  if (!Array.isArray(enabled) || enabled.some((id) => !blockIds.includes(id)))
    throw new Error("Unknown block in enabled configuration");
  const blocks = allBlocks.filter((block) => enabled.includes(block.id));
  const operations = new Map<
    string,
    { block: InternalBlock; op: InternalOperation }
  >();
  const migrated = new Set<string>();
  const scopes = new Map<string, StorageScope>();
  const active = new Set<Promise<unknown>>();
  let storage: Promise<StorageHandle> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  for (const block of blocks) {
    for (const op of block.operations) {
      if (operations.has(op.name))
        throw new Error("Duplicate operation: " + op.name);
      operations.set(op.name, {
        block,
        op,
      });
    }
  }
  function visible(op: InternalOperation, principal: Principal) {
    return (op.roles ?? ["organizer"]).includes(principal.role);
  }
  function assertPrincipal(principal: unknown): asserts principal is Principal {
    if (!v.is(principalSchema, principal))
      throw Object.assign(
        new Error("A recognized role and actor are required"),
        { status: 403 },
      );
  }
  async function context(
    block: InternalBlock,
    principal: Principal,
  ): Promise<Context> {
    const ctx = { eventId, ...principal, services };
    if (!block.migrate || block.usesExternalStore?.(services)) {
      const unavailable = (): never => {
        throw Error(block.id + " has no SQLite store");
      };
      return {
        ...ctx,
        get db() {
          return unavailable();
        },
        seal: unavailable,
        open: unavailable,
        fingerprint: unavailable,
      };
    }
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
    const scoped = scopes.get(scope)!;
    // The host returns plain SQL rows. Each block declares the projection of its own query.
    const db = scoped.db as QueryDatabase;
    if (!migrated.has(block.id)) {
      db.exec("BEGIN IMMEDIATE");
      try {
        block.migrate(db);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      migrated.add(block.id);
    }
    return {
      ...ctx,
      db,
      seal: scoped.seal.bind(scoped),
      open: scoped.open.bind(scoped),
      fingerprint: scoped.fingerprint.bind(scoped),
    };
  }
  async function track<T>(work: () => Promise<T>): Promise<T> {
    if (closed) throw new Error("Toolkit closed");
    const pending = work();
    active.add(pending);
    try {
      return await pending;
    } finally {
      active.delete(pending);
    }
  }
  function dispatch(
    name: string,
    input: unknown = {},
    principal: Principal = trustedLocal,
  ) {
    return track(async () => {
      assertPrincipal(principal);
      const entry = operations.get(name);
      if (!entry)
        throw Object.assign(new Error("Unknown operation: " + name), {
          status: 404,
        });
      const { op, block } = entry;
      if (!visible(op, principal))
        throw Object.assign(
          new Error("This operation requires a different role"),
          { status: 403 },
        );
      const invoke = op.prepare(input);
      const ctx = await context(block, {
        actor: principal.actor,
        role: principal.role,
      });
      if (block.cleanup) await block.cleanup(ctx);
      return await invoke(ctx);
    });
  }
  return {
    eventId,
    catalog(principal = trustedLocal) {
      assertPrincipal(principal);
      return blocks
        .map(
          ({
            id,
            title,
            description,
            scope,
            operations: ops,
            migrate,
          }): Block => ({
            id,
            title,
            description,
            storage: migrate ? (scope ?? "event") : "none",
            operations: ops
              .filter((op) => visible(op, principal))
              .map(({ run, prepare, ...info }) => structuredClone(info)),
          }),
        )
        .filter((block) => block.operations.length);
    },
    // Lookup in the runtime registry loses the correlation between the name and its handler.
    run: dispatch as Toolkit["run"],
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
