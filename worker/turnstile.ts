export interface TurnstileOutcome {
  action?: string;
  success: boolean;
  "error-codes"?: string[];
  hostname?: string;
}

const siteverifyTimeoutMilliseconds = 10_000;

export async function verifyTurnstile({
  expectedAction,
  expectedHostnames,
  request,
  secret,
  token,
}: {
  expectedAction: string;
  expectedHostnames: ReadonlySet<string>;
  request: Request;
  secret: string;
  token: string;
}): Promise<TurnstileOutcome> {
  if (!token) {
    return { success: false, "error-codes": ["missing-input-response"] };
  }

  if (token.length > 2048) {
    return { success: false, "error-codes": ["invalid-input-response"] };
  }

  const payload = new FormData();
  payload.append("secret", secret);
  payload.append("response", token);

  const ip = request.headers.get("CF-Connecting-IP");

  if (ip) payload.append("remoteip", ip);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: payload,
        method: "POST",
        signal: AbortSignal.timeout(siteverifyTimeoutMilliseconds),
      },
    );

    if (!response.ok) {
      return { success: false, "error-codes": ["siteverify-unavailable"] };
    }

    const candidate: unknown = await response.json();

    return validateTurnstileOutcome(
      candidate,
      expectedAction,
      expectedHostnames,
    );
  } catch {
    return { success: false, "error-codes": ["siteverify-unavailable"] };
  }
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
