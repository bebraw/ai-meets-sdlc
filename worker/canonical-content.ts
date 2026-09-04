import scheduleData from "../site/data/schedule.json" with { type: "json" };
import speakersData from "../site/data/speakers.json" with { type: "json" };
import { marked } from "marked";

export interface SpeakerProfileContent {
  bio: string;
  devto: string;
  github: string;
  linkedin: string;
  name: string;
  role: string;
  scholar: string;
  website: string;
  x: string;
}

export interface SpeakerTalkContent {
  abstract: string;
  id: string;
  title: string;
}

export interface SpeakerWorkspaceContent {
  profile: SpeakerProfileContent;
  talks: SpeakerTalkContent[];
}

export interface CanonicalSpeakerRecord {
  content: SpeakerWorkspaceContent;
  contentVersion: number;
  lastContentRevisionId: string | null;
  lastPhotoRevisionId: string | null;
  photoContentHash: string | null;
  photoPath: string;
  photoR2Key: string | null;
  photoVersion: number;
  sortOrder: number;
  speakerId: string;
  updatedAt: string;
  updatedBy: string;
}

interface CanonicalSpeakerRow {
  content_json: string;
  content_version: number;
  last_content_revision_id: string | null;
  last_photo_revision_id: string | null;
  photo_content_hash: string | null;
  photo_path: string;
  photo_r2_key: string | null;
  photo_version: number;
  sort_order: number;
  speaker_id: string;
  updated_at: string;
  updated_by: string;
}

interface BundledSpeaker {
  bio: string;
  devto?: string;
  github?: string;
  id: string;
  linkedin?: string;
  name: string;
  photo: string;
  role: string;
  scholar?: string;
  website?: string;
  workspaceOnly?: boolean;
  workspaceTalks?: Array<Pick<BundledTalk, "abstract" | "id" | "title">>;
  x?: string;
}

interface BundledTalk {
  abstract: string;
  id: string;
  speakers: string[];
  title: string;
}

interface BundledScheduleItem {
  talks?: BundledTalk[];
}

const bundledSpeakers = speakersData.items as BundledSpeaker[];
const bundledTalks = (scheduleData.items as BundledScheduleItem[]).flatMap(
  ({ talks = [] }) => talks,
);
const bundledTalksBySpeaker = new Map<string, BundledTalk[]>();

for (const talk of bundledTalks) {
  for (const speakerId of talk.speakers) {
    const assigned = bundledTalksBySpeaker.get(speakerId) ?? [];
    assigned.push(talk);
    bundledTalksBySpeaker.set(speakerId, assigned);
  }
}

const bundledContent = new Map(
  bundledSpeakers.map((speaker, sortOrder) => [
    speaker.id,
    {
      content: {
        profile: {
          bio: speaker.bio,
          devto: speaker.devto ?? "",
          github: speaker.github ?? "",
          linkedin: speaker.linkedin ?? "",
          name: speaker.name,
          role: speaker.role,
          scholar: speaker.scholar ?? "",
          website: speaker.website ?? "",
          x: speaker.x ?? "",
        },
        talks: (
          speaker.workspaceTalks ??
          bundledTalksBySpeaker.get(speaker.id) ??
          []
        ).map(({ abstract, id, title }) => ({ abstract, id, title })),
      },
      photoPath: speaker.photo,
      sortOrder,
    },
  ]),
);

export const canonicalSpeakerIds: ReadonlySet<string> = new Set(
  bundledContent.keys(),
);
export const workspaceOnlySpeakerIds: ReadonlySet<string> = new Set(
  bundledSpeakers
    .filter(({ workspaceOnly }) => workspaceOnly === true)
    .map(({ id }) => id),
);

export async function readCanonicalSpeaker(
  env: Env,
  speakerId: string,
): Promise<CanonicalSpeakerRecord | null> {
  if (!canonicalSpeakerIds.has(speakerId)) return null;

  const row = await env.INTERESTS.prepare(
    `${canonicalSpeakerSelect}
      WHERE speaker_id = ?1
      LIMIT 1`,
  )
    .bind(speakerId)
    .first<CanonicalSpeakerRow>();

  return row ? parseCanonicalSpeakerRow(row) : null;
}

export async function readCanonicalSpeakers(
  env: Env,
): Promise<CanonicalSpeakerRecord[]> {
  const result = await env.INTERESTS.prepare(
    `${canonicalSpeakerSelect}
      ORDER BY sort_order ASC, speaker_id ASC`,
  ).all<CanonicalSpeakerRow>();
  const records = result.results.map(parseCanonicalSpeakerRow);

  if (
    records.length !== canonicalSpeakerIds.size ||
    records.some(({ speakerId }) => !canonicalSpeakerIds.has(speakerId))
  ) {
    throw new Error("Canonical speaker content is incomplete.");
  }

  return records;
}

export async function readPublicCanonicalSpeakers(
  env: Env,
): Promise<CanonicalSpeakerRecord[]> {
  return (await readCanonicalSpeakers(env)).filter(
    ({ speakerId }) => !workspaceOnlySpeakerIds.has(speakerId),
  );
}

