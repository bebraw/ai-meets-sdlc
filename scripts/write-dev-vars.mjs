import { writeFile } from "node:fs/promises";
import { config } from "dotenv";

config();

const values = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  CHECKOUT_PROVIDER: process.env.CHECKOUT_PROVIDER ?? "stripe",
  CHECKOUTS_ENABLED: process.env.CHECKOUTS_ENABLED ?? "false",
  CFP_ENABLED: process.env.CFP_ENABLED ?? "false",
  EMAIL_ENCRYPTION_KEY: process.env.EMAIL_ENCRYPTION_KEY,
  STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL ?? "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  TITO_EVENT_PATH: process.env.TITO_EVENT_PATH ?? "",
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY ?? "",
};

if (!values.EMAIL_ENCRYPTION_KEY) {
  console.error(
    "Missing EMAIL_ENCRYPTION_KEY. Copy .env.example to .env and set a local secret.",
  );
  process.exit(1);
}

if (!values.ADMIN_PASSWORD) {
  console.error(
    "Missing ADMIN_PASSWORD. Copy .env.example to .env and set a local admin password.",
  );
  process.exit(1);
}

const contents = Object.entries(values)
  .map(([key, value]) => `${key}="${String(value).replaceAll('"', '\\"')}"`)
  .join("\n");

await writeFile(".dev.vars", `${contents}\n`);
console.log("Wrote .dev.vars for Wrangler local development.");
