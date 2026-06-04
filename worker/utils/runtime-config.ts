import { isCfpEnabled, isCheckoutEnabled } from "../domain/feature-flags";

export async function injectRuntimeConfig(
  response: Response,
  env: Env,
): Promise<Response> {
  const html = await response.text();
  const [cfpEnabled, checkoutEnabled] = await Promise.all([
    isCfpEnabled(env),
    isCheckoutEnabled(env),
  ]);

  return new Response(
    html
      .replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? "")
      .replaceAll("__CFP_ENABLED__", cfpEnabled ? "true" : "false")
      .replaceAll("__CHECKOUTS_ENABLED__", checkoutEnabled ? "true" : "false"),
    response,
  );
}
