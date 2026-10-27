import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

/** Build a schema from repository migrations, never from a production database. */
export async function emptyEventDatabaseSql(eventId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(eventId) || eventId === "2026")
    throw new Error("Choose a new stable event identifier.");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = OFF");
    const files = (await readdir(new URL("../migrations/", import.meta.url)))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files)
      db.exec(
        await readFile(
          new URL(`../migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    const schema = db
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND tbl_name NOT LIKE 'newsletter_%' ORDER BY type = 'trigger', type = 'index', rowid",
      )
      .all();
    return [
      "-- Empty event schema. No attendee, speaker, organizer, media or marketing records copied.",
      ...schema.map(({ sql }) => `${sql};`),
      `INSERT INTO event_dataset (id, event_id) VALUES (1, '${eventId}');`,
      "INSERT INTO attendee_roster (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
      "INSERT INTO badge_workspace (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));",
      "INSERT INTO qa_settings (id) VALUES (1);",
      "INSERT INTO speaker_dinner_catering (id) VALUES (1);",
      "INSERT INTO attendee_message_draft (id) VALUES (1);",
      // Record the baseline so subsequent schema-only migrations can be applied normally.
      "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);",
      ...files.map(
        (name) => `INSERT INTO d1_migrations (name) VALUES ('${name}');`,
      ),
      "",
    ].join("\n");
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length !== 3)
    throw new Error(
      "Usage: node scripts/event-database.mjs EVENT_ID > empty-event.sql",
    );
  process.stdout.write(await emptyEventDatabaseSql(process.argv[2]));
}
