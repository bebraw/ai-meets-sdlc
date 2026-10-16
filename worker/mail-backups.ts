import { sha256Hex } from "./form-utils.ts";

/** Encrypted addresses, consent evidence, suppression and delivery history. No raw link tokens. */
export async function backupMailingData(env: Env): Promise<void> {
  const tables = [
    "newsletter_subscribers",
    "newsletter_consent_events",
    "newsletter_mailrelay_sync",
    "newsletter_mailrelay_control",
    "attendee_message_preferences",
    "attendee_message_draft",
    "attendee_message_campaigns",
    "attendee_message_deliveries",
  ];
  const results = await env.INTERESTS.batch(
    tables.map((table) =>
      env.INTERESTS.prepare(`SELECT * FROM ${table} ORDER BY rowid`),
    ),
  );
  const rows = Object.fromEntries(
    tables.map((table, index) => [table, results[index]!.results]),
  );
  const hash = await sha256Hex(JSON.stringify(rows));
  const latest = await env.INTEREST_BACKUPS.get("mailing/latest.json");
  const now = new Date();
  if (
    latest?.customMetadata?.rows_hash !== hash ||
    latest.uploaded.getTime() < now.getTime() - 86_400_000
  ) {
    const key = `mailing/snapshots/${now.toISOString()}.json`;
    const options = {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: hash },
    };
    await env.INTEREST_BACKUPS.put(
      key,
      JSON.stringify({ exported_at: now.toISOString(), rows }),
      options,
    );
    await env.INTEREST_BACKUPS.put(
      "mailing/latest.json",
      JSON.stringify({ key, exported_at: now.toISOString() }),
      options,
    );
  }
  // Mailing snapshots expire after 30 days, including copies of removed addresses.
  const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  let cursor: string | undefined;
  do {
    const page = await env.INTEREST_BACKUPS.list({
      prefix: "mailing/snapshots/",
      ...(cursor ? { cursor } : {}),
    });
    const expired = page.objects
      .filter(
        (object) => object.key.slice("mailing/snapshots/".length, -5) < cutoff,
      )
      .map((object) => object.key);
    if (expired.length) await env.INTEREST_BACKUPS.delete(expired);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
