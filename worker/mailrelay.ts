import { decryptText, hashText } from "./form-utils.ts";
import { isRecord } from "./speaker-workspace-utils.ts";

interface Config {
  domain: string;
  apiKey: string;
  groupId: number;
  scope: string;
}
interface Job {
  subscriber_id: string;
  revision: number;
  desired_status: "subscribed" | "unsubscribed";
  state: string;
  needs_enrollment: number;
  email_ciphertext: string | null;
  email_iv: string | null;
  remote_id: number | null;
  attempts: number;
  email_hash: string;
}
interface Remote {
  id: number;
  email: string;
  status: string;
  unsubscribed: boolean;
  bounced: boolean;
  reported_spam: boolean;
  local_ban: boolean;
  global_ban: boolean;
  groups?: number[];
}
class SyncError extends Error {
  code: string;
  retryable: boolean;
  retryMs: number;
  constructor(code: string, retryable = false, retryMs = 0) {
    super(code);
    this.code = code;
    this.retryable = retryable;
    this.retryMs = retryMs;
  }
}

export function mailrelayConfig(env: Env): Config | null {
  if (String(env.MAILRELAY_SYNC_ENABLED) !== "true") return null;
  const domain = env.MAILRELAY_ACCOUNT_DOMAIN?.trim().toLowerCase();
  const apiKey = env.MAILRELAY_API_KEY?.trim();
  const groupId = Number(env.MAILRELAY_GROUP_ID);
  if (
    !domain ||
    !/^[a-z0-9][a-z0-9-]*\.ipzmarketing\.com$/u.test(domain) ||
    !apiKey ||
    !Number.isSafeInteger(groupId) ||
    groupId < 1 ||
    !env.EMAIL_ENCRYPTION_KEY
  )
    throw new SyncError("configuration_required");
  return { domain, apiKey, groupId, scope: `${domain}:${groupId}` };
}

export async function mailrelayStatus(env: Env) {
  let config: Config | null;
  try {
    config = mailrelayConfig(env);
  } catch {
    return {
      enabled: true,
      ready: false,
      error: "configuration_required",
      counts: [],
    };
  }
  const control = await env.INTERESTS.prepare(
    "SELECT scope, lease_until, next_request_at FROM newsletter_mailrelay_control WHERE id = 1",
  ).first<{
    scope: string | null;
    lease_until: string;
    next_request_at: string;
  }>();
  const counts = await env.INTERESTS.prepare(
    "SELECT state, COUNT(*) AS count FROM newsletter_mailrelay_sync GROUP BY state",
  ).all();
  const scopeChanged = Boolean(
    config && control?.scope && config.scope !== control.scope,
  );
  return {
    enabled: Boolean(config),
    ready: Boolean(config) && !scopeChanged,
    error: scopeChanged ? "account_or_group_changed" : null,
    counts: counts.results,
    next_request_at: control?.next_request_at || null,
    busy_until: control?.lease_until || null,
  };
}

// Responses are bounded; provider diagnostics may contain PII and are never logged or stored.
async function readProviderJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SyncError("invalid_provider_response", true);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new SyncError("provider_response_too_large");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SyncError("invalid_provider_response", true);
  }
}
function remoteSubscriber(value: unknown, includeGroups = false): Remote {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) < 1 ||
    typeof value.email !== "string" ||
    typeof value.status !== "string" ||
    typeof value.unsubscribed !== "boolean" ||
    typeof value.bounced !== "boolean" ||
    typeof value.reported_spam !== "boolean" ||
    typeof value.local_ban !== "boolean" ||
    typeof value.global_ban !== "boolean"
  )
    throw new SyncError("invalid_provider_subscriber");
  let groups: number[] | undefined;
  if (includeGroups) {
    if (!Array.isArray(value.groups))
      throw new SyncError("invalid_provider_groups");
    groups = value.groups.map((group: unknown) => {
      const id = isRecord(group) ? group.id : group;
      if (!Number.isSafeInteger(id) || Number(id) < 1)
        throw new SyncError("invalid_provider_groups");
      return Number(id);
    });
  }
  return {
    id: Number(value.id),
    email: value.email.trim().toLowerCase(),
    status: value.status,
    unsubscribed: value.unsubscribed,
    bounced: value.bounced,
    reported_spam: value.reported_spam,
    local_ban: value.local_ban,
    global_ban: value.global_ban,
    ...(groups ? { groups } : {}),
  };
}
function providerStatus(remote: Remote) {
  if (remote.unsubscribed) return "unsubscribed";
  if (remote.reported_spam) return "reported_spam";
  if (remote.bounced) return "bounced";
  if (remote.local_ban || remote.global_ban) return "banned";
  return remote.status;
}

