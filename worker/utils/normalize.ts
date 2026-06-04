export function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeQuantity(value: FormDataEntryValue | null): number {
  if (typeof value !== "string") return 0;

  const quantity = Number(value);

  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 10
    ? quantity
    : 0;
}

export function normalizePositiveInteger(
  value: FormDataEntryValue | null,
  max: number,
): number {
  if (typeof value !== "string" || !value.trim()) return 0;

  const number = Number(value);

  return Number.isInteger(number) && number >= 1 && number <= max ? number : 0;
}

export function normalizeInteger(
  value: FormDataEntryValue | null,
  min: number,
  max: number,
): number {
  if (typeof value !== "string" || !value.trim()) return min;

  const number = Number(value);

  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : min;
}

export function normalizeAdminPageLimit(value: string | null): number {
  const limit = Number(value ?? 50);

  if (!Number.isInteger(limit)) return 50;

  return Math.min(100, Math.max(1, limit));
}

export function normalizeAdminPageOffset(value: string | null): number {
  const offset = Number(value ?? 0);

  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

export function normalizeCfpFormat(value: FormDataEntryValue | null): string {
  if (value !== "poster" && value !== "pitch_15") return "";

  return value;
}

export function normalizeTicketTierId(
  value: FormDataEntryValue | null,
): string {
  const normalized = normalizeOptionalText(value, 80);

  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : "";
}

export function normalizeCurrency(value: FormDataEntryValue | null): string {
  const normalized = normalizeOptionalText(value, 3).toLowerCase();

  return /^[a-z]{3}$/.test(normalized) ? normalized : "";
}

export function normalizeScheduleEntryType(
  value: FormDataEntryValue | null,
): string {
  if (
    value !== "talk" &&
    value !== "workshop" &&
    value !== "panel" &&
    value !== "poster" &&
    value !== "break" &&
    value !== "other"
  ) {
    return "";
  }

  return value;
}

export function normalizeScheduleDate(
  value: FormDataEntryValue | null,
): string {
  if (typeof value !== "string" || !value.trim()) return "";

  const trimmed = value.trim();
  const date = new Date(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
      ? `${trimmed}:00+03:00`
      : trimmed,
  );

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function normalizeStripeId(
  value: string | null,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

export function normalizeOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

export function getTurnstileToken(formData: FormData): string {
  const values = formData
    .getAll("cf-turnstile-response")
    .map((value) => normalizeOptionalText(value, 2048))
    .filter(Boolean);

  return values.at(-1) ?? "";
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
