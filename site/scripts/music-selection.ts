export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  seconds: number;
  spotifyUrl: string;
  youtubeMusicUrl: string;
  group: string;
  note: string;
  starter: boolean;
}

export function restoreMusicSelection(
  stored: string | null,
  tracks: readonly MusicTrack[],
): string[] {
  try {
    const value: unknown = JSON.parse(stored ?? "[]");
    if (!Array.isArray(value)) return [];
    const validIds = new Set(tracks.map(({ id }) => id));
    return [...new Set(value.filter((id): id is string => validIds.has(id)))];
  } catch {
    return [];
  }
}

export function formatMusicDuration(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function musicHandoff(tracks: readonly MusicTrack[]): string {
  const total = tracks.reduce((seconds, track) => seconds + track.seconds, 0);
  return [
    "SDLCAI 2026 / Break music",
    `${tracks.length} tracks / ${formatMusicDuration(total)} total (minutes:seconds)`,
    "",
    "Instrumental ambient, soft piano, and gentle electronics for the breaks.",
    "Keep the volume low enough for easy conversation. Pause for announcements and talks.",
    "Create a playlist on YouTube Music or Spotify in the order below. Repeat as needed across the breaks.",
    "",
    ...tracks.flatMap((track, index) => [
      `${index + 1}. ${track.artist} - ${track.title} (${formatMusicDuration(track.seconds)})`,
      `YouTube Music: ${track.youtubeMusicUrl}`,
      `Spotify: ${track.spotifyUrl}`,
      "",
    ]),
  ].join("\n");
}
