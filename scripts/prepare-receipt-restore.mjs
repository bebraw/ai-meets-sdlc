import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const columns = {
  speaker_travel_receipts: [
    "receipt_id",
    "speaker_id",
    "object_key",
    "byte_size",
    "details_ciphertext",
    "status",
    "revision",
    "created_at",
    "updated_at",
    "processed_at",
  ],
  speaker_receipt_access: ["speaker_id", "enabled", "updated_at"],
};

/** Validate a downloaded snapshot and its encrypted files before restoring. */
export async function prepareReceiptRestore(
  snapshotPath,
  filesDirectory,
  outputDirectory,
) {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  if (
    snapshot.version !== 1 ||
    !snapshot.tables ||
    !Array.isArray(snapshot.files)
  ) {
    throw new Error("Unsupported receipt backup snapshot");
  }
  const tables = snapshot.tables;
  if (
    Object.keys(tables).length !== 2 ||
    Object.keys(columns).some((table) => !Array.isArray(tables[table]))
  ) {
    throw new Error("Receipt backup tables are incomplete");
  }
  if (sha256(JSON.stringify(tables)) !== snapshot.rows_hash) {
    throw new Error("Receipt metadata checksum does not match");
  }
  const files = new Map();
  for (const file of snapshot.files) {
    if (
      !/^travel-receipts\/files\/[a-f0-9]{64}\.enc$/.test(file.backup_key) ||
      typeof file.source_key !== "string" ||
      files.has(file.source_key)
    ) {
      throw new Error("Receipt backup file mapping is invalid");
    }
    const localPath = path.resolve(
      filesDirectory,
      path.basename(file.backup_key),
    );
    const bytes = await readFile(localPath);
    if (bytes.length !== file.byte_size || sha256(bytes) !== file.sha256) {
      throw new Error(
        `Receipt file checksum does not match: ${path.basename(file.backup_key)}`,
      );
    }
    files.set(file.source_key, { ...file, local_path: localPath });
  }
  const receiptKeys = new Set();
  for (const row of tables.speaker_travel_receipts) {
    const file = files.get(row.object_key);
    if (
      !file ||
      file.byte_size !== row.byte_size + 28 ||
      row.object_key !==
        `travel-receipts/${row.speaker_id}/${row.receipt_id}.enc` ||
      !/^travel-receipts\/[a-z0-9-]+\/[a-f0-9-]+\.enc$/.test(row.object_key) ||
      !["submitted", "processed"].includes(row.status) ||
      receiptKeys.has(row.object_key)
    ) {
      throw new Error("Receipt row has no matching encrypted file");
    }
    receiptKeys.add(row.object_key);
  }
  if (receiptKeys.size !== files.size)
    throw new Error("Snapshot contains unreferenced files");

  const statements = [
    "-- Apply migration 0013 first. Restore into empty receipt tables.",
  ];
  for (const [table, fields] of Object.entries(columns)) {
    for (const row of tables[table]) {
      statements.push(
        `INSERT INTO ${table} (${fields.join(", ")}) VALUES (${fields.map((field) => sqlValue(row[field])).join(", ")});`,
      );
    }
  }
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    path.join(outputDirectory, "receipts.sql"),
    `${statements.join("\n")}\n`,
  );
  await writeFile(
    path.join(outputDirectory, "files.json"),
    `${JSON.stringify([...files.values()], null, 2)}\n`,
  );
  return { receipts: receiptKeys.size, files: files.size };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function sqlValue(value) {
  if (value === null) return "NULL";
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string" && !value.includes("\0"))
    return `'${value.replaceAll("'", "''")}'`;
  throw new Error("Receipt backup contains an invalid SQL value");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [snapshotPath, filesDirectory, outputDirectory] = process.argv.slice(2);
  if (!snapshotPath || !filesDirectory || !outputDirectory) {
    throw new Error(
      "Usage: node scripts/prepare-receipt-restore.mjs snapshot.json downloaded-files/ restore/",
    );
  }
  console.log(
    await prepareReceiptRestore(snapshotPath, filesDirectory, outputDirectory),
  );
}
