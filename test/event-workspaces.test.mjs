import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { emptyEventDatabaseSql } from "../scripts/event-database.mjs";
import { eventWorkspaces, legacyEvent } from "../worker/event-workspaces.ts";
import { migrationTargets } from "../scripts/migrate-databases.mjs";
import { eventPath, parseEventPath } from "../shared/event-paths.ts";

test("an empty event schema contains no inherited identities, attendees, consent, grants or content", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(await emptyEventDatabaseSql("fixture-c"));
    assert.equal(
      db.prepare("SELECT event_id FROM event_dataset").get().event_id,
      "fixture-c",
    );
    const emptyTables = [
      "canonical_speaker_content",
      "speaker_contacts",
      "organizers",
      "volunteers",
      "qa_rooms",
      "qa_access_grants",
      "registration_access_grants",
      "attendee_arrivals",
      "activity_events",
      "interests",
      "publication_queue",
      "event_photo_reviews",
    ];
    for (const table of emptyTables)
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
        0,
        table,
      );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name LIKE 'newsletter_%'",
        )
        .get().n,
      0,
    );
    assert.equal(
      db.prepare("SELECT ciphertext FROM attendee_roster").get().ciphertext,
      null,
    );
    assert.ok(
      db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").get().n > 40,
    );
  } finally {
    db.close();
  }
  await assert.rejects(emptyEventDatabaseSql("2026"));
});

test("event configuration rejects shared resources and migration targets require explicit bindings", () => {
  const future = {
    id: "fixture-b",
    label: "Fixture B",
    database: "OTHER_DB",
    uploads: "OTHER_UPLOADS",
    exports: "OTHER_EXPORTS",
    backups: "OTHER_BACKUPS",
  };
  const env = (events) => ({ EVENT_WORKSPACES: JSON.stringify(events) });
  assert.deepEqual(
    eventWorkspaces(env([legacyEvent, future])).map((event) => event.id),
    ["2026", "fixture-b"],
  );
  assert.throws(() =>
    eventWorkspaces(env([legacyEvent, { ...future, database: "INTERESTS" }])),
  );
  assert.throws(() =>
    eventWorkspaces(
      env([legacyEvent, { ...future, uploads: "SPEAKER_UPLOADS" }]),
    ),
  );
  assert.throws(() =>
    eventWorkspaces(env([legacyEvent, { ...future, id: "2026" }])),
  );
  const config = {
    vars: env([legacyEvent, future]),
    d1_databases: [{ binding: "INTERESTS" }, { binding: "OTHER_DB" }],
  };
  assert.deepEqual(migrationTargets(config), [
    { id: "2026", binding: "INTERESTS" },
    { id: "fixture-b", binding: "OTHER_DB" },
  ]);
  assert.throws(() => migrationTargets({ ...config, d1_databases: [] }));
});

test("browser storage, transport and links retain explicit event context", async (t) => {
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
  });
  const context = await import("../site/scripts/event-context.ts");
  globalThis.location = {
    origin: "https://sdlcai.org",
    href: "https://sdlcai.org/events/fixture-b/admin/",
    pathname: "/events/fixture-b/admin/",
  };
  globalThis.document = {
    documentElement: {
      dataset: { eventId: "fixture-b", eventLabel: "Fixture B" },
    },
  };
  assert.equal(
    context.eventStorageKey("content-shortlist"),
    "sdlcai-fixture-b-content-shortlist",
  );
  assert.equal(
    context.eventUrl("/api/admin/attendees"),
    "/events/fixture-b/api/admin/attendees",
  );
  assert.equal(context.eventUrl("/admin/newsletter/"), "/admin/newsletter/");
  assert.equal(
    context.eventUrl("https://external.test/api/admin/attendees"),
    "https://external.test/api/admin/attendees",
  );
  globalThis.document.documentElement.dataset.eventId = "2026";
  assert.equal(
    context.eventStorageKey("content-shortlist"),
    "sdlcai-2026-content-shortlist",
  );
  assert.deepEqual(parseEventPath("/events/fixture-b/admin/"), {
    id: "fixture-b",
    path: "/admin/",
  });
  assert.equal(
    eventPath("/api/newsletter/confirm", "fixture-b"),
    "/api/newsletter/confirm",
  );
});
