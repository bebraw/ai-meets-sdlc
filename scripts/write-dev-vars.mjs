import { writeFile } from "node:fs/promises";
import { config } from "dotenv";

config();

const values = {
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  EMAIL_ENCRYPTION_KEY: process.env.EMAIL_ENCRYPTION_KEY,
  SHOW_INTEREST_FORM: process.env.SHOW_INTEREST_FORM ?? "",
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY ?? "",
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY ?? "",
};

const missingRequiredValues = [
  "ADMIN_PASSWORD",
  "ADMIN_USERNAME",
  "EMAIL_ENCRYPTION_KEY",
].filter((key) => !values[key]);

if (missingRequiredValues.length) {
  console.error(
    `Missing ${missingRequiredValues.join(", ")}. Copy .env.example to .env and set local secrets.`,
  );
  process.exit(1);
}

const contents = Object.entries(values)
  .map(([key, value]) => `${key}="${String(value).replaceAll('"', '\\"')}"`)
  .join("\n");

await writeFile(".dev.vars", `${contents}\n`);
console.log("Wrote .dev.vars for Wrangler local development.");
