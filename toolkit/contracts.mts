import * as v from "valibot";
import { jsonObjectContract } from "./json-object.mjs";
import { toJsonSchema } from "@valibot/to-json-schema";
export type Role =
  | "organizer"
  | "staff"
  | "public"
  | "speaker"
  | "mc"
  | "moderator"
  | "attendee";
export interface Principal {
  role: Role;
  actor: string;
}
export interface Operation {
  name: string;
  description: string;
  inputSchema: ObjectSchema;
  /** Structured MCP result. The package API supplies artifact bytes directly. */
  outputSchema: JsonSchema;
  example: Record<string, unknown>;
  roles?: Role[];
}
export interface Block {
  id: string;
  title: string;
  description: string;
  storage: "event" | "installation" | "none";
  operations: Operation[];
}
export interface Artifact {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}
/** SQLite values accepted as positional parameters by the stateful blocks. */
export type SqlValue = string | number | null | Uint8Array;
interface StorageStatement<Row> {
  get(...params: SqlValue[]): Row | undefined;
  all(...params: SqlValue[]): Row[];
  iterate(...params: SqlValue[]): Iterable<Row>;
  run(...params: SqlValue[]): { changes: number | bigint };
}
/** SQLite-compatible driver supplied by the host, including Node's DatabaseSync. */
export interface StorageDatabase {
  exec(sql: string): void;
  prepare(sql: string): StorageStatement<Record<string, unknown>>;
}
/** Internal SQL projections name the columns returned by each SELECT. */
export interface QueryDatabase extends StorageDatabase {
  prepare<Row extends object = Record<string, unknown>>(
    sql: string,
  ): StorageStatement<Row>;
}
export interface StorageScope {
  db: StorageDatabase;
  /** Authenticated encryption and a stable keyed fingerprint, private to this scope. */
  seal(plaintext: string): string;
  open(ciphertext: string): string;
  fingerprint(plaintext: string): string;
}
export interface StorageHandle {
  /** Isolated to the event passed to the factory. */
  event(): StorageScope;
  /** Shared by events belonging to the same organizer installation. */
  shared(): StorageScope;
  close(): void | Promise<void>;
}
export interface StorageOptions {
  eventId: string;
  directory?: string;
}
export type StorageFactory = (
  options: StorageOptions,
) => StorageHandle | Promise<StorageHandle>;
export interface ToolkitOptions {
  eventId?: string;
  enabled?: readonly string[];
  /** Omit for an ephemeral database. A directory persists state and its encryption key. */
  directory?: string;
  /** Opened on first stateful use; defaults to the Node SQLite adapter. */
  storage?: StorageFactory;
  services?: {
    organizerStore?: import("./blocks/organizer-store.mjs").OrganizerStore;
    sendMail?(message: {
      to: string;
      subject: string;
      text: string;
    }): Promise<{ id?: string } | void>;
    verifyChallenge?(request: {
      action: string;
      token?: string;
      actor: string;
      eventId: string;
    }): Promise<boolean>;
    actionUrl?(
      operation: string,
      input: Record<string, string>,
      eventId: string,
    ): string | undefined;
  };
}
type BlockCatalog =
  | typeof import("./blocks/print.mjs").blocks
  | typeof import("./blocks/programme.mjs").blocks
  | typeof import("./blocks/workflows.mjs").blocks
  | typeof import("./blocks/engagement.mjs").blocks;
type CatalogOperation = BlockCatalog[number]["operations"][number];
type OperationsByName = {
  [Operation in CatalogOperation as Operation["name"]]: Operation;
};

export type OperationName = keyof OperationsByName;
type HandlerInput<Name extends OperationName> = Parameters<
  OperationsByName[Name]["run"]
>[0];
/** Validated input for one task. A zero-field operation accepts only an empty object. */
export type OperationInput<Name extends OperationName> =
  Name extends OperationName
    ? keyof HandlerInput<Name> extends never
      ? Record<string, never>
      : HandlerInput<Name>
    : never;
export type OperationResult<Name extends OperationName> = Awaited<
  ReturnType<OperationsByName[Name]["run"]>
>;
type CallArgs<Name extends OperationName> =
  {} extends OperationInput<Name>
    ? [input?: OperationInput<Name>, principal?: Principal]
    : [input: OperationInput<Name>, principal?: Principal];
