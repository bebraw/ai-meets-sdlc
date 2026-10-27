import { experimental_readRawConfig, unstable_splitSqlQuery } from "wrangler";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createWorkerFixture } from "./worker-fixture.mjs";
import { emptyEventDatabaseSql } from "../../scripts/event-database.mjs";

export const fixtureEvent = {
  id: "fixture-b",
  label: "Fixture B",
  database: "FIXTURE_DB",
  uploads: "FIXTURE_UPLOADS",
  exports: "FIXTURE_EXPORTS",
  backups: "FIXTURE_BACKUPS",
};

export async function createEventFixture(vars = {}) {
  await mkdir(".cache/event-fixtures", { recursive: true });
  const directory = await mkdtemp(resolve(".cache/event-fixtures/run-"));
  try {
    const { rawConfig: config } = experimental_readRawConfig({
      config: "wrangler.jsonc",
    });
    config.main = resolve(config.main);
    config.assets.directory = resolve(config.assets.directory);
    config.d1_databases[0].migrations_dir = resolve("migrations");
    config.d1_databases.push({
      binding: fixtureEvent.database,
      database_name: "empty-event-fixture",
      database_id: "4d67e6c6-54ae-4458-98aa-c0fdf41fc839",
    });
    for (const [binding, bucket_name] of [
      [fixtureEvent.uploads, "fixture-uploads"],
      [fixtureEvent.exports, "fixture-exports"],
      [fixtureEvent.backups, "fixture-backups"],
    ])
      config.r2_buckets.push({ binding, bucket_name });
    const events = [...JSON.parse(config.vars.EVENT_WORKSPACES), fixtureEvent];
    const configPath = resolve(directory, "wrangler.json");
    await writeFile(configPath, JSON.stringify(config));
    const fixture = await createWorkerFixture({
      configPath,
      vars: {
        ADMIN_USERNAME: "events-admin",
        ADMIN_PASSWORD: "events-password",
        EMAIL_ENCRYPTION_KEY: "events-private-fixture-key",
        EVENT_WORKSPACES: JSON.stringify(events),
        ...vars,
      },
    });
    try {
      const db = fixture.env[fixtureEvent.database];
      const statements = unstable_splitSqlQuery(
        await emptyEventDatabaseSql(fixtureEvent.id),
      );
      await db.batch(statements.map((sql) => db.prepare(sql)));
      const originalDispose = fixture.dispose;
      return {
        ...fixture,
        events,
        eventDb: db,
        dispose: async () => {
          try {
            await originalDispose();
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      await fixture.dispose();
      throw error;
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
