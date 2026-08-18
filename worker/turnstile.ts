export interface TurnstileOutcome {
  action?: string;
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

export function validateTurnstileOutcome(
  value: unknown,
  expectedAction: string,
  expectedHostnames: ReadonlySet<string>,
): TurnstileOutcome {
  if (!isTurnstileOutcome(value)) {
    return { success: false, "error-codes": ["invalid-siteverify-response"] };
  }

  if (!value.success) return value;

  if (value.action !== expectedAction) {
    return addValidationError(value, "action-mismatch");
  }

  if (!expectedHostnames.has(normalizeHostname(value.hostname ?? ""))) {
    return addValidationError(value, "hostname-mismatch");
  }

  return value;
}

export function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, "");
}

function addValidationError(
  outcome: TurnstileOutcome,
  error: string,
): TurnstileOutcome {
  return {
    ...outcome,
    success: false,
    "error-codes": [...(outcome["error-codes"] ?? []), error],
  };
}

function isTurnstileOutcome(value: unknown): value is TurnstileOutcome {
  if (typeof value !== "object" || value === null || !("success" in value)) {
    return false;
  }

  const outcome = value as Record<string, unknown>;
  const errorCodes = outcome["error-codes"];

  return (
    typeof outcome.success === "boolean" &&
    (outcome.action === undefined || typeof outcome.action === "string") &&
    (outcome.hostname === undefined || typeof outcome.hostname === "string") &&
    (errorCodes === undefined ||
      (Array.isArray(errorCodes) &&
        errorCodes.every((code) => typeof code === "string")))
  );
}
