import assert from "node:assert/strict";
import test from "node:test";
import music from "../site/data/music.json" with { type: "json" };
import {
  formatMusicDuration,
  musicHandoff,
  restoreMusicSelection,
} from "../site/scripts/music-selection.ts";

test("saved music selection retains order and removes stale or duplicate IDs", () => {
  const stored = JSON.stringify([
    "tycho-walk",
    "eno-ascent",
    "deleted-track",
    "tycho-walk",
    null,
    { id: "frahm-ambre" },
  ]);
  assert.deepEqual(restoreMusicSelection(stored, music.tracks), [
    "tycho-walk",
    "eno-ascent",
  ]);
  for (const invalid of [null, "broken JSON", "null", "{}", '"eno-ascent"']) {
    assert.deepEqual(restoreMusicSelection(invalid, music.tracks), []);
  }
});

test("venue handoff uses playlist order, exact links, and total duration", () => {
  const chosen = [music.tracks.at(-1), music.tracks[0]];
  const text = musicHandoff(chosen);
  assert.match(text, /2 tracks \/ 9:40 total/);
  assert.ok(
    text.indexOf("1. Tycho - A Walk (5:16)") < text.indexOf("2. Brian Eno"),
  );
  for (const track of chosen) {
    assert.ok(text.includes(`YouTube Music: ${track.youtubeMusicUrl}`));
    assert.ok(text.includes(`Spotify: ${track.spotifyUrl}`));
  }
  assert.match(text, /Create a playlist on YouTube Music or Spotify/);
  assert.match(text, /Pause for announcements and talks/);
  assert.equal(formatMusicDuration(3601), "60:01");
});

test("music catalog has unique IDs, direct listening links, and a calm starter set", () => {
  assert.equal(
    new Set(music.tracks.map((track) => track.id)).size,
    music.tracks.length,
  );
  assert.equal(
    new Set(music.tracks.map((track) => track.spotifyUrl)).size,
    music.tracks.length,
  );
  assert.equal(
    new Set(music.tracks.map((track) => track.youtubeMusicUrl)).size,
    music.tracks.length,
  );
  for (const track of music.tracks) {
    assert.match(track.id, /^[a-z0-9-]+$/);
    assert.match(
      track.spotifyUrl,
      /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/,
    );
    assert.match(
      track.youtubeMusicUrl,
      /^https:\/\/music\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/,
    );
    assert.ok(Number.isInteger(track.seconds) && track.seconds > 0);
    assert.ok(["ambient", "piano", "pulse"].includes(track.group));
    if (track.starter) assert.notEqual(track.group, "pulse");
  }
  assert.ok(music.tracks.filter((track) => track.starter).length >= 8);
});
