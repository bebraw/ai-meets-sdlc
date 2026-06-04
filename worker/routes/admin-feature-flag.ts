import {
  FEATURE_FLAGS,
  getFeatureFlags,
  isMissingFeatureFlagsTableError,
  normalizeFeatureFlagKey,
} from "../domain/feature-flags";
import { jsonResponse } from "../utils/response";

export async function handleAdminFeatureFlagMutation(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse(
      { error: "Feature flag storage is not configured" },
      503,
    );
  }

  const formData = await request.formData();
  const key = normalizeFeatureFlagKey(formData.get("key"));
  const definition = key
    ? FEATURE_FLAGS.find((candidate) => candidate.key === key)
    : null;

  if (!definition) {
    return jsonResponse({ error: "Choose a feature flag" }, 400);
  }

  const enabled = formData.get("enabled") === "yes" ? 1 : 0;
  const now = new Date().toISOString();

  try {
    await env.INTERESTS.prepare(
      `INSERT INTO feature_flags (
        key,
        enabled,
        label,
        description,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        enabled = excluded.enabled,
        label = excluded.label,
        description = excluded.description,
        updated_at = excluded.updated_at`,
    )
      .bind(
        definition.key,
        enabled,
        definition.label,
        definition.description,
        now,
        now,
      )
      .run();
  } catch (error) {
    if (!isMissingFeatureFlagsTableError(error)) throw error;

    return jsonResponse(
      { error: "Feature flag migration has not been applied" },
      503,
    );
  }

  return jsonResponse({ ok: true, feature_flags: await getFeatureFlags(env) });
}
