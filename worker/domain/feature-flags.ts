import type { FeatureFlagRow } from "../types";
import { normalizeOptionalText } from "../utils/normalize";

export const FEATURE_FLAGS = [
  {
    description: "Allows visitors to submit CFP proposals.",
    envKey: "CFP_ENABLED",
    key: "cfp",
    label: "CFP form",
  },
  {
    description: "Allows visitors to start Stripe Checkout for ticket tiers.",
    envKey: "CHECKOUTS_ENABLED",
    key: "checkout",
    label: "Ticket checkout",
  },
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number]["key"];

export function normalizeFeatureFlagKey(
  value: FormDataEntryValue | null,
): FeatureFlagKey | "" {
  const normalized = normalizeOptionalText(value, 80);

  return FEATURE_FLAGS.some((flag) => flag.key === normalized)
    ? (normalized as FeatureFlagKey)
    : "";
}

export async function getFeatureFlags(env: Env) {
  let rows: D1Result<FeatureFlagRow> | null = null;

  if (env.INTERESTS) {
    try {
      rows = await env.INTERESTS.prepare(
        `SELECT key, enabled, label, description, updated_at
        FROM feature_flags
        WHERE key IN (${FEATURE_FLAGS.map(() => "?").join(", ")})`,
      )
        .bind(...FEATURE_FLAGS.map((flag) => flag.key))
        .all<FeatureFlagRow>();
    } catch (error) {
      if (!isMissingFeatureFlagsTableError(error)) throw error;
    }
  }

  const rowsByKey = new Map(
    (rows?.results ?? []).map((row) => [row.key, row] as const),
  );

  return FEATURE_FLAGS.map((definition) => {
    const row = rowsByKey.get(definition.key);
    const defaultEnabled = getEnvFeatureFlag(env, definition.envKey);

    return {
      default_enabled: defaultEnabled,
      description: row?.description ?? definition.description,
      enabled: row ? row.enabled === 1 : defaultEnabled,
      key: definition.key,
      label: row?.label ?? definition.label,
      source: row ? "admin" : "env",
      updated_at: row?.updated_at ?? null,
    };
  });
}

export async function isCheckoutEnabled(env: Env): Promise<boolean> {
  const flag = (await getFeatureFlags(env)).find(
    (candidate) => candidate.key === "checkout",
  );

  return flag?.enabled ?? getEnvFeatureFlag(env, "CHECKOUTS_ENABLED");
}

export async function isCfpEnabled(env: Env): Promise<boolean> {
  const flag = (await getFeatureFlags(env)).find(
    (candidate) => candidate.key === "cfp",
  );

  return flag?.enabled ?? getEnvFeatureFlag(env, "CFP_ENABLED");
}

export function isMissingFeatureFlagsTableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("feature_flags")
  );
}

function getEnvFeatureFlag(env: Env, key: "CFP_ENABLED" | "CHECKOUTS_ENABLED") {
  return env[key] === "true";
}
