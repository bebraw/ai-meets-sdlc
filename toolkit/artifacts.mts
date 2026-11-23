import type { Artifact } from "./contracts.mjs";
import { randomUUID } from "node:crypto";

export function artifactStore({
  ttl = 15 * 60_000,
  capacity = 64 * 1024 * 1024,
} = {}) {
  const entries = new Map<
    string,
    Artifact & { bytes: Buffer; owner: string; expires: number }
  >();
  let size = 0;
  function remove(id: string) {
    size -= entries.get(id)!.bytes.length;
    entries.delete(id);
  }
  function put(file: Artifact, owner: string) {
    const bytes = Buffer.from(file.bytes);
    if (bytes.length > capacity)
      throw new Error("Artifact exceeds the size limit");
    for (const [id, entry] of entries)
      if (entry.expires < Date.now() || size + bytes.length > capacity)
        remove(id);
    const id = randomUUID();
    entries.set(id, {
      bytes,
      name: file.name,
      mimeType: file.mimeType,
      owner,
      expires: Date.now() + ttl,
    });
    size += bytes.length;
    return id;
  }
  return {
    put,
    get(id: string, owner: string) {
      const entry = entries.get(id);
      if (!entry) return null;
      if (entry.expires < Date.now()) {
        remove(id);
        return null;
      }
      return entry.owner === owner ? entry : null;
    },
  };
}
export function splitResult(
  result:
    | (Record<string, unknown> & { artifact?: Artifact })
    | null
    | undefined,
) {
  if (!result || !Object.hasOwn(result, "artifact"))
    return { data: result === undefined ? {} : result, file: null };
  const { artifact, ...data } = result;
  return { data, file: artifact };
}
