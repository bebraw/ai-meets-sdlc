import { withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  jsonResponse,
  requireAdminAction,
  encryptText,
  decryptText,
  sha256Hex,
} from "./form-utils.ts";
import { readJsonWithinLimit, isRecord } from "./speaker-workspace-utils.ts";
import {
  defaultSettings,
  badgeCompany,
  parseWorkspace,
  type BadgePerson,
  type BadgeRole,
  type BadgeWorkspace,
} from "../site/scripts/badge-model.ts";
import {
  parsePrintPreferences,
  isLegacyBadgeId,
  type PrintPreferences,
  type BadgeStudioData,
} from "../site/scripts/badge-studio-model.ts";
import { readEventAttendeeRoster } from "./event-attendees.ts";
import { readOrganizers } from "./organizers.ts";
import { readVolunteers } from "./volunteers.ts";
import { readPublicCanonicalSpeakers } from "./canonical-content.ts";

interface SavedStudio {
  revision: number;
  preferences: PrintPreferences;
  legacyWorkspace: BadgeWorkspace | null;
}
async function readSavedStudio(env: Env): Promise<SavedStudio> {
  const row = await env.INTERESTS.prepare(
    "SELECT revision, ciphertext, iv FROM badge_workspace WHERE id = 1",
  ).first<{ revision: number; ciphertext: string | null; iv: string | null }>();
  if (!row) throw new Error("Missing migration");
  if (!row.ciphertext || !row.iv)
    return {
      revision: row.revision,
      preferences: {
        settings: { ...defaultSettings },
        overrides: [],
        spareAttendeeBadges: 0,
        spareSponsorBadges: 0,
        retiredLegacyIds: [],
      },
      legacyWorkspace: null,
    };
  const value: unknown = JSON.parse(
    await decryptText(row.ciphertext, row.iv, env.EMAIL_ENCRYPTION_KEY!),
  );
  if (isRecord(value) && (value.version === 2 || value.version === 3)) {
    const saved = {
      revision: row.revision,
      preferences: parsePrintPreferences(value.preferences),
      legacyWorkspace:
        value.legacyWorkspace == null
          ? null
          : parseWorkspace(value.legacyWorkspace),
    };
    if (value.version === 2) retireEarlierExclusions(saved);
    return saved;
  }
  const legacyWorkspace = parseWorkspace(value);
  const saved = {
    revision: row.revision,
    preferences: {
      settings: legacyWorkspace.settings,
      overrides: [],
      spareAttendeeBadges: 0,
      spareSponsorBadges: 0,
      retiredLegacyIds: [],
    },
    legacyWorkspace,
  };
  retireEarlierExclusions(saved);
  return saved;
}
function retireEarlierExclusions(saved: SavedStudio): void {
  saved.preferences.retiredLegacyIds = [
    ...new Set([
      ...saved.preferences.retiredLegacyIds,
      ...(saved.legacyWorkspace?.people
        .filter((person) => isLegacyBadgeId(person.id) && !person.included)
        .map((person) => person.id) ?? []),
    ]),
  ];
}
async function readStudio(
  env: Env,
  saved: SavedStudio,
): Promise<BadgeStudioData> {
  const [roster, speakers, contacts, organizers, volunteers] =
    await Promise.all([
      readEventAttendeeRoster(env),
      readPublicCanonicalSpeakers(env),
      env.INTERESTS.prepare(
        "SELECT speaker_id, email_ciphertext, email_iv FROM speaker_contacts",
      ).all<{
        speaker_id: string;
        email_ciphertext: string;
        email_iv: string;
      }>(),
      readOrganizers(env),
      readVolunteers(env, saved.legacyWorkspace),
    ]);
  const emails = new Map(
    await Promise.all(
      contacts.results.map(
        async (row): Promise<[string, string]> => [
          row.speaker_id,
          await decryptText(
            row.email_ciphertext,
            row.email_iv,
            env.EMAIL_ENCRYPTION_KEY!,
          ),
        ],
      ),
    ),
  );
  const make = (
    source: string,
    id: string,
    name: string,
    company: string,
    email: string,
    role: BadgeRole,
  ): BadgePerson => ({
    id: `${source}:${id}`,
    name,
    company: badgeCompany(email, company),
    email,
    role,
    source,
    included: true,
    duplicateReviewed: false,
  });
  const people = [
    ...roster.people
      .filter(
        (p) => p.status === "active" && p.badge && p.source !== "volunteer",
      )
      .map((p) => make("attendees", p.id, p.name, p.company, p.email, p.type)),
    ...speakers.map((p) =>
      make(
        "speakers",
        p.speakerId,
        p.content.profile.name,
        p.content.profile.company ?? "",
        emails.get(p.speakerId) ?? "",
        "speaker",
      ),
    ),
    ...organizers
      .filter((p) => p.badge)
      .map((p) => make("organizers", p.id, p.name, p.company, "", "organizer")),
    ...volunteers
      .filter((p) => p.badge)
      .map((p) => make("volunteers", p.id, p.name, "", p.email, "organizer")),
  ];
  const currentEmails = new Set(
    [...roster.people, ...people]
      .map((p) => p.email.trim().toLowerCase())
      .filter(Boolean),
  );
  const legacyPeople =
    saved.legacyWorkspace?.people.filter(
      (p) =>
        isLegacyBadgeId(p.id) &&
        !saved.preferences.retiredLegacyIds.includes(p.id) &&
        (!p.email || !currentEmails.has(p.email.trim().toLowerCase())),
    ) ?? [];
  // The original snapshot stays intact. Retirement now owns legacy inclusion,
  // so restoring an earlier exclusion makes that badge printable again.
  people.push(...legacyPeople.map((person) => ({ ...person, included: true })));
  parseWorkspace({ people, settings: saved.preferences.settings });
  const signatures = Object.fromEntries(
    await Promise.all(
      people.map(async (person) => [
        person.id,
        await sha256Hex(JSON.stringify(person)),
      ]),
    ),
  );
  return {
    revision: saved.revision,
    people,
    signatures,
    preferences: saved.preferences,
    legacyCount: legacyPeople.length,
    legacyWorkspace: saved.legacyWorkspace,
  };
}
export async function handleBadgeWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await handle(request, env));
  } catch {
    return withAdminSecurityHeaders(
      jsonResponse(
        {
          error:
            "Badge storage is unavailable. Your unsaved print settings remain in this tab.",
        },
        503,
      ),
    );
  }
}
async function handle(request: Request, env: Env): Promise<Response> {
  if (!["GET", "PUT"].includes(request.method))
    return jsonResponse({ error: "Method not allowed." }, 405);
  if (!env.EMAIL_ENCRYPTION_KEY)
    return jsonResponse({ error: "Badge encryption is not configured." }, 503);
  if (request.method === "GET")
    return jsonResponse({
      ...(await readStudio(env, await readSavedStudio(env))),
    });
  const forbidden = requireAdminAction(request, "manage-badges");
  if (forbidden) return forbidden;
  const body = await readJsonWithinLimit(request, 1800 * 1024);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0
  )
    return jsonResponse({ error: "Reload saved print settings." }, 400);
  let preferences: PrintPreferences;
  try {
    preferences = parsePrintPreferences(body.preferences);
  } catch {
    return jsonResponse(
      {
        error:
          "Invalid print settings or badge text. Manage attendee names and inclusion in the attendee workspace.",
      },
      400,
    );
  }
  const saved = await readSavedStudio(env);
  if (saved.revision !== body.revision) return conflict();
  const studio = await readStudio(env, saved);
  const legacyIds = new Set(
    saved.legacyWorkspace?.people
      .filter((p) => isLegacyBadgeId(p.id))
      .map((p) => p.id),
  );
  if (preferences.retiredLegacyIds.some((id) => !legacyIds.has(id)))
    return jsonResponse(
      {
        error:
          "Only earlier CSV or manual badges can be retired here. Manage current people in their own workspaces.",
      },
      400,
    );
  if (
    preferences.overrides.some((p) => p.signature !== studio.signatures[p.id])
  )
    return jsonResponse(
      {
        error:
          "The roster changed. Reload people and review your badge text before saving.",
      },
      409,
    );
  const value = JSON.stringify({
    version: 3,
    preferences,
    legacyWorkspace: saved.legacyWorkspace,
  });
  if (new TextEncoder().encode(value).length > 1200 * 1024)
    return jsonResponse(
      { error: "Print settings exceed the storage limit." },
      413,
    );
  const encrypted = await encryptText(value, env.EMAIL_ENCRYPTION_KEY);
  const result = await env.INTERESTS.prepare(
    "UPDATE badge_workspace SET ciphertext = ?, iv = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?",
  )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
      body.revision,
    )
    .run();
  return result.meta.changes
    ? jsonResponse({ revision: Number(body.revision) + 1 })
    : conflict();
}
function conflict(): Response {
  return jsonResponse(
    { error: "Print settings changed in another tab. Reload before saving." },
    409,
  );
}
