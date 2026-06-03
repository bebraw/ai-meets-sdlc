type AdminInterest = {
  created_at: string;
  email: string;
  name: string | null;
  organization: string | null;
};

type AdminOrder = {
  amount_total: number | null;
  created_at: string;
  currency: string | null;
  email: string | null;
  order_status: string;
  payment_status: string;
  quantity: number;
  stripe_session_id: string;
  ticket_tier_label: string | null;
};

type AdminTier = {
  available_from: string | null;
  available_quantity: number;
  available_until: string | null;
  capacity: number;
  currency: string | null;
  discount_coupon_id: string | null;
  id: string;
  is_on_sale: boolean;
  label: string;
  price_id: string;
  price_label: string | null;
  reserved_quantity: number;
};

type AdminCounts = {
  interests: number;
  orders: number;
};

type AdminDashboardResponse = {
  counts?: AdminCounts;
  error?: string;
  interests?: AdminInterest[];
  limit?: number;
  offset?: number;
  orders?: AdminOrder[];
  tiers?: AdminTier[];
};

type AdminRegisterResponse = {
  error?: string;
  order?: AdminOrder;
};

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

function initAdmin() {
  const refreshButton = document.querySelector(
    "[data-refresh-admin]",
  ) as HTMLButtonElement | null;
  const registerForm = document.querySelector(
    "[data-admin-register-form]",
  ) as HTMLFormElement | null;
  const status = document.querySelector("[data-admin-status]");
  const submit = document.querySelector(
    "[data-admin-register-submit]",
  ) as HTMLButtonElement | null;

  function setStatus(message: string) {
    if (status) {
      status.textContent = message;
    }
  }

  async function loadDashboard() {
    setStatus("Loading admin data...");

    try {
      const response = await fetch("/api/admin/dashboard");
      const result = (await response.json()) as AdminDashboardResponse;

      if (!response.ok || result.error || !result.tiers) {
        throw new Error(result.error || "Admin data unavailable");
      }

      renderDashboard({
        counts: result.counts,
        interests: result.interests ?? [],
        orders: result.orders ?? [],
        tiers: result.tiers,
      });
      setStatus(
        result.counts
          ? `Showing latest ${result.limit ?? 50} rows per table; totals: ${result.counts.interests} preregistrations, ${result.counts.orders} registrations.`
          : `Showing latest ${result.limit ?? 50} rows per table.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Admin data failed");
    }
  }

  registerForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!registerForm.checkValidity() || submit?.disabled) return;

    submit?.setAttribute("disabled", "true");
    setStatus("Registering attendee...");

    try {
      const response = await fetch("/api/admin/register", {
        headers: {
          "x-admin-action": "register",
        },
        method: "POST",
        body: new FormData(registerForm),
      });
      const result = (await response.json()) as AdminRegisterResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Registration failed");
      }

      registerForm.reset();
      setStatus("Attendee registered.");
      await loadDashboard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Registration failed");
    } finally {
      submit?.removeAttribute("disabled");
    }
  });

  refreshButton?.addEventListener("click", () => {
    void loadDashboard();
  });

  void loadDashboard();
}

function renderDashboard({
  counts,
  interests,
  orders,
  tiers,
}: {
  counts: AdminCounts | undefined;
  interests: AdminInterest[];
  orders: AdminOrder[];
  tiers: AdminTier[];
}) {
  renderMetrics({ counts, interests, orders, tiers });
  renderTierSelect(tiers);
  renderTiers(tiers);
  renderOrders(orders);
  renderInterests(interests);
}

function renderMetrics({
  counts,
  interests,
  orders,
  tiers,
}: {
  counts: AdminCounts | undefined;
  interests: AdminInterest[];
  orders: AdminOrder[];
  tiers: AdminTier[];
}) {
  const root = document.querySelector("[data-admin-metrics]");
  const paidTickets = orders
    .filter((order) => order.order_status === "paid")
    .reduce((total, order) => total + order.quantity, 0);
  const capacity = tiers.reduce((total, tier) => total + tier.capacity, 0);

  if (!root) return;

  root.innerHTML = "";
  root.className = "mt-8 grid gap-px border border-ink bg-ink md:grid-cols-4";

  for (const metric of [
    ["Paid tickets", String(paidTickets)],
    ["Capacity", String(capacity)],
    ["Preregistrations", String(counts?.interests ?? interests.length)],
    ["Orders", String(counts?.orders ?? orders.length)],
  ]) {
    const item = document.createElement("div");
    const label = document.createElement("p");
    const value = document.createElement("strong");

    item.className = "bg-paper p-4";
    label.className = "text-sm font-bold uppercase text-muted";
    value.className = "mt-2 block font-headline text-4xl font-black";
    label.textContent = metric[0] ?? "";
    value.textContent = metric[1] ?? "";
    item.appendChild(label);
    item.appendChild(value);
    root.appendChild(item);
  }
}

function renderTierSelect(tiers: AdminTier[]) {
  const select = document.querySelector(
    "[data-admin-tier-select]",
  ) as HTMLSelectElement | null;

  if (!select) return;

  select.innerHTML = "";

  for (const tier of tiers) {
    const option = document.createElement("option");
    const price = tier.price_label ? ` / ${tier.price_label}` : "";

    option.value = tier.id;
    option.disabled = tier.available_quantity < 1;
    option.textContent = `${tier.label}${price} / ${tier.available_quantity} left`;
    select.add(option);
  }
}

function renderTiers(tiers: AdminTier[]) {
  const body = document.querySelector("[data-admin-tiers]");

  if (!body) return;

  body.innerHTML = "";

  for (const tier of tiers) {
    appendRow(body, [
      `${tier.label} (${tier.id})`,
      tier.price_label || tier.price_id,
      tier.discount_coupon_id || "None",
      formatSaleWindow(tier),
      `${tier.reserved_quantity}/${tier.capacity}`,
      String(tier.available_quantity),
    ]);
  }
}

function renderOrders(orders: AdminOrder[]) {
  const body = document.querySelector("[data-admin-orders]");

  if (!body) return;

  body.innerHTML = "";

  for (const order of orders) {
    appendRow(body, [
      order.email || "",
      order.ticket_tier_label || "",
      String(order.quantity),
      order.order_status,
      order.payment_status,
      formatDate(order.created_at),
      order.stripe_session_id,
    ]);
  }
}

function renderInterests(interests: AdminInterest[]) {
  const body = document.querySelector("[data-admin-interests]");

  if (!body) return;

  body.innerHTML = "";

  for (const interest of interests) {
    appendRow(body, [
      interest.email,
      interest.name || "",
      interest.organization || "",
      formatDate(interest.created_at),
    ]);
  }
}

function appendRow(body: Element, cells: string[]) {
  const row = document.createElement("tr");

  row.className = "border-t border-ink";

  for (const [index, value] of cells.entries()) {
    const cell = document.createElement("td");

    cell.className =
      index === 2 && /^\d+$/.test(value) ? "px-3 py-2 text-right" : "px-3 py-2";
    cell.textContent = value;
    row.appendChild(cell);
  }

  body.appendChild(row);
}

function formatSaleWindow(tier: AdminTier): string {
  const start = tier.available_from ? formatDate(tier.available_from) : "Now";
  const end = tier.available_until ? formatDate(tier.available_until) : "Open";
  const status = tier.is_on_sale ? "on sale" : "closed";

  return `${start} to ${end} (${status})`;
}

function formatDate(value: string): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

initThemeToggle();
initAdmin();

export {};
