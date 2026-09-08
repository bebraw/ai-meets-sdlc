interface ReceiptBackupRow {
  receipt_id: string;
  speaker_id: string;
  object_key: string;
  byte_size: number;
  details_ciphertext: string;
  status: "submitted" | "processed";
  revision: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

interface ReceiptAccessRow {
  speaker_id: string;
  enabled: number;
  updated_at: string;
}

interface ReceiptBackupFile {
  source_key: string;
  backup_key: string;
  byte_size: number;
  sha256: string;
}

const prefix = "travel-receipts";
const latestKey = `${prefix}/latest.json`;
const maxEncryptedFileBytes = 10 * 1024 * 1024 + 28;

/** Copy encrypted receipt files once and publish a complete, versioned snapshot. */
export async function backupSpeakerReceipts(env: Env): Promise<void> {
  if (!env.INTERESTS || !env.INTEREST_BACKUPS || !env.SPEAKER_UPLOADS) {
    throw new Error("Receipt backup storage is not configured");
  }

  // One D1 batch gives both tables a consistent view. Deleted receipts are
  // intentionally excluded; the cleanup job may already have removed the file.
  const [receiptResult, accessResult] = await env.INTERESTS.batch<
    ReceiptBackupRow | ReceiptAccessRow
  >([
    env.INTERESTS.prepare(
      "SELECT * FROM speaker_travel_receipts WHERE status != 'deleted' ORDER BY receipt_id ASC",
    ),
    env.INTERESTS.prepare(
      "SELECT * FROM speaker_receipt_access ORDER BY speaker_id ASC",
    ),
  ]);
  const receipts = receiptResult!.results as ReceiptBackupRow[];
  const access = accessResult!.results as ReceiptAccessRow[];
  const tables = {
    speaker_travel_receipts: receipts,
    speaker_receipt_access: access,
  };
  const rowsHash = await sha256(
    new TextEncoder().encode(JSON.stringify(tables)),
  );
  const latest = await env.INTEREST_BACKUPS.head(latestKey);
  if (latest?.customMetadata?.rows_hash === rowsHash) return;

  const files: ReceiptBackupFile[] = [];
  for (const receipt of receipts) {
    files.push(await copyReceiptFile(env, receipt));
  }

  const key = `${prefix}/snapshots/${rowsHash}.json`;
  const exportedAt = new Date().toISOString();
  // Content-addressed snapshots also avoid duplicates if the data reverts or
  // overlapping cron invocations observe the same database state.
  await env.INTEREST_BACKUPS.put(
    key,
    JSON.stringify(
      {
        version: 1,
        exported_at: exportedAt,
        rows_hash: rowsHash,
        tables,
        files,
      },
      null,
      2,
    ),
    {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );

  // Advance only after all objects exist, without overwriting a newer run.
  const published = await env.INTEREST_BACKUPS.put(
    latestKey,
    JSON.stringify(
      {
        version: 1,
        key,
        exported_at: exportedAt,
        rows_hash: rowsHash,
        receipt_count: receipts.length,
        file_count: files.length,
      },
      null,
      2,
    ),
    {
      onlyIf: latest ? { etagMatches: latest.etag } : { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );
  if (!published)
    throw new Error("Receipt backup manifest changed during export");
  console.log("speaker_receipts_backup_complete", {
    receipt_count: receipts.length,
    rows_hash: rowsHash,
  });
}

async function copyReceiptFile(
  env: Env,
  receipt: ReceiptBackupRow,
): Promise<ReceiptBackupFile> {
  // Upload keys contain a fresh UUID and their ciphertext is never overwritten.
  const keyHash = await sha256(new TextEncoder().encode(receipt.object_key));
  const backupKey = `${prefix}/files/${keyHash}.enc`;
  const existing = await env.INTEREST_BACKUPS.head(backupKey);
  if (existing) {
    const checksum = existing.customMetadata?.ciphertext_sha256;
    if (
      existing.size !== receipt.byte_size + 28 ||
      !checksum ||
      !/^[a-f0-9]{64}$/.test(checksum)
    ) {
      throw new Error("Stored receipt backup failed integrity checks");
    }
    return {
      source_key: receipt.object_key,
      backup_key: backupKey,
      byte_size: existing.size,
      sha256: checksum,
    };
  }

  const object = await env.SPEAKER_UPLOADS.get(receipt.object_key);
  if (!object)
    throw new Error("Receipt source file is missing; snapshot not published");
  if (
    object.size !== receipt.byte_size + 28 ||
    object.size > maxEncryptedFileBytes
  ) {
    await object.body.cancel();
    throw new Error("Receipt source file has an invalid size");
  }
  // Bounded to one 10 MB encrypted receipt at a time. Hash the ciphertext so
  // an offline restore can verify bytes without access to the encryption key.
  const bytes = await object.arrayBuffer();
  const checksum = await sha256(bytes);
  await env.INTEREST_BACKUPS.put(backupKey, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    sha256: checksum,
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { ciphertext_sha256: checksum },
  });
  return {
    source_key: receipt.object_key,
    backup_key: backupKey,
    byte_size: bytes.byteLength,
    sha256: checksum,
  };
}

async function sha256(
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
    "hex",
  );
}
