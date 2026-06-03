type CheckoutResponse = {
  detail?: string;
  error?: string;
  message?: string;
  session_id?: string;
  url?: string;
};

type CfpResponse = {
  error?: string;
  message?: string;
};

type OrderResponse = {
  error?: string;
  order?: {
    order_status?: string;
    payment_status?: string;
    quantity?: number;
    ticket_tier_label?: string | null;
  };
};

type TicketTier = {
  available_quantity: number;
  capacity: number;
  currency?: string | null;
  id: string;
  is_on_sale: boolean;
  label: string;
  price_label?: string | null;
  reserved_quantity: number;
};

type TicketTiersResponse = {
  error?: string;
  tiers?: TicketTier[];
};

type ScheduleEntry = {
  description?: string | null;
  ends_at?: string | null;
  entry_type: string;
  id: number;
  location?: string | null;
  organization?: string | null;
  presenter?: string | null;
  starts_at: string;
  title: string;
};

type ScheduleResponse = {
  entries?: ScheduleEntry[];
  error?: string;
};

const target = new Date("2026-10-13T09:00:00+03:00");
const units: [string, number][] = [
  ["days", 24 * 60 * 60 * 1000],
  ["hours", 60 * 60 * 1000],
  ["minutes", 60 * 1000],
  ["seconds", 1000],
];

function renderCountdown() {
  const root = document.querySelector("[data-countdown]");

  if (!root) return;

  let remaining = Math.max(0, target.getTime() - Date.now());

  for (const [name, size] of units) {
    const value = Math.floor(remaining / size);
    remaining -= value * size;

    const node = root.querySelector(`[data-countdown-unit="${name}"]`);

    if (node) {
      node.textContent = String(value).padStart(name === "days" ? 3 : 2, "0");
    }
  }
}

function setTheme(theme: "dark" | "light") {
  const themeLabel = document.querySelector("[data-theme-label]");

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;

  if (themeLabel) {
    themeLabel.textContent = theme === "dark" ? "Light" : "Dark";
  }

  try {
    localStorage.setItem("sdlcai-theme", theme);
  } catch {
    // Ignore blocked storage.
  }
}

function initThemeToggle() {
  const themeToggle = document.querySelector("[data-theme-toggle]");

  setTheme(
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );

  themeToggle?.addEventListener("click", () => {
    setTheme(
      document.documentElement.classList.contains("dark") ? "light" : "dark",
    );
  });
}

