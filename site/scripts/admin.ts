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

type AdminCfpProposal = {
  bio: string | null;
  created_at: string;
  email: string;
  format: string;
  id: number;
  name: string;
  organization: string | null;
  summary: string;
  title: string;
};

type AdminScheduleEntry = {
  cfp_proposal_id: number | null;
  created_at: string;
  description: string | null;
  ends_at: string | null;
  entry_type: string;
  id: number;
  is_published: boolean;
  location: string | null;
  organization: string | null;
  presenter: string | null;
  sort_order: number;
  starts_at: string;
  title: string;
  updated_at: string;
};

type AdminTier = {
  available_from: string | null;
  available_quantity: number;
  available_until: string | null;
  capacity: number;
  currency: string | null;
  discount_coupon_id: string | null;
  id: string;
  is_active: boolean;
  is_on_sale: boolean;
  label: string;
  price_id: string;
  price_label: string | null;
  reserved_quantity: number;
  sort_order: number;
  tito_release_slug: string | null;
};

type AdminFeatureFlag = {
  default_enabled: boolean;
  description: string;
  enabled: boolean;
  key: string;
  label: string;
  source: string;
  updated_at: string | null;
};

type AdminCounts = {
  cfp_proposals: number;
  interests: number;
  orders: number;
};

type AdminDashboardResponse = {
  counts?: AdminCounts;
  cfp_proposals?: AdminCfpProposal[];
  error?: string;
  feature_flags?: AdminFeatureFlag[];
  interests?: AdminInterest[];
  limit?: number;
  offset?: number;
  orders?: AdminOrder[];
  schedule_entries?: AdminScheduleEntry[];
  tiers?: AdminTier[];
};

type AdminRegisterResponse = {
  error?: string;
  order?: AdminOrder;
};

type AdminScheduleResponse = {
  deleted_id?: number;
  error?: string;
};

type AdminTierResponse = {
  deleted_id?: string;
  error?: string;
};

type AdminFeatureFlagResponse = {
  error?: string;
  feature_flags?: AdminFeatureFlag[];
};

