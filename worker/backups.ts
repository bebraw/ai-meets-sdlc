import { sha256Hex } from "./form-utils.ts";

interface BackupManifest {
  rows_hash?: string;
}

export async function backupInterests(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM interests ORDER BY created_at ASC",
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      rows,
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
        row_count: rows.length,
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

export async function backupPosterProposals(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM poster_proposals ORDER BY created_at ASC, id ASC",
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestPosterProposalBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      rows,
    },
    null,
    2,
  );
  const key = `poster-proposals/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "poster-proposals/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        row_count: rows.length,
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

export async function backupCanonicalSpeakerContent(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    `SELECT * FROM canonical_speaker_content
      ORDER BY sort_order ASC, speaker_id ASC`,
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestCanonicalSpeakerBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ exported_at: exportedAt, rows }, null, 2);
  const key = `speaker-content/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "speaker-content/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        row_count: rows.length,
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

async function getLatestPosterProposalBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get(
    "poster-proposals/latest.json",
  );

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

async function getLatestCanonicalSpeakerBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get(
    "speaker-content/latest.json",
  );

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