function initCheckoutForm() {
  const checkoutForm = document.querySelector<HTMLFormElement>(
    "[data-checkout-form]",
  );
  const checkoutStatus = document.querySelector("[data-checkout-status]");
  const submitButton = document.querySelector<HTMLButtonElement>(
    "[data-checkout-submit]",
  );
  const ticketTierSelect = document.querySelector(
    "[data-ticket-tier-select]",
  ) as HTMLSelectElement | null;
  const ticketTierList = document.querySelector(
    "[data-ticket-tier-list]",
  ) as HTMLElement | null;

  function setCheckoutStatus(message: string) {
    if (checkoutStatus) {
      checkoutStatus.textContent = message;
    }
  }

  if (!checkoutForm || !submitButton) return;

  const form = checkoutForm;
  const button = submitButton;
  const checkoutsEnabled = form.dataset.checkoutsEnabled === "true";
  const checkoutOutcome = new URLSearchParams(window.location.search).get(
    "checkout",
  );
  const checkoutSessionId = new URLSearchParams(window.location.search).get(
    "session_id",
  );

  if (checkoutOutcome === "success") {
    setCheckoutStatus("Payment completed. Checking order status...");

    if (checkoutSessionId) {
      void refreshOrderStatus(checkoutSessionId);
    }
  }

  async function refreshOrderStatus(sessionId: string) {
    try {
      const response = await fetch(
        `/api/order?session_id=${encodeURIComponent(sessionId)}`,
      );
      const result = (await response.json()) as OrderResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Order status unavailable");
      }

      const orderStatus = result.order?.order_status || "pending";
      const quantity = result.order?.quantity;
      const ticketTierLabel = result.order?.ticket_tier_label;
      const quantityText =
        typeof quantity === "number"
          ? `${quantity} ticket${quantity === 1 ? "" : "s"}`
          : "ticket order";
      const tierText = ticketTierLabel ? ` (${ticketTierLabel})` : "";

      setCheckoutStatus(
        orderStatus === "paid"
          ? `Order paid for ${quantityText}${tierText}. Stripe will send your receipt.`
          : `Order status: ${orderStatus}${tierText}. Stripe will send your receipt when payment is complete.`,
      );
    } catch (error) {
      setCheckoutStatus(
        error instanceof Error ? error.message : "Order status unavailable",
      );
    }
  }

  async function refreshTicketTiers() {
    if (!ticketTierSelect || !ticketTierList) return;

    try {
      const response = await fetch("/api/ticket-tiers");
      const result = (await response.json()) as TicketTiersResponse;

      if (!response.ok || result.error || !result.tiers) {
        throw new Error(result.error || "Ticket tiers unavailable");
      }

      renderTicketTiers(result.tiers);
    } catch (error) {
      ticketTierSelect.innerHTML =
        '<option value="">Ticket tiers unavailable</option>';
      ticketTierList.textContent =
        error instanceof Error ? error.message : "Ticket tiers unavailable";
      button.disabled = true;
    }
  }

  function renderTicketTiers(tiers: TicketTier[]) {
    if (!ticketTierSelect || !ticketTierList) return;

    const availableTiers = tiers.filter(
      (tier) => tier.is_on_sale && tier.available_quantity > 0,
    );

    ticketTierSelect.innerHTML = "";

    for (const tier of tiers) {
      const option = document.createElement("option");
      const status =
        tier.available_quantity > 0
          ? `${tier.available_quantity} left`
          : "sold out";
      const price = tier.price_label ? ` / ${tier.price_label}` : "";

      option.value = tier.id;
      option.disabled = !tier.is_on_sale || tier.available_quantity < 1;
      option.textContent = `${tier.label}${price} / ${status}`;
      ticketTierSelect.add(option);
    }

    ticketTierList.innerHTML = "";

    for (const tier of tiers) {
      const row = document.createElement("div");
      const price = tier.price_label ? ` / ${tier.price_label}` : "";
      const status = tier.is_on_sale
        ? `${tier.available_quantity} of ${tier.capacity} left`
        : "not on sale";

      row.className =
        "flex items-center justify-between gap-4 bg-paper p-3 text-muted";
      row.innerHTML = `<strong class="text-ink">${escapeHtml(tier.label)}${escapeHtml(price)}</strong><span>${escapeHtml(status)}</span>`;
      ticketTierList.appendChild(row);
    }

    const firstAvailableTier = availableTiers[0];

    if (firstAvailableTier) {
      ticketTierSelect.value = firstAvailableTier.id;
      button.disabled = false;
    } else {
      button.disabled = true;
      setCheckoutStatus("Tickets are currently sold out.");
    }
  }

  async function submitCheckoutForm() {
    if (!checkoutsEnabled) {
      setCheckoutStatus("Ticket checkout is not open yet.");
      return;
    }

    if (button.disabled || !form.checkValidity()) return;

    button.disabled = true;
    setCheckoutStatus("Starting checkout...");

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
      });
      const contentType = response.headers.get("content-type") || "";
      const result: CheckoutResponse = contentType.includes("application/json")
        ? ((await response.json()) as CheckoutResponse)
        : {
            error: `${response.status} ${response.statusText || "Unexpected response"}`,
            detail: await response.text(),
          };

      if (!response.ok || result.error || !result.url) {
        throw new Error(result.error || "Checkout failed");
      }

      window.location.assign(result.url);
    } catch (error) {
      setCheckoutStatus(
        error instanceof Error ? error.message : "Checkout failed",
      );
      button.disabled = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    await submitCheckoutForm();
  });

  if (checkoutsEnabled) {
    void refreshTicketTiers();
  } else {
    button.disabled = true;
    ticketTierSelect?.setAttribute("disabled", "true");
    setCheckoutStatus("Ticket checkout is not open yet.");
  }
}