let currentCfpProposals: AdminCfpProposal[] = [];
let currentScheduleEntries: AdminScheduleEntry[] = [];
let currentTiers: AdminTier[] = [];

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
  const scheduleForm = document.querySelector(
    "[data-admin-schedule-form]",
  ) as HTMLFormElement | null;
  const scheduleSubmit = document.querySelector(
    "[data-admin-schedule-submit]",
  ) as HTMLButtonElement | null;
  const scheduleClear = document.querySelector(
    "[data-admin-schedule-clear]",
  ) as HTMLButtonElement | null;
  const scheduleCfpSelect = document.querySelector(
    "[data-schedule-cfp-select]",
  ) as HTMLSelectElement | null;
  const tierForm = document.querySelector(
    "[data-admin-tier-form]",
  ) as HTMLFormElement | null;
  const tierSubmit = document.querySelector(
    "[data-admin-tier-submit]",
  ) as HTMLButtonElement | null;
  const tierClear = document.querySelector(
    "[data-admin-tier-clear]",
  ) as HTMLButtonElement | null;
  const featureFlagForm = document.querySelector(
    "[data-admin-feature-flags-form]",
  ) as HTMLFormElement | null;
  const featureFlagSubmit = document.querySelector(
    "[data-admin-feature-flags-submit]",
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
        cfpProposals: result.cfp_proposals ?? [],
        counts: result.counts,
        featureFlags: result.feature_flags ?? [],
        interests: result.interests ?? [],
        orders: result.orders ?? [],
        scheduleEntries: result.schedule_entries ?? [],
        tiers: result.tiers,
      });
      setStatus(
        result.counts
          ? `Showing latest ${result.limit ?? 50} rows per table; totals: ${result.counts.cfp_proposals} CFP proposals, ${result.counts.interests} preregistrations, ${result.counts.orders} registrations.`
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

  scheduleForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!scheduleForm.checkValidity() || scheduleSubmit?.disabled) return;

    scheduleSubmit?.setAttribute("disabled", "true");
    setStatus("Saving schedule entry...");

    try {
      const response = await fetch("/api/admin/schedule", {
        headers: {
          "x-admin-action": "schedule",
        },
        method: "POST",
        body: new FormData(scheduleForm),
      });
      const result = (await response.json()) as AdminScheduleResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Schedule save failed");
      }

      resetScheduleForm();
      setStatus("Schedule entry saved.");
      await loadDashboard();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Schedule save failed",
      );
    } finally {
      scheduleSubmit?.removeAttribute("disabled");
    }
  });

  scheduleClear?.addEventListener("click", () => {
    resetScheduleForm();
  });

  scheduleCfpSelect?.addEventListener("change", () => {
    const proposal = currentCfpProposals.find(
      (candidate) => String(candidate.id) === scheduleCfpSelect.value,
    );

    if (!proposal || !scheduleForm) return;

    setScheduleField(
      "entry_type",
      proposal.format === "poster" ? "poster" : "talk",
    );
    setScheduleField("title", proposal.title);
    setScheduleField("presenter", proposal.name);
    setScheduleField("organization", proposal.organization || "");
    setScheduleField("description", proposal.summary);
  });

  tierForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!tierForm.checkValidity() || tierSubmit?.disabled) return;

    tierSubmit?.setAttribute("disabled", "true");
    setStatus("Saving ticket tier...");

    try {
      const response = await fetch("/api/admin/ticket-tier", {
        headers: {
          "x-admin-action": "ticket-tier",
        },
        method: "POST",
        body: new FormData(tierForm),
      });
      const result = (await response.json()) as AdminTierResponse;

      if (!response.ok || result.error) {
        throw new Error(result.error || "Ticket tier save failed");
      }

      resetTierForm();
      setStatus("Ticket tier saved.");
      await loadDashboard();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Ticket tier save failed",
      );
    } finally {
      tierSubmit?.removeAttribute("disabled");
    }
  });

  tierClear?.addEventListener("click", () => {
    resetTierForm();
  });

  featureFlagForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (featureFlagSubmit?.disabled) return;

    featureFlagSubmit?.setAttribute("disabled", "true");
    setStatus("Saving feature flags...");

    try {
      const formData = new FormData(featureFlagForm);
      const flagKeys = formData.getAll("flag_key");

      for (const key of flagKeys) {
        const flagFormData = new FormData();
        const normalizedKey = typeof key === "string" ? key : "";

        flagFormData.set("key", normalizedKey);
        if (formData.get(`flag_enabled:${normalizedKey}`) === "yes") {
          flagFormData.set("enabled", "yes");
        }

        const response = await fetch("/api/admin/feature-flag", {
          headers: {
            "x-admin-action": "feature-flag",
          },
          method: "POST",
          body: flagFormData,
        });
        const result = (await response.json()) as AdminFeatureFlagResponse;

        if (!response.ok || result.error) {
          throw new Error(result.error || "Feature flag save failed");
        }
      }

      setStatus("Feature flags saved.");
      await loadDashboard();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Feature flag save failed",
      );
    } finally {
      featureFlagSubmit?.removeAttribute("disabled");
    }
  });

  refreshButton?.addEventListener("click", () => {
    void loadDashboard();
  });

  void loadDashboard();
}

function renderDashboard({
  cfpProposals,
  counts,
  featureFlags,
  interests,
  orders,
  scheduleEntries,
  tiers,
}: {
  cfpProposals: AdminCfpProposal[];
  counts: AdminCounts | undefined;
  featureFlags: AdminFeatureFlag[];
  interests: AdminInterest[];
  orders: AdminOrder[];
  scheduleEntries: AdminScheduleEntry[];
  tiers: AdminTier[];
}) {
  currentCfpProposals = cfpProposals;
  currentScheduleEntries = scheduleEntries;
  currentTiers = tiers;
  renderMetrics({ cfpProposals, counts, interests, orders, tiers });
  renderFeatureFlags(featureFlags);
  renderCfpProposals(cfpProposals);
  renderScheduleCfpSelect(cfpProposals);
  renderScheduleEntries(scheduleEntries);
  renderTierSelect(tiers);
  renderTiers(tiers);
  renderOrders(orders);
  renderInterests(interests);
}

