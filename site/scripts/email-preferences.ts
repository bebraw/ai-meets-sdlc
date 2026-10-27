import { eventFetch as fetch } from "./event-context.ts";
import "./index.ts";
import { append, buttonClass, el, message } from "./admin-toolkit.ts";
const root = document.querySelector<HTMLElement>("[data-email-preferences]");
if (root) {
  const status = root.querySelector<HTMLElement>(
    "[data-email-preferences-status]",
  )!;
  const token = new URLSearchParams(location.hash.slice(1)).get("token") ?? "";
  // Email scanners can visit GET links safely. Only an explicit button POST changes a preference.
  if (location.hash) history.replaceState(null, "", location.pathname);
  const confirm = location.pathname === "/subscribe/confirm/";
  const event = location.pathname === "/event-email/unsubscribe/";
  if (token) {
    status.textContent = confirm
      ? "Confirm below to start receiving SDLCAI news."
      : "Choose unsubscribe below to stop these emails.";
    const submit = el(
      "button",
      confirm ? "Confirm subscription" : "Unsubscribe",
      buttonClass,
    );
    submit.type = "button";
    append(root, submit);
    submit.addEventListener("click", () => {
      submit.disabled = true;
      status.textContent = "Updating your email preferences…";
      void fetch(
        event
          ? "/api/attendee-messages/unsubscribe"
          : `/api/newsletter/${confirm ? "confirm" : "unsubscribe"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        },
      )
        .then(async (response) => {
          const result = (await response.json()) as {
            error?: string;
            message: string;
            unsubscribe_url?: string;
          };
          if (!response.ok)
            throw new Error(result.error ?? "Unable to update preferences.");
          status.textContent = result.message;
          submit.remove();
          if (result.unsubscribe_url) {
            const link = el("a", "Unsubscribe from SDLCAI news", "underline");
            link.href = result.unsubscribe_url;
            append(root, link);
          }
        })
        .catch((error: unknown) => {
          status.textContent = message(error);
          submit.disabled = false;
        });
    });
  }
}
