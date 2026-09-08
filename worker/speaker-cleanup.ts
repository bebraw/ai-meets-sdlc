import { loginRequestRetentionMilliseconds } from "./speaker-workspace-utils.ts";
import { purgeDeletedSpeakerReceipts } from "./speaker-receipts.ts";

export async function purgeExpiredSpeakerWorkspaceData(
  env: Env,
): Promise<void> {
  if (!env.INTERESTS) return;

  const now = new Date();
  await purgeDeletedSpeakerReceipts(env);
  const nowIso = now.toISOString();
  const retentionStart = new Date(
    now.getTime() - loginRequestRetentionMilliseconds,
  ).toISOString();

  await env.INTERESTS.batch([
    env.INTERESTS.prepare(
      "DELETE FROM speaker_workspace_sessions WHERE expires_at <= ?1",
    ).bind(nowIso),
    env.INTERESTS.prepare(
      `DELETE FROM speaker_magic_links
          WHERE expires_at <= ?1
             OR (consumed_at IS NOT NULL AND consumed_at < ?2)`,
    ).bind(nowIso, retentionStart),
    env.INTERESTS.prepare(
      "DELETE FROM speaker_login_requests WHERE created_at < ?1",
    ).bind(retentionStart),
    env.INTERESTS.prepare(
      "DELETE FROM speaker_presentation_responses WHERE expires_at <= ?1",
    ).bind(nowIso),
  ]);
}