function renderFeatureFlags(flags: AdminFeatureFlag[]) {
  const root = document.querySelector("[data-admin-feature-flags]");

  if (!root) return;

  root.innerHTML = "";

  for (const flag of flags) {
    const item = document.createElement("label");
    const input = document.createElement("input");
    const hiddenKey = document.createElement("input");
    const content = document.createElement("span");
    const title = document.createElement("strong");
    const description = document.createElement("span");
    const meta = document.createElement("span");

    item.className =
      "grid gap-3 border border-ink/40 p-4 md:grid-cols-[auto_1fr]";
    input.className = "mt-1 h-5 w-5";
    input.type = "checkbox";
    input.name = `flag_enabled:${flag.key}`;
    input.value = "yes";
    input.checked = flag.enabled;

    hiddenKey.type = "hidden";
    hiddenKey.name = "flag_key";
    hiddenKey.value = flag.key;

    content.className = "grid gap-1";
    title.className = "text-base font-bold uppercase";
    title.textContent = flag.label;
    description.className = "text-sm text-muted";
    description.textContent = flag.description;
    meta.className = "text-xs font-bold uppercase text-muted";
    meta.textContent =
      flag.source === "admin"
        ? `Admin override / ${flag.updated_at ? formatDate(flag.updated_at) : "saved"}`
        : `Env default / ${flag.default_enabled ? "enabled" : "disabled"}`;

    content.appendChild(title);
    content.appendChild(description);
    content.appendChild(meta);
    item.appendChild(input);
    item.appendChild(hiddenKey);
    item.appendChild(content);
    root.appendChild(item);
  }
}

function renderMetrics({
  cfpProposals,
  counts,
  interests,
  orders,
  tiers,
}: {
  cfpProposals: AdminCfpProposal[];
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
  root.className = "mt-8 grid gap-px border border-ink bg-ink md:grid-cols-5";

  for (const metric of [
    ["Paid tickets", String(paidTickets)],
    ["Capacity", String(capacity)],
    ["CFP proposals", String(counts?.cfp_proposals ?? cfpProposals.length)],
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

function renderCfpProposals(proposals: AdminCfpProposal[]) {
  const body = document.querySelector("[data-admin-cfp-proposals]");

  if (!body) return;

  body.innerHTML = "";

  for (const proposal of proposals) {
    appendRow(body, [
      String(proposal.id),
      formatCfpFormat(proposal.format),
      proposal.title,
      proposal.name,
      proposal.email,
      proposal.organization || "",
      proposal.summary,
      proposal.bio || "",
      formatDate(proposal.created_at),
    ]);
  }
}

function renderScheduleCfpSelect(proposals: AdminCfpProposal[]) {
  const select = document.querySelector(
    "[data-schedule-cfp-select]",
  ) as HTMLSelectElement | null;
  const currentValue = select?.value || "";

  if (!select) return;

  select.innerHTML = "";

  const customOption = document.createElement("option");
  customOption.value = "";
  customOption.textContent = "Custom entry";
  select.add(customOption);

  for (const proposal of proposals) {
    const option = document.createElement("option");

    option.value = String(proposal.id);
    option.textContent = `#${proposal.id} ${formatCfpFormat(proposal.format)} / ${proposal.title} / ${proposal.name}`;
    select.add(option);
  }

  select.value = currentValue;
}

function renderScheduleEntries(entries: AdminScheduleEntry[]) {
  const body = document.querySelector("[data-admin-schedule-entries]");

  if (!body) return;

  body.innerHTML = "";

  for (const entry of entries) {
    const row = document.createElement("tr");

    row.className = "border-t border-ink";

    for (const value of [
      formatScheduleRange(entry),
      formatScheduleEntryType(entry.entry_type),
      entry.title,
      entry.presenter || entry.organization || "",
      entry.location || "",
      entry.is_published ? "Published" : "Draft",
    ]) {
      const cell = document.createElement("td");

      cell.className = "px-3 py-2 align-top";
      cell.textContent = value;
      row.appendChild(cell);
    }

    const actionCell = document.createElement("td");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    actionCell.className = "flex gap-2 px-3 py-2";
    editButton.className =
      "border border-ink px-2 py-1 text-xs font-bold uppercase transition hover:bg-ink hover:text-paper";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      populateScheduleForm(entry);
    });

    deleteButton.className =
      "border border-ink px-2 py-1 text-xs font-bold uppercase transition hover:bg-ink hover:text-paper";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      void deleteScheduleEntry(entry);
    });

    actionCell.appendChild(editButton);
    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);
    body.appendChild(row);
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
    const state = tier.is_active ? "" : " / inactive";

    option.value = tier.id;
    option.disabled = !tier.is_active || tier.available_quantity < 1;
    option.textContent = `${tier.label}${price} / ${tier.available_quantity} left${state}`;
    select.add(option);
  }
}

