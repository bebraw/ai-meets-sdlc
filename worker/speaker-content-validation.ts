import {
  type SocialField,
  type ValidationResult,
} from "./speaker-workspace-types.ts";
import { isRecord, parseHttpsUrl } from "./speaker-workspace-utils.ts";
import {
  type SpeakerProfileContent,
  type SpeakerTalkContent,
} from "./canonical-content.ts";

export const socialFields = [
  "website",
  "linkedin",
  "x",
  "github",
  "devto",
  "scholar",
] as const satisfies readonly SocialField[];

const socialHosts: Record<Exclude<SocialField, "website">, Set<string>> = {
  devto: new Set(["dev.to"]),
  github: new Set(["github.com", "www.github.com"]),
  linkedin: new Set(["linkedin.com", "www.linkedin.com"]),
  scholar: new Set(["scholar.google.com"]),
  x: new Set(["twitter.com", "www.twitter.com", "x.com", "www.x.com"]),
};

export function validateSpeakerWorkspaceContent(
  value: unknown,
  assignedTalkIds: readonly string[],
): ValidationResult {
  const errors: Record<string, string> = {};

  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !Array.isArray(value.talks)
  ) {
    return {
      errors: { form: "The submitted profile is incomplete." },
    };
  }

  const profileValue = value.profile;
  const name = validateText(profileValue.name, "profile.name", 2, 120, errors);
  const role = validateText(profileValue.role, "profile.role", 2, 160, errors);
  const bio = validateText(profileValue.bio, "profile.bio", 40, 2_000, errors);

  if (bio) validateMarkdown(bio, "profile.bio", errors);

  const profile = {
    bio,
    devto: "",
    github: "",
    linkedin: "",
    name,
    role,
    scholar: "",
    website: "",
    x: "",
  } satisfies SpeakerProfileContent;

  for (const field of socialFields) {
    profile[field] = validateSocialUrl(profileValue[field], field, errors);
  }

  const assigned = new Set(assignedTalkIds);
  const received = new Set<string>();
  const talks: SpeakerTalkContent[] = [];

  for (const [index, talkValue] of value.talks.entries()) {
    const prefix = `talks.${index}`;

    if (!isRecord(talkValue) || typeof talkValue.id !== "string") {
      errors[`${prefix}.id`] = "Talk assignment was not recognized.";
      continue;
    }

    const id = talkValue.id.trim();

    if (!assigned.has(id) || received.has(id)) {
      errors[`${prefix}.id`] = "Talk assignment was not recognized.";
      continue;
    }

    received.add(id);
    const title = validateText(
      talkValue.title,
      `${prefix}.title`,
      4,
      200,
      errors,
    );
    const abstract = validateText(
      talkValue.abstract,
      `${prefix}.abstract`,
      20,
      2_500,
      errors,
    );

    if (abstract) validateMarkdown(abstract, `${prefix}.abstract`, errors);

    talks.push({ abstract, id, title });
  }

  for (const talkId of assigned) {
    if (!received.has(talkId)) {
      errors.talks = "Every assigned talk must be included.";
      break;
    }
  }

  if (received.size !== assigned.size) {
    errors.talks ??= "Talk assignments cannot be changed.";
  }

  return Object.keys(errors).length > 0
    ? { errors }
    : { content: { profile, talks }, errors };
}

function validateText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
  errors: Record<string, string>,
): string {
  if (typeof value !== "string") {
    errors[field] = "This field is required.";
    return "";
  }

  const normalized = value.trim().replace(/\r\n?/gu, "\n");

  if (normalized.length < minLength || normalized.length > maxLength) {
    errors[field] =
      `Use between ${minLength} and ${maxLength.toLocaleString("en")} characters.`;
  }

  return normalized;
}

function validateMarkdown(
  value: string,
  field: string,
  errors: Record<string, string>,
): void {
  if (/<[A-Za-z!/][^>]*>/u.test(value) || /!\[[^\]]*\]\s*\(/u.test(value)) {
    errors[field] = "HTML and embedded images are not supported.";
    return;
  }

  const markdownLinkPattern =
    /\[[^\]]+\]\s*\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/gu;

  for (const match of value.matchAll(markdownLinkPattern)) {
    if (!parseHttpsUrl(match[1])) {
      errors[field] = "Markdown links must use complete HTTPS URLs.";
      return;
    }
  }
}

function validateSocialUrl(
  value: unknown,
  field: SocialField,
  errors: Record<string, string>,
): string {
  if (value === undefined || value === null || value === "") return "";

  if (typeof value !== "string") {
    errors[`profile.${field}`] = "Enter a complete HTTPS URL.";
    return "";
  }

  const normalized = value.trim();

  if (normalized.length > 2_048) {
    errors[`profile.${field}`] = "URL is too long.";
    return normalized;
  }

  const url = parseHttpsUrl(normalized);

  if (!url) {
    errors[`profile.${field}`] = "Enter a complete HTTPS URL.";
    return normalized;
  }

  if (
    field !== "website" &&
    !socialHosts[field].has(url.hostname.toLowerCase())
  ) {
    errors[`profile.${field}`] = `Enter a ${socialLabel(field)} profile URL.`;
  }

  return url.toString();
}

function socialLabel(field: Exclude<SocialField, "website">): string {
  return {
    devto: "DEV Community",
    github: "GitHub",
    linkedin: "LinkedIn",
    scholar: "Google Scholar",
    x: "X or Twitter",
  }[field];
}
