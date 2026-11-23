import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateEventId } from "./event-id.mjs";

import type {
  StorageScope,
  StorageHandle,
  StorageOptions,
} from "./contracts.mjs";
function isFsError(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}
function keyForDirectory(directory: string) {
  const target = join(directory, "encryption.key");
  try {
    return readFileSync(target);
  } catch (error) {
    if (!isFsError(error, "ENOENT")) throw error;
  }
  if (
    readdirSync(directory).some(
      (name) =>
        name === "installation.sqlite" ||
        /^event-[a-z0-9-]+\.sqlite$/.test(name),
    )
  ) {
    // Another process may have initialized the key and its database since our first read.
    try {
      return readFileSync(target);
    } catch (error) {
      if (!isFsError(error, "ENOENT")) throw error;
      throw new Error(
        "Existing toolkit data is missing its encryption key. Restore encryption.key from the same backup.",
      );
    }
  }
  const temporary = join(directory, randomUUID() + ".key");
  writeFileSync(temporary, randomBytes(32), { mode: 0o600, flag: "wx" });
  try {
    linkSync(temporary, target);
  } catch (error) {
    if (!isFsError(error, "EEXIST")) throw error;
  } finally {
    unlinkSync(temporary);
  }
  return readFileSync(target);
}

export function openStorage({
  directory,
  eventId,
}: StorageOptions): StorageHandle {
  validateEventId(eventId);
  if (directory) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = directory ? keyForDirectory(directory) : randomBytes(32);
  if (key.length !== 32)
    throw new Error("Expected a 32-byte toolkit encryption key");
  const connections = new Map<string, StorageScope & { db: DatabaseSync }>();
  function forScope(scope: string): StorageScope {
    if (connections.has(scope)) return connections.get(scope)!;
    const filename = directory
      ? join(directory, scope + ".sqlite")
      : ":memory:";
    const db = new DatabaseSync(filename);
    try {
      if (directory) chmodSync(filename, 0o600);
      // Keep the file's journal mode. Changing it needs an exclusive lock and can
      // race when the web and MCP processes first open the same event.
      db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE",
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS toolkit_owner (id INTEGER PRIMARY KEY CHECK(id=1), scope TEXT NOT NULL)",
      );
      db.prepare(
        "INSERT OR IGNORE INTO toolkit_owner(id,scope) VALUES(1,?)",
      ).run(scope);
      if (
        db.prepare("SELECT scope FROM toolkit_owner WHERE id=1").get()
          ?.scope !== scope
      )
        throw new Error("Storage belongs to a different event or installation");
      const subkey = (purpose: string) =>
        createHmac("sha256", key)
          .update(purpose + "/" + scope)
          .digest();
      const cipherKey = subkey("encrypt");
      const hashKey = subkey("fingerprint");
      const keyId = subkey("database-key-check").toString("hex");
      db.exec(
        "CREATE TABLE IF NOT EXISTS toolkit_key_check (id INTEGER PRIMARY KEY CHECK(id=1), key_id TEXT NOT NULL)",
      );
      db.prepare("INSERT OR IGNORE INTO toolkit_key_check VALUES(1,?)").run(
        keyId,
      );
      if (
        db.prepare("SELECT key_id FROM toolkit_key_check WHERE id=1").get()
          ?.key_id !== keyId
      )
        throw new Error(
          "The encryption key does not match this database. Restore encryption.key from the same backup.",
        );
      db.exec("COMMIT");
      const result = {
        db,
        seal(value: string) {
          const iv = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", cipherKey, iv);
          const bytes = Buffer.concat([
            cipher.update(value, "utf8"),
            cipher.final(),
          ]);
          return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
            "base64url",
          );
        },
        open(value: string) {
          const bytes = Buffer.from(value, "base64url");
          const cipher = createDecipheriv(
            "aes-256-gcm",
            cipherKey,
            bytes.subarray(0, 12),
          );
          cipher.setAuthTag(bytes.subarray(12, 28));
          return Buffer.concat([
            cipher.update(bytes.subarray(28)),
            cipher.final(),
          ]).toString("utf8");
        },
        fingerprint(value: string) {
          return createHmac("sha256", hashKey).update(value).digest("hex");
        },
      };
      connections.set(scope, result);
      return result;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return {
    event: () => forScope("event-" + eventId),
    shared: () => forScope("installation"),
    close() {
      for (const { db } of connections.values()) db.close();
      connections.clear();
    },
  };
}