function renderTiers(tiers: AdminTier[]) {
  const body = document.querySelector("[data-admin-tiers]");

  if (!body) return;

  body.innerHTML = "";

  for (const tier of tiers) {
    const row = document.createElement("tr");

    row.className = "border-t border-ink";

    for (const [index, value] of [
      `${tier.label} (${tier.id})`,
      tier.price_label || tier.price_id,
      tier.tito_release_slug || "None",
      tier.discount_coupon_id || "None",
      formatSaleWindow(tier),
      `${tier.reserved_quantity}/${tier.capacity}`,
      String(tier.available_quantity),
      tier.is_active ? "Active" : "Inactive",
    ].entries()) {
      const cell = document.createElement("td");

      cell.className =
        index === 5 || index === 6
          ? "px-3 py-2 text-right align-top"
          : "px-3 py-2 align-top";
      cell.textContent = value;
      row.appendChild(cell);
    }

    const actionCell = document.createElement("td");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    actionCell.className = "flex gap-2 px-3 py-2";
    editButton.className =
      "border border-ink px-2 py-1 text-xs font-bold uppercase transition hover:bg-ink hover:text-paper";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => {
      populateTierForm(tier);
    });

    deleteButton.className =
      "border border-ink px-2 py-1 text-xs font-bold uppercase transition hover:bg-ink hover:text-paper";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      void deleteTier(tier);
    });

    actionCell.appendChild(editButton);
    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);
    body.appendChild(row);
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

function populateScheduleForm(entry: AdminScheduleEntry) {
  setScheduleField("id", String(entry.id));
  setScheduleField("cfp_proposal_id", String(entry.cfp_proposal_id ?? ""));
  setScheduleField("starts_at", toDateTimeLocal(entry.starts_at));
  setScheduleField("ends_at", toDateTimeLocal(entry.ends_at));
  setScheduleField("entry_type", entry.entry_type);
  setScheduleField("sort_order", String(entry.sort_order));
  setScheduleField("title", entry.title);
  setScheduleField("presenter", entry.presenter || "");
  setScheduleField("organization", entry.organization || "");
  setScheduleField("location", entry.location || "");
  setScheduleField("description", entry.description || "");
  setScheduleChecked("is_published", entry.is_published);
}

function resetScheduleForm() {
  const form = document.querySelector(
    "[data-admin-schedule-form]",
  ) as HTMLFormElement | null;

  form?.reset();
  setScheduleField("id", "");
  setScheduleField("sort_order", "0");
  setScheduleChecked("is_published", false);
}

