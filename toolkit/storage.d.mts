import type { StorageHandle, StorageOptions } from "@sdlcai/event-toolkit";

/** Open the Node SQLite and local encryption-key adapter. Omit directory for ephemeral storage. */
export function openStorage(options: StorageOptions): StorageHandle;
