import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { experimental_readRawConfig } from "wrangler";
import { eventWorkspaces } from "../worker/event-workspaces.ts";

export function migrationTargets(config) {
  const events = eventWorkspaces({
    EVENT_WORKSPACES: config.vars.EVENT_WORKSPACES,
  });
  return events.map((event) => {
    if (
      !config.d1_databases.some((binding) => binding.binding === event.database)
    )
      throw new Error(`Missing D1 configuration for ${event.id}`);
    return { id: event.id, binding: event.database };
  });
}

function wrangler(args, capture = false) {
  const result = spawnSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Wrangler failed (${result.status})${capture ? `: ${result.stderr}` : ""}`,
    );
  return result.stdout;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const mode = process.argv[2];
  if (!["--local", "--remote"].includes(mode) || process.argv.length !== 3)
    throw new Error(
      "Usage: node scripts/migrate-databases.mjs --local|--remote",
    );
  const { rawConfig: config } = experimental_readRawConfig({
    config: "wrangler.jsonc",
  });
  for (const target of migrationTargets(config)) {
    if (target.id !== "2026") {
      // Never run the historical data seeds on an uninitialized future database.
      const result = JSON.parse(
        wrangler(
          [
            "d1",
            "execute",
            target.binding,
            mode,
            "--command",
            "SELECT event_id FROM event_dataset WHERE id = 1",
            "--json",
          ],
          true,
        ),
      );
      if (result[0]?.results?.[0]?.event_id !== target.id)
        throw new Error(
          `Initialize the empty schema for ${target.id} before configuring it`,
        );
    }
    wrangler(["d1", "migrations", "apply", target.binding, mode]);
  }
}