async function deleteScheduleEntry(entry: AdminScheduleEntry) {
  const confirmed = window.confirm(`Delete schedule entry "${entry.title}"?`);

  if (!confirmed) return;

  const formData = new FormData();

  formData.set("action", "delete");
  formData.set("id", String(entry.id));

  const response = await fetch("/api/admin/schedule", {
    headers: {
      "x-admin-action": "schedule",
    },
    method: "POST",
    body: formData,
  });
  const result = (await response.json()) as AdminScheduleResponse;

  if (!response.ok || result.error) {
    window.alert(result.error || "Schedule delete failed");
    return;
  }

  currentScheduleEntries = currentScheduleEntries.filter(
    (candidate) => candidate.id !== entry.id,
  );
  renderScheduleEntries(currentScheduleEntries);
}

function populateTierForm(tier: AdminTier) {
  setTierField("id", tier.id);
  setTierField("label", tier.label);
  setTierField("price_id", tier.price_id);
  setTierField("price_label", tier.price_label || "");
  setTierField("tito_release_slug", tier.tito_release_slug || "");
  setTierField("currency", tier.currency || "");
  setTierField("capacity", String(tier.capacity));
  setTierField("discount_coupon_id", tier.discount_coupon_id || "");
  setTierField("available_from", toDateTimeLocal(tier.available_from));
  setTierField("available_until", toDateTimeLocal(tier.available_until));
  setTierField("sort_order", String(tier.sort_order));
  setTierChecked("is_active", tier.is_active);
}

function resetTierForm() {
  const form = document.querySelector(
    "[data-admin-tier-form]",
  ) as HTMLFormElement | null;

  form?.reset();
  setTierField("sort_order", "0");
  setTierChecked("is_active", true);
}

async function deleteTier(tier: AdminTier) {
  const confirmed = window.confirm(`Delete ticket tier "${tier.label}"?`);

  if (!confirmed) return;

  const formData = new FormData();

  formData.set("action", "delete");
  formData.set("id", tier.id);

  const response = await fetch("/api/admin/ticket-tier", {
    headers: {
      "x-admin-action": "ticket-tier",
    },
    method: "POST",
    body: formData,
  });
  const result = (await response.json()) as AdminTierResponse;

  if (!response.ok || result.error) {
    window.alert(result.error || "Ticket tier delete failed");
    return;
  }

  currentTiers = currentTiers.filter((candidate) => candidate.id !== tier.id);
  renderTiers(currentTiers);
  renderTierSelect(currentTiers);
}

function setTierField(name: string, value: string) {
  const field = document.querySelector(
    `[data-admin-tier-form] [name="${name}"]`,
  ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;

  if (field) {
    field.value = value;
  }
}

function setTierChecked(name: string, checked: boolean) {
  const field = document.querySelector(
    `[data-admin-tier-form] [name="${name}"]`,
  ) as HTMLInputElement | null;

  if (field) {
    field.checked = checked;
  }
}

function setScheduleField(name: string, value: string) {
  const field = document.querySelector(
    `[data-admin-schedule-form] [name="${name}"]`,
  ) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;

  if (field) {
    field.value = value;
  }
}

function setScheduleChecked(name: string, checked: boolean) {
  const field = document.querySelector(
    `[data-admin-schedule-form] [name="${name}"]`,
  ) as HTMLInputElement | null;

  if (field) {
    field.checked = checked;
  }
}

function formatScheduleRange(entry: AdminScheduleEntry): string {
  const start = formatTime(entry.starts_at);
  const end = formatTime(entry.ends_at);

  return end ? `${start}-${end}` : start;
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
  const status = tier.is_active
    ? tier.is_on_sale
      ? "on sale"
      : "closed"
    : "inactive";

  return `${start} to ${end} (${status})`;
}

function formatCfpFormat(value: string): string {
  if (value === "poster") return "Poster";
  if (value === "pitch_15") return "15 minute pitch";

  return value;
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

function toDateTimeLocal(value: string | null): string {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Helsinki",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

initThemeToggle();
initAdmin();

export {};
