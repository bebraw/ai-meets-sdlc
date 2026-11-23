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
  inputSchema: Record<string, unknown>;
  /** Structured MCP result. The package API supplies artifact bytes directly. */
  outputSchema: Record<string, unknown>;
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
export interface StorageDatabase {
  /** Supports SQLite transactions, DDL and multiple SQL statements. */
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: SqlValue[]): Record<string, unknown> | undefined;
    all(...params: SqlValue[]): Record<string, unknown>[];
    iterate(...params: SqlValue[]): Iterable<Record<string, unknown>>;
    run(...params: SqlValue[]): { changes: number | bigint };
  };
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
export interface Toolkit {
  eventId: string;
  catalog(principal?: Principal): Block[];
  run<T extends Record<string, unknown> = Record<string, unknown>>(
    operation: string,
    input?: Record<string, unknown>,
    principal?: Principal,
  ): Promise<T & { artifact?: Artifact }>;
  maintain(): Promise<void>;
  close(): Promise<void>;
}
export const blockIds: readonly string[];
export const roles: readonly Role[];
export function createToolkit(options?: ToolkitOptions): Toolkit;