function initCfpForm() {
  const cfpSection = document.querySelector(
    "[data-cfp-section]",
  ) as HTMLElement | null;
  const cfpNav = document.querySelector("[data-cfp-nav]") as HTMLElement | null;
  const cfpForm = document.querySelector(
    "[data-cfp-form]",
  ) as HTMLFormElement | null;
  const cfpStatus = document.querySelector("[data-cfp-status]");
  const submitButton = document.querySelector(
    "[data-cfp-submit]",
  ) as HTMLButtonElement | null;
  const cfpEnabled = cfpSection?.dataset.cfpEnabled === "true";

  function setCfpStatus(message: string) {
    if (cfpStatus) {
      cfpStatus.textContent = message;
    }
  }

  if (!cfpSection || !cfpForm || !submitButton) return;

  if (!cfpEnabled) {
    cfpSection.remove();
    cfpNav?.remove();
    return;
  }

  cfpSection.classList.remove("hidden");
  cfpNav?.classList.remove("hidden");

  cfpForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (submitButton.disabled || !cfpForm.checkValidity()) return;

    submitButton.disabled = true;
    setCfpStatus("Submitting proposal...");

    try {
      const response = await fetch(cfpForm.action, {
        method: "POST",
        body: new FormData(cfpForm),
      });
      const result = (await response.json()) as CfpResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Proposal submission failed");
      }

      cfpForm.reset();
      setCfpStatus(result.message || "Proposal received.");
    } catch (error) {
      setCfpStatus(
        error instanceof Error ? error.message : "Proposal submission failed",
      );
    } finally {
      submitButton.disabled = false;
    }
  });
}

function initPublicSchedule() {
  const root = document.querySelector("[data-public-schedule]");

  if (!root) return;

  void refreshSchedule(root);
}

async function refreshSchedule(root: Element) {
  try {
    const response = await fetch("/api/schedule");
    const result = (await response.json()) as ScheduleResponse;

    if (!response.ok || result.error || !result.entries) {
      throw new Error(result.error || "Schedule unavailable");
    }

    renderSchedule(root, result.entries);
  } catch {
    renderSchedule(root, []);
  }
}

function renderSchedule(root: Element, entries: ScheduleEntry[]) {
  root.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    const title = document.createElement("p");
    const text = document.createElement("p");

    empty.className = "bg-paper p-5";
    title.className = "font-headline text-2xl font-black uppercase";
    text.className = "mt-3 leading-7 text-muted";
    title.textContent = "Schedule is being planned";
    text.textContent =
      "The public seminar schedule will appear here when sessions are published.";
    empty.appendChild(title);
    empty.appendChild(text);
    root.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("article");
    const time = document.createElement("p");
    const content = document.createElement("div");
    const label = document.createElement("p");
    const title = document.createElement("h3");
    const meta = document.createElement("p");
    const description = document.createElement("p");

    row.className =
      "grid gap-4 bg-paper p-5 md:grid-cols-[9rem_1fr] md:items-start";
    time.className =
      "font-headline text-3xl font-black uppercase leading-none md:text-right";
    content.className = "min-w-0";
    label.className = "text-sm font-bold uppercase text-muted";
    title.className = "mt-2 font-headline text-3xl font-black uppercase";
    meta.className = "mt-3 text-base font-bold text-muted";
    description.className = "mt-4 max-w-3xl leading-7 text-muted";

    time.textContent = formatScheduleRange(entry);
    label.textContent = formatScheduleEntryType(entry.entry_type);
    title.textContent = entry.title;
    meta.textContent = [entry.presenter, entry.organization, entry.location]
      .filter(Boolean)
      .join(" / ");
    description.textContent = entry.description || "";

    content.appendChild(label);
    content.appendChild(title);

    if (meta.textContent) {
      content.appendChild(meta);
    }

    if (description.textContent) {
      content.appendChild(description);
    }

    row.appendChild(time);
    row.appendChild(content);
    root.appendChild(row);
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function formatScheduleRange(entry: ScheduleEntry): string {
  const start = formatTime(entry.starts_at);
  const end = formatTime(entry.ends_at ?? null);

  return end ? `${start}-${end}` : start;
}

function formatTime(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Helsinki",
  });
}

function formatScheduleEntryType(value: string): string {
  if (value === "talk") return "Talk";
  if (value === "workshop") return "Workshop";
  if (value === "panel") return "Panel";
  if (value === "poster") return "Poster";
  if (value === "break") return "Break";
  if (value === "other") return "Other";

  return value;
}

renderCountdown();
setInterval(renderCountdown, 1000);
initThemeToggle();
initCheckoutForm();
initCfpForm();
initPublicSchedule();

export {};
