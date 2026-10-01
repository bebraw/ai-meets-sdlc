export interface SpeakerName {
  name: string;
  honorific?: string;
  credentials?: string;
}

export function formatSpeakerName(speaker: SpeakerName): string {
  const name = [speaker.honorific?.trim(), speaker.name.trim()]
    .filter(Boolean)
    .join(" ");
  const credentials = speaker.credentials?.trim();
  return credentials ? `${name}, ${credentials}` : name;
}