/** One serialized, resumable contact per call. Mirrors MonoLisa's safe sync payload. */
export async function syncMailrelay(env: Env) {
  const config = mailrelayConfig(env);
  if (!config) return { processed: false, reason: "disabled" };
  const now = new Date().toISOString();
  const leaseId = crypto.randomUUID();
  const deadline = AbortSignal.timeout(25_000);
  const lease = await env.INTERESTS.prepare(
    `UPDATE newsletter_mailrelay_control SET scope = ?, lease_id = ?, lease_until = ?
     WHERE id = 1 AND lease_until < ? AND next_request_at <= ? AND (scope IS NULL OR scope = ?) RETURNING id`,
  )
    .bind(
      config.scope,
      leaseId,
      new Date(Date.now() + 120_000).toISOString(),
      now,
      now,
      config.scope,
    )
    .first();
  if (!lease) return { processed: false, reason: "busy_or_cooldown" };
  let job: Job | null = null;
  try {
    // Pending withdrawals precede enrollments. Reconcile existing contacts once an hour.
    job = await env.INTERESTS.prepare(
      `SELECT j.*, s.email_hash FROM newsletter_mailrelay_sync j JOIN newsletter_subscribers s ON s.id = j.subscriber_id
       WHERE (j.state = 'pending' AND j.next_attempt_at <= ?) OR
         (j.state IN ('synced', 'blocked') AND j.desired_status = 'subscribed' AND COALESCE(j.checked_at, '') < ?)
       ORDER BY CASE WHEN j.desired_status = 'unsubscribed' THEN 0 WHEN j.state = 'pending' THEN 1 ELSE 2 END, COALESCE(j.checked_at, ''), j.subscriber_id LIMIT 1`,
    )
      .bind(now, new Date(Date.now() - 3_600_000).toISOString())
      .first<Job>();
    if (!job) return { processed: false, reason: "up_to_date" };

    async function api(
      path: string,
      method = "GET",
      body?: unknown,
    ): Promise<Response> {
      const gate = await env.INTERESTS.prepare(
        "SELECT lease_id, lease_until, next_request_at FROM newsletter_mailrelay_control WHERE id = 1",
      ).first<{
        lease_id: string;
        lease_until: string;
        next_request_at: string;
      }>();
      if (
        !gate ||
        gate.lease_id !== leaseId ||
        gate.lease_until <= new Date().toISOString()
      )
        throw new SyncError("lease_expired", true);
      const wait = Date.parse(gate.next_request_at) - Date.now();
      if (wait > 2000) throw new SyncError("rate_limited", true, wait);
      if (wait > 0)
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      await env.INTERESTS.prepare(
        "UPDATE newsletter_mailrelay_control SET next_request_at = ? WHERE id = 1 AND lease_id = ?",
      )
        .bind(new Date(Date.now() + 1500).toISOString(), leaseId)
        .run();
      let response: Response;
      try {
        response = await fetch(`https://${config!.domain}/api/v1/${path}`, {
          method,
          redirect: "error",
          signal: AbortSignal.any([deadline, AbortSignal.timeout(8000)]),
          headers: {
            "X-AUTH-TOKEN": config!.apiKey,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new SyncError("network_error", true);
      }
      if (response.ok || response.status === 404) return response;
      await response.body?.cancel();
      let retryMs = 0;
      if (response.status === 429) {
        const header = response.headers.get("Retry-After");
        const seconds = header === null ? NaN : Number(header);
        retryMs = Number.isFinite(seconds)
          ? Math.max(0, seconds * 1000)
          : Math.max(0, Date.parse(header ?? "") - Date.now());
        if (!Number.isFinite(retryMs) || retryMs < 1500) retryMs = 300_000;
        await env.INTERESTS.prepare(
          "UPDATE newsletter_mailrelay_control SET next_request_at = ? WHERE id = 1 AND lease_id = ?",
        )
          .bind(new Date(Date.now() + retryMs + 250).toISOString(), leaseId)
          .run();
      }
      throw new SyncError(
        `http_${response.status}`,
        response.status === 429 || response.status >= 500,
        retryMs + 250,
      );
    }
    async function identify(remote: Remote) {
      if (
        (await hashText(
          remote.email,
          env.EMAIL_ENCRYPTION_KEY,
          "newsletter-address",
        )) !== job!.email_hash
      )
        throw new SyncError("provider_address_mismatch");
      await env.INTERESTS.prepare(
        "UPDATE newsletter_mailrelay_sync SET remote_id = ? WHERE subscriber_id = ?",
      )
        .bind(remote.id, job!.subscriber_id)
        .run();
    }
    async function getRemote(id: number): Promise<Remote | null> {
      const response = await api(`subscribers/${id}?include_groups=true`);
      if (response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      const remote = remoteSubscriber(await readProviderJson(response), true);
      await identify(remote);
      return remote;
    }
    async function findRemote(email: string): Promise<Remote | null> {
      const response = await api(
        `subscribers?include_groups=true&per_page=1&q%5Bemail_eq%5D=${encodeURIComponent(email)}`,
      );
      const rows = await readProviderJson(response);
      if (!Array.isArray(rows) || rows.length > 1)
        throw new SyncError("invalid_provider_response");
      const remote = rows.length ? remoteSubscriber(rows[0], true) : null;
      if (remote) await identify(remote);
      return remote;
    }
    async function remove(remote: Remote | null) {
      if (remote?.groups?.includes(config!.groupId)) {
        const response = await api(`subscribers/${remote.id}`, "PATCH", {
          group_ids: remote.groups.filter((id) => id !== config!.groupId),
        });
        if (response.status !== 404)
          await identify(remoteSubscriber(await readProviderJson(response)));
        else await response.body?.cancel();
      }
    }
    async function finish(state: string, remoteStatus: string) {
      await env.INTERESTS.prepare(
        "UPDATE newsletter_mailrelay_sync SET state = ?, needs_enrollment = 0, remote_status = ?, checked_at = ?, email_ciphertext = NULL, email_iv = NULL, attempts = 0, error_code = NULL, next_attempt_at = '' WHERE subscriber_id = ? AND revision = ?",
      )
        .bind(
          state,
          remoteStatus,
          new Date().toISOString(),
          job!.subscriber_id,
          job!.revision,
        )
        .run();
    }
    let remote: Remote | null;
    if (job.desired_status === "unsubscribed") {
      if (job.remote_id) remote = await getRemote(job.remote_id);
      else if (job.email_ciphertext && job.email_iv) {
        const email = await decryptText(
          job.email_ciphertext,
          job.email_iv,
          env.EMAIL_ENCRYPTION_KEY,
        );
        remote = await findRemote(email);
      } else remote = null;
      await remove(remote);
      await finish("synced", "removed_from_group");
    } else {
      remote = job.remote_id ? await getRemote(job.remote_id) : null;
      if (
        !job.remote_id ||
        (job.needs_enrollment === 1 &&
          remote &&
          providerStatus(remote) === "active")
      ) {
        const subscriber = await env.INTERESTS.prepare(
          "SELECT status, email_ciphertext, email_iv FROM newsletter_subscribers WHERE id = ?",
        )
          .bind(job.subscriber_id)
          .first<{
            status: string;
            email_ciphertext: string | null;
            email_iv: string | null;
          }>();
        if (
          subscriber?.status !== "subscribed" ||
          !subscriber.email_ciphertext ||
          !subscriber.email_iv
        )
          return { processed: false, reason: "subscription_changed" };
        const email = await decryptText(
          subscriber.email_ciphertext,
          subscriber.email_iv,
          env.EMAIL_ENCRYPTION_KEY,
        );
        // Recover an ambiguous first sync without restoring a group removed in the meantime.
        if (!job.remote_id && job.attempts > 0)
          remote = await findRemote(email);
        if (!remote || job.remote_id) {
          const response = await api("subscribers/sync", "POST", {
            email,
            status: "active",
            group_ids: [config.groupId],
            replace_groups: false,
            restore_if_deleted: false,
          });
          remote = remoteSubscriber(await readProviderJson(response));
          await identify(remote);
          // Fetch groups and current suppression after sync; never assume an existing contact is active.
          await env.INTERESTS.prepare(
            "UPDATE newsletter_mailrelay_sync SET needs_enrollment = 0 WHERE subscriber_id = ? AND revision = ?",
          )
            .bind(job.subscriber_id, job.revision)
            .run();
          remote = await getRemote(remote.id);
        }
      }
      const current = await env.INTERESTS.prepare(
        "SELECT status FROM newsletter_subscribers WHERE id = ?",
      )
        .bind(job.subscriber_id)
        .first<{ status: string }>();
      if (current?.status !== "subscribed") {
        await remove(remote); // Correct an opt-out that raced the provider request.
        return { processed: true, reason: "withdrawal_pending" };
      }
      const withdrawn =
        !remote ||
        remote.unsubscribed ||
        remote.reported_spam ||
        !remote.groups?.includes(config.groupId);
      if (withdrawn) {
        // This update also records withdrawal evidence and queues removal atomically.
        const changed = await env.INTERESTS.prepare(
          "UPDATE newsletter_subscribers SET status = 'unsubscribed', email_ciphertext = NULL, email_iv = NULL, confirmation_hash = NULL, confirmation_expires_at = NULL, unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE id = ? AND status = 'subscribed' AND EXISTS(SELECT 1 FROM newsletter_mailrelay_sync WHERE subscriber_id = ? AND revision = ?) RETURNING id",
        )
          .bind(
            new Date().toISOString(),
            job.subscriber_id,
            job.subscriber_id,
            job.revision,
          )
          .first();
        if (changed) {
          await remove(remote);
          job.revision++;
          await finish(
            "synced",
            remote
              ? providerStatus(remote) === "active"
                ? "removed_from_group"
                : providerStatus(remote)
              : "deleted",
          );
        }
      } else if (remote) {
        const status = providerStatus(remote);
        await finish(status === "active" ? "synced" : "blocked", status);
      }
    }
    return { processed: true, reason: "synced" };
  } catch (error) {
    const failure =
      error instanceof SyncError ? error : new SyncError("sync_error", true);
    if (job)
      await env.INTERESTS.prepare(
        "UPDATE newsletter_mailrelay_sync SET state = ?, attempts = attempts + 1, error_code = ?, next_attempt_at = ? WHERE subscriber_id = ? AND revision = ?",
      )
        .bind(
          failure.retryable ? "pending" : "failed",
          failure.code,
          new Date(
            Date.now() +
              Math.max(
                failure.retryMs,
                Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attempts, 6)),
              ),
          ).toISOString(),
          job.subscriber_id,
          job.revision,
        )
        .run();
    return { processed: false, reason: failure.code };
  } finally {
    await env.INTERESTS.prepare(
      "UPDATE newsletter_mailrelay_control SET lease_id = NULL, lease_until = '' WHERE id = 1 AND lease_id = ?",
    )
      .bind(leaseId)
      .run();
  }
}

/** Bounded hourly catch-up; request handlers wake one contact after preference changes. */
export async function runMailrelaySync(env: Env, limit = 1): Promise<void> {
  try {
    for (let i = 0; i < limit; i++) {
      const result = await syncMailrelay(env);
      if (!result.processed) break;
      if (i + 1 < limit)
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    }
  } catch {
    console.error("mailrelay_sync_failed");
  }
}
