import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { formatSpeakerName } from "../site/scripts/speaker-name.ts";

test("public names retain optional titles and credentials without changing the badge name", () => {
  const profile = {
    name: "Example Speaker",
    honorific: "Md",
    credentials: "PhD",
  };
  assert.equal(formatSpeakerName(profile), "Md Example Speaker, PhD");
  assert.equal(profile.name, "Example Speaker");
  assert.equal(
    formatSpeakerName({ name: "Example Speaker" }),
    "Example Speaker",
  );
  assert.equal(
    formatSpeakerName({
      name: "Example Speaker",
      honorific: "  Dr. ",
      credentials: "  ",
    }),
    "Dr. Example Speaker",
  );
  assert.equal(
    formatSpeakerName({ name: "Md Example Speaker" }),
    "Md Example Speaker",
  );
});

test("title migration preserves other profile content and only versions affected speakers", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      `CREATE TABLE canonical_speaker_content (speaker_id TEXT PRIMARY KEY, content_json TEXT NOT NULL, content_version INTEGER DEFAULT 1, updated_at TEXT DEFAULT '', updated_by TEXT DEFAULT 'seed')`,
    );
    const cases = [
      [
        { name: "Dr Muhammad Waseem" },
        { name: "Muhammad Waseem", honorific: "Dr" },
      ],
      [
        { name: "Md Example Speaker" },
        { name: "Example Speaker", honorific: "Md" },
      ],
      [
        { name: "Dr. Example Speaker" },
        { name: "Example Speaker", honorific: "Dr." },
      ],
      [{ name: "Zak Allal MD" }, { name: "Zak Allal", credentials: "MD" }],
      [{ name: "Zak Allal, Md." }, { name: "Zak Allal", credentials: "Md." }],
      [{ name: "Example Speaker" }, { name: "Example Speaker" }],
      [{ name: "Madeline Speaker" }, { name: "Madeline Speaker" }],
      [
        { name: "Dr Example Speaker", honorific: "Prof" },
        { name: "Dr Example Speaker", honorific: "Prof" },
      ],
    ];
    const insert = db.prepare(
      "INSERT INTO canonical_speaker_content (speaker_id, content_json) VALUES (?, ?)",
    );
    for (const [index, [profile]] of cases.entries())
      insert.run(
        String(index),
        JSON.stringify({
          profile: {
            bio: "Keep this biography.",
            company: "Keep this company.",
            ...profile,
          },
          talks: [{ id: "keep-talk", title: "Keep this talk." }],
        }),
      );
    const migration = await readFile(
      new URL(
        "../migrations/0021_separate_speaker_titles.sql",
        import.meta.url,
      ),
      "utf8",
    );
    db.exec(migration);
    for (const [index, [before, after]] of cases.entries()) {
      const row = db
        .prepare("SELECT * FROM canonical_speaker_content WHERE speaker_id = ?")
        .get(String(index));
      assert.deepEqual(JSON.parse(row.content_json), {
        profile: {
          bio: "Keep this biography.",
          company: "Keep this company.",
          ...after,
        },
        talks: [{ id: "keep-talk", title: "Keep this talk." }],
      });
      assert.equal(row.content_version, before.name === after.name ? 1 : 2);
    }
    const once = db
      .prepare("SELECT * FROM canonical_speaker_content ORDER BY speaker_id")
      .all();
    db.exec(migration);
    assert.deepEqual(
      db
        .prepare("SELECT * FROM canonical_speaker_content ORDER BY speaker_id")
        .all(),
      once,
    );
  } finally {
    db.close();
  }
});