export function getCanonicalPhotoUrl(record: CanonicalSpeakerRecord): string {
  if (!record.photoContentHash || !record.photoR2Key) return record.photoPath;

  return `/media/speakers/${encodeURIComponent(record.speakerId)}/${record.photoContentHash}.webp`;
}

export function getCanonicalTalks(
  records: readonly CanonicalSpeakerRecord[],
): Map<string, SpeakerTalkContent> {
  const talks = new Map<string, SpeakerTalkContent>();

  for (const record of records) {
    for (const talk of record.content.talks) {
      const existing = talks.get(talk.id);

      if (
        existing &&
        (existing.title !== talk.title || existing.abstract !== talk.abstract)
      ) {
        throw new Error(`Canonical talk content diverged for ${talk.id}.`);
      }

      talks.set(talk.id, talk);
    }
  }

  return talks;
}

export function renderCanonicalMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown, { async: false, gfm: true });

  if (typeof rendered !== "string") {
    throw new Error("Canonical Markdown rendering became asynchronous.");
  }

  return rendered;
}

export async function hashCanonicalContent(
  content: SpeakerWorkspaceContent,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(content)),
  );

  return base64UrlEncode(new Uint8Array(digest));
}

export async function hashCanonicalVersions(
  records: readonly CanonicalSpeakerRecord[],
): Promise<string> {
  const value = records
    .map(({ contentVersion, photoVersion, speakerId }) => [
      speakerId,
      contentVersion,
      photoVersion,
    ])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );

  return toHex(new Uint8Array(digest));
}

export async function combineCanonicalVersion(
  baseVersion: string,
  speakerIds: readonly string[],
  records: readonly CanonicalSpeakerRecord[],
): Promise<string> {
  if (speakerIds.length === 0) return baseVersion;

  const byId = new Map(records.map((record) => [record.speakerId, record]));
  const dependencies = [...new Set(speakerIds)].sort().map((speakerId) => {
    const record = byId.get(speakerId);

    if (!record) throw new Error(`Unknown canonical speaker: ${speakerId}`);

    return [speakerId, record.contentVersion, record.photoVersion];
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify({ baseVersion, dependencies })),
  );

  return toHex(new Uint8Array(digest));
}

function parseCanonicalSpeakerRow(
  row: CanonicalSpeakerRow,
): CanonicalSpeakerRecord {
  const bundled = bundledContent.get(row.speaker_id);

  if (!bundled) {
    throw new Error(`Unknown canonical speaker row: ${row.speaker_id}`);
  }

  const parsed: unknown = JSON.parse(row.content_json);

  if (!isSpeakerWorkspaceContent(parsed, bundled.content.talks)) {
    throw new Error(`Invalid canonical content for ${row.speaker_id}.`);
  }

  if (
    !Number.isSafeInteger(row.content_version) ||
    row.content_version < 1 ||
    !Number.isSafeInteger(row.photo_version) ||
    row.photo_version < 1 ||
    !Number.isSafeInteger(row.sort_order) ||
    row.sort_order < 0 ||
    Boolean(row.photo_r2_key) !== Boolean(row.photo_content_hash)
  ) {
    throw new Error(`Invalid canonical metadata for ${row.speaker_id}.`);
  }

  return {
    content: parsed,
    contentVersion: row.content_version,
    lastContentRevisionId: row.last_content_revision_id,
    lastPhotoRevisionId: row.last_photo_revision_id,
    photoContentHash: row.photo_content_hash,
    photoPath: row.photo_path,
    photoR2Key: row.photo_r2_key,
    photoVersion: row.photo_version,
    sortOrder: row.sort_order,
    speakerId: row.speaker_id,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function isSpeakerWorkspaceContent(
  value: unknown,
  bundledTalksForSpeaker: readonly SpeakerTalkContent[],
): value is SpeakerWorkspaceContent {
  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !Array.isArray(value.talks)
  ) {
    return false;
  }

  const profile = value.profile;
  const profileFields = [
    "bio",
    "devto",
    "github",
    "linkedin",
    "name",
    "role",
    "scholar",
    "website",
    "x",
  ];

  if (profileFields.some((field) => typeof profile[field] !== "string")) {
    return false;
  }

  const expectedTalkIds = bundledTalksForSpeaker.map(({ id }) => id).sort();
  const talkIds: string[] = [];

  for (const talk of value.talks) {
    if (
      !isRecord(talk) ||
      typeof talk.id !== "string" ||
      typeof talk.title !== "string" ||
      typeof talk.abstract !== "string"
    ) {
      return false;
    }

    talkIds.push(talk.id);
  }

  talkIds.sort();

  return (
    talkIds.length === expectedTalkIds.length &&
    talkIds.every((id, index) => id === expectedTalkIds[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const canonicalSpeakerSelect = `SELECT
  speaker_id,
  content_json,
  content_version,
  photo_path,
  photo_r2_key,
  photo_content_hash,
  photo_version,
  last_content_revision_id,
  last_photo_revision_id,
  sort_order,
  updated_at,
  updated_by
FROM canonical_speaker_content`;
