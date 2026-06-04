import type { BackupManifest } from "../types";
import { sha256Hex } from "../utils/crypto";

export async function backupInterests(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM interests ORDER BY created_at ASC",
  ).all();
  const { results: cfpProposalResults } = await env.INTERESTS.prepare(
    "SELECT * FROM cfp_proposals ORDER BY created_at ASC",
  ).all();
  const { results: scheduleEntryResults } = await env.INTERESTS.prepare(
    "SELECT * FROM schedule_entries ORDER BY starts_at ASC, sort_order ASC",
  ).all();
  const rows = results ?? [];
  const cfpProposals = cfpProposalResults ?? [];
  const scheduleEntries = scheduleEntryResults ?? [];
  const rowsHash = await sha256Hex(
    JSON.stringify({ cfpProposals, rows, scheduleEntries }),
  );
  const latestBackup = await getLatestBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      cfp_proposals: cfpProposals,
      exported_at: exportedAt,
      rows,
      schedule_entries: scheduleEntries,
    },
    null,
    2,
  );
  const key = `interests/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "interests/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        cfp_proposal_count: cfpProposals.length,
        row_count: rows.length,
        schedule_entry_count: scheduleEntries.length,
        rows_hash: rowsHash,
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );
}

async function getLatestBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get("interests/latest.json");

  if (!latestBackup) return null;

  if (latestBackup.customMetadata?.rows_hash) {
    return { rows_hash: latestBackup.customMetadata.rows_hash };
  }

  try {
    const manifest = await latestBackup.json();

    return isBackupManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function isBackupManifest(value: unknown): value is BackupManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (!("rows_hash" in value) || typeof value.rows_hash === "string")
  );
}
