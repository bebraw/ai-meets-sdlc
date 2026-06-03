import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databaseName = "ai-meets-sdlc-interests";
const selectOrders = `
  SELECT
    stripe_session_id,
    stripe_payment_intent_id,
    ticket_tier_id,
    ticket_tier_label,
    stripe_price_id,
    reservation_id,
    email_ciphertext,
    email_iv,
    quantity,
    amount_total,
    currency,
    checkout_status,
    payment_status,
    order_status,
    reservation_expires_at,
    created_at,
    updated_at
  FROM orders
  ORDER BY created_at ASC
`;

const options = parseOptions(process.argv.slice(2));
const secret = process.env.EMAIL_ENCRYPTION_KEY;

if (options.help) {
  printUsage();
  process.exit(0);
}

if (!secret) {
  console.error("Missing EMAIL_ENCRYPTION_KEY.");
  printUsage();
  process.exit(1);
}

if (options.local === options.remote) {
  console.error("Choose exactly one data source: --remote or --local.");
  printUsage();
  process.exit(1);
}

const rows = await readRowsFromD1({ remote: options.remote });
const orders = await Promise.all(rows.map((row) => decryptOrder(row, secret)));

if (options.format === "json") {
  console.log(`${JSON.stringify(orders, null, 2)}\n`);
} else {
  writeCsv(orders);
}

function parseArgs(args) {
  const options = {
    format: "csv",
    help: false,
    local: false,
    remote: false,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = args[index + 1];

    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--format":
        if (!next || !["csv", "json"].includes(next)) {
          throw new Error("Expected --format to be csv or json.");
        }
        options.format = next;
        index++;
        break;
      case "--local":
        options.local = true;
        break;
      case "--remote":
        options.remote = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function parseOptions(args) {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid options.");
    printUsage();
    process.exit(1);
  }
}

async function readRowsFromD1({ remote }) {
  const wranglerPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "node_modules",
    ".bin",
    "wrangler",
  );
  const args = [
    "d1",
    "execute",
    databaseName,
    remote ? "--remote" : "--local",
    "--json",
    "--command",
    selectOrders,
  ];
  const { stdout } = await execFileAsync(wranglerPath, args, {
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout);

  return extractD1Rows(payload);
}

function extractD1Rows(payload) {
  if (Array.isArray(payload)) {
    if (payload.some((entry) => Array.isArray(entry?.results))) {
      return payload.flatMap((entry) =>
        Array.isArray(entry?.results) ? entry.results : [],
      );
    }
  }

  if (Array.isArray(payload?.results)) return payload.results;

  throw new Error("Could not find D1 results in Wrangler output.");
}

async function decryptOrder(row, keyMaterial) {
  return {
    amount_total: row.amount_total ?? "",
    checkout_status: row.checkout_status ?? "",
    created_at: row.created_at ?? "",
    currency: row.currency ?? "",
    email:
      row.email_ciphertext && row.email_iv
        ? await decryptText(row.email_ciphertext, row.email_iv, keyMaterial)
        : "",
    order_status: row.order_status ?? "",
    payment_status: row.payment_status ?? "",
    quantity: row.quantity ?? "",
    reservation_id: row.reservation_id ?? "",
    reservation_expires_at: row.reservation_expires_at ?? "",
    stripe_price_id: row.stripe_price_id ?? "",
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? "",
    stripe_session_id: row.stripe_session_id ?? "",
    ticket_tier_id: row.ticket_tier_id ?? "",
    ticket_tier_label: row.ticket_tier_label ?? "",
    updated_at: row.updated_at ?? "",
  };
}

async function decryptText(ciphertext, iv, keyMaterial) {
  const key = await importAesKey(keyMaterial);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

async function importAesKey(keyMaterial) {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["decrypt"]);
}

async function deriveBytes(secret, purpose) {
  return crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${secret}`),
  );
}

function base64Decode(value) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function writeCsv(orders) {
  console.log(
    [
      "stripe_session_id",
      "stripe_payment_intent_id",
      "ticket_tier_id",
      "ticket_tier_label",
      "stripe_price_id",
      "reservation_id",
      "email",
      "quantity",
      "amount_total",
      "currency",
      "checkout_status",
      "payment_status",
      "order_status",
      "reservation_expires_at",
      "created_at",
      "updated_at",
    ].join(","),
  );

  for (const order of orders) {
    console.log(
      [
        order.stripe_session_id,
        order.stripe_payment_intent_id,
        order.ticket_tier_id,
        order.ticket_tier_label,
        order.stripe_price_id,
        order.reservation_id,
        order.email,
        order.quantity,
        order.amount_total,
        order.currency,
        order.checkout_status,
        order.payment_status,
        order.order_status,
        order.reservation_expires_at,
        order.created_at,
        order.updated_at,
      ]
        .map(formatCsvValue)
        .join(","),
    );
  }
}

function formatCsvValue(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function printUsage() {
  console.error(
    `
Usage:
  EMAIL_ENCRYPTION_KEY=... npm run --silent orders:export -- --remote
  EMAIL_ENCRYPTION_KEY=... npm run --silent orders:export -- --local

Options:
  --format csv|json  Output format. Defaults to csv.
  --help             Show this help.
`.trim(),
  );
}
