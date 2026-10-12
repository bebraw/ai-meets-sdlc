import "./index.ts";
import "./admin-navigation.ts";
import { api, append, button, el, message } from "./admin-toolkit.ts";
interface Subscriber {
  id: string;
  email: string;
  status: string;
  consent_version: string;
  consent_text: string;
  requested_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  sync_state: string | null;
  remote_status: string | null;
  checked_at: string | null;
  sync_error: string | null;
}
interface MailrelayStatus {
  enabled: boolean;
  ready: boolean;
  error: string | null;
  counts: { state: string; count: number }[];
  next_request_at?: string | null;
}
interface Result {
  enabled: boolean;
  mailrelay: MailrelayStatus;
  subscribers: Subscriber[];
  counts: { status: string; count: number }[];
  events: {
    subscriber_id: string;
    action: string;
    consent_version: string;
    occurred_at: string;
  }[];
  next_offset: number | null;
}
const root = document.querySelector<HTMLElement>("[data-admin-newsletter]");
if (root) {
  const status = el("p", "Loading subscriptions…");
  status.setAttribute("role", "status");
  const list = el("div", "", "grid gap-4");
  const syncStatus = el("p", "", "text-sm text-muted");
  syncStatus.setAttribute("role", "status");
  const syncProgress = el("p", "", "text-sm");
  syncProgress.setAttribute("role", "status");
  const sync = button("Sync with Mailrelay", () => void synchronize("start"));
  const retry = button("Retry failed syncs", () => void synchronize("retry"));
  const stop = button("Stop after this contact", () => {
    stopRequested = true;
    stop.disabled = true;
  });
  stop.hidden = true;
  const controls = el("div", "", "flex flex-wrap gap-3");
  append(controls, sync, retry, stop);
  let syncing = false;
  let stopRequested = false;
  let provider: MailrelayStatus | null = null;
  const more = button("Load more subscribers", () => {
    if (offset !== null) void load(offset);
  });
  more.hidden = true;
  let offset: number | null = 0;
  append(root, status, syncStatus, controls, syncProgress, list, more);
  function showSync(state: MailrelayStatus) {
    provider = state;
    sync.disabled = syncing || !state.ready;
    retry.disabled =
      syncing ||
      !state.ready ||
      !state.counts.some((row) => row.state === "failed" && row.count > 0);
    syncStatus.textContent = `${state.enabled ? (state.ready ? "Mailrelay sync enabled" : `Mailrelay needs attention: ${state.error}`) : "Mailrelay sync disabled"}. ${state.counts.map((row) => `${row.count} ${row.state}`).join(" / ") || "No contacts to sync"}. Campaigns are composed and sent in Mailrelay. Sync before each campaign to reconcile unsubscribes.`;
  }
  async function synchronize(action: "start" | "sync" | "retry") {
    syncing = true;
    stopRequested = false;
    stop.hidden = false;
    stop.disabled = false;
    if (provider) showSync(provider);
    let completed = 0;
    try {
      while (!stopRequested) {
        const result = await api<{
          processed: boolean;
          reason: string;
          mailrelay: MailrelayStatus;
        }>("/api/admin/newsletter/mailrelay", "manage-newsletter", "POST", {
          action,
        });
        action = "sync";
        showSync(result.mailrelay);
        if (!result.processed) {
          const unresolved = result.mailrelay.counts.some(
            (row) => ["pending", "failed"].includes(row.state) && row.count > 0,
          );
          syncProgress.textContent = `Sync stopped: ${result.reason.replaceAll("_", " ")}. ${completed} ${completed === 1 ? "contact" : "contacts"} checked. ${unresolved ? "Pending or failed syncs remain. Resolve them before sending a campaign." : "Local withdrawals remain recorded."}`;
          break;
        }
        completed++;
        syncProgress.textContent = `Syncing Mailrelay: ${completed} ${completed === 1 ? "contact" : "contacts"} checked…`;
        // Respect the shared API rate gate between resumable requests.
        const next =
          Date.parse(result.mailrelay.next_request_at ?? "") - Date.now();
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(1500, Number.isFinite(next) ? Math.min(next, 5000) : 0),
          ),
        );
      }
      if (stopRequested)
        syncProgress.textContent = `Sync paused after ${completed} ${completed === 1 ? "contact" : "contacts"}. You can resume later.`;
    } catch (error) {
      syncProgress.textContent = message(error);
    } finally {
      syncing = false;
      stop.hidden = true;
      if (provider) showSync(provider);
      await load();
    }
  }
  async function load(start = 0) {
    more.disabled = true;
    try {
      const data = await api<Result>(
        `/api/admin/newsletter?offset=${start}`,
        "manage-newsletter",
      );
      if (!start) list.replaceChildren();
      status.textContent = `${data.enabled ? "Signup enabled" : "Signup disabled by feature flag"}. ${data.counts.map((row) => `${row.count} ${row.status}`).join(" / ") || "No subscriptions yet"}.`;
      showSync(data.mailrelay);
      for (const row of data.subscribers) {
        const card = el(
          "article",
          "",
          "grid min-w-0 gap-3 border border-ink p-5",
        );
        append(
          card,
          el("h2", row.email, "break-words text-lg font-bold"),
          el(
            "p",
            `${row.status} / requested ${new Date(row.requested_at).toLocaleString()}`,
            "text-sm text-muted",
          ),
        );
        const details = el("details"),
          summary = el(
            "summary",
            "Consent history",
            "cursor-pointer font-bold underline",
          );
        append(
          details,
          summary,
          el("p", row.consent_text, "mt-3 leading-7"),
          el(
            "p",
            `Consent version: ${row.consent_version}`,
            "text-sm text-muted",
          ),
        );
        for (const event of data.events.filter(
          (event) => event.subscriber_id === row.id,
        ))
          append(
            details,
            el(
              "p",
              `${event.action} / ${new Date(event.occurred_at).toLocaleString()} / ${event.consent_version}`,
              "mt-2 text-sm",
            ),
          );
        append(card, details);
        if (row.sync_state)
          append(
            card,
            el(
              "p",
              `Mailrelay: ${row.sync_state}${row.remote_status ? ` / ${row.remote_status}` : ""}${row.sync_error ? ` / ${row.sync_error}` : ""}${row.checked_at ? ` / checked ${new Date(row.checked_at).toLocaleString()}` : ""}`,
              "break-words text-sm text-muted",
            ),
          );
        if (row.status !== "unsubscribed") {
          const remove = button("Unsubscribe", () => {
            remove.disabled = true;
            void api("/api/admin/newsletter", "manage-newsletter", "POST", {
              id: row.id,
            })
              .then(() => load())
              .catch((error: unknown) => {
                status.textContent = message(error);
                remove.disabled = false;
              });
          });
          append(card, remove);
        }
        append(list, card);
      }
      offset = data.next_offset;
      more.hidden = offset === null;
    } catch (error) {
      status.textContent = message(error);
    } finally {
      more.disabled = false;
    }
  }
  void load();
}