export interface Toolkit {
  eventId: string;
  catalog(principal?: Principal): Block[];
  /** A literal name selects the task's own validated input and result types. */
  run<Name extends OperationName>(
    operation: Name,
    ...args: CallArgs<NoInfer<Name>>
  ): Promise<OperationResult<Name>>;
  /** Discovery clients receive operation names at runtime and can pass untrusted input. */
  run<const Name extends string>(
    operation: Name & (string extends Name ? unknown : never),
    input?: unknown,
    principal?: Principal,
  ): Promise<Record<string, unknown> & { artifact?: Artifact }>;
  /** Compatibility overload for callers that explicitly supply their own result type. */
  run<T extends Record<string, unknown> = never>(
    operation: [T] extends [never] ? never : string,
    input?: unknown,
    principal?: Principal,
  ): Promise<NoInfer<T> & { artifact?: Artifact }>;
  maintain(): Promise<void>;
  close(): Promise<void>;
}

// JSON Schema is the discovery format consumed by browsers and MCP clients.
export interface JsonSchema {
  [key: string]: unknown;
  type?: string | readonly string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  enum?: readonly unknown[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  readOnly?: boolean;
  contentMediaType?: string;
  contentEncoding?: string;
}
export interface ObjectSchema extends JsonSchema {
  type: "object";
  properties: Record<string, JsonSchema>;
}
export type Services = NonNullable<ToolkitOptions["services"]>;
export interface Context extends Principal, StorageScope {
  db: QueryDatabase;
  eventId: string;
  services: Services;
}
export interface InternalOperation extends Operation {
  run(input: unknown, ctx: Context): unknown;
  prepare(input: unknown): (ctx: Context) => unknown;
}
export interface InternalBlock {
  id: string;
  title: string;
  description: string;
  scope?: "event" | "installation";
  migrate?(db: QueryDatabase): void;
  cleanup?(ctx: Context): unknown;
  usesExternalStore?(services: Services): boolean;
  operations: readonly InternalOperation[];
}
export function jsonSchema(schema: v.GenericSchema): JsonSchema {
  const { $schema, ...fields } = toJsonSchema(schema, {
    typeMode: "input",
    // Custom checks enforce the format and uniqueItems constraints declared on those schemas.
    ignoreActions: ["check"],
    overrideSchema(context) {
      const guarded = jsonObjectContract(context);
      if (guarded) return guarded;
      const current = context.jsonSchema;
      const values =
        current.enum ?? ("const" in current ? [current.const] : []);
      const kind = typeof values[0];
      if (
        !current.type &&
        values.length &&
        (kind === "boolean" || kind === "string" || kind === "number") &&
        values.every((v) => typeof v === kind)
      )
        return { ...current, type: kind };
    },
    overrideAction({ valibotAction: action, jsonSchema: current }) {
      if (
        action.type === "regex" &&
        "requirement" in action &&
        action.requirement instanceof RegExp &&
        action.requirement.flags === "u"
      )
        return { ...current, pattern: action.requirement.source };
      if (
        (action.type === "min_code_points" ||
          action.type === "max_code_points") &&
        "requirement" in action
      )
        return {
          ...current,
          [action.type === "min_code_points" ? "minLength" : "maxLength"]:
            action.requirement,
        };
    },
  });
  return fields as JsonSchema;
}
export interface DefinedOperation<
  Name extends string,
  Input,
  Result,
> extends InternalOperation {
  name: Name;
  run(input: Input, ctx: Context): Result;
}

export function defineOperation<
  const N extends string,
  S extends v.GenericSchema,
  R,
>(
  definition: Omit<Operation, "inputSchema" | "example"> & {
    name: N;
    schema: S;
    example: v.InferInput<NoInfer<S>>;
    run(input: v.InferOutput<S>, ctx: Context): R;
  },
): DefinedOperation<N, v.InferInput<S>, R> {
  const { schema, run, example, ...info } = definition;
  const shape = jsonSchema(schema);
  if (shape.type !== "object")
    throw new Error("Tool input must be an object: " + info.name);
  if (!example || typeof example !== "object" || Array.isArray(example))
    throw new Error("Expected an example object for " + info.name);
  function prepare(input: unknown) {
    const parsed = v.safeParse(schema, input);
    if (!parsed.success) {
      const message = parsed.issues
        .map((issue) => {
          const path = v.getDotPath(issue);
          return (path ? "input." + path : "input") + ": " + issue.message;
        })
        .join("; ");
      throw Object.assign(new Error(message), { status: 400 });
    }
    return (ctx: Context) => run(parsed.output, ctx);
  }
  return {
    ...info,
    inputSchema: {
      ...shape,
      type: "object",
      properties: shape.properties ?? {},
    },
    example: example as Record<string, unknown>,
    prepare,
    run: (input, ctx) => prepare(input)(ctx),
  };
}
