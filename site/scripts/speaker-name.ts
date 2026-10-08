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

export function formatSpeakerAffiliation(speaker: {
  role: string;
  company?: string;
}): string {
  const role = speaker.role.trim();
  const company = speaker.company?.trim();
  return company && !role.toLowerCase().includes(company.toLowerCase())
    ? [role, company].filter(Boolean).join(" / ")
    : role || company || "";
}
