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
}
interface Result {
  enabled: boolean;
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
  const more = button("Load more subscribers", () => {
    if (offset !== null) void load(offset);
  });
  more.hidden = true;
  let offset: number | null = 0;
  append(root, status, list, more);
  async function load(start = 0) {
    more.disabled = true;
    try {
      const data = await api<Result>(
        `/api/admin/newsletter?offset=${start}`,
        "manage-newsletter",
      );
      if (!start) list.replaceChildren();
      status.textContent = `${data.enabled ? "Signup enabled" : "Signup disabled by feature flag"}. Marketing delivery awaits provider selection. ${data.counts.map((row) => `${row.count} ${row.status}`).join(" / ") || "No subscriptions yet"}.`;
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
