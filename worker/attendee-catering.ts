import { withAdminSecurityHeaders } from "./admin-auth.ts";
import { readAttendeeRoster } from "./attendees.ts";
import { workspaceOnlySpeakerIds } from "./canonical-content.ts";
import { readOrganizers } from "./organizers.ts";
import {
  readSpeakerDinnerAdminItems,
  readSpeakerDinnerSharedAdminItems,
} from "./speaker-dinner.ts";
import {
  decryptText,
  encryptText,
  jsonResponse,
  requireAdminAction,
  sha256Hex,
} from "./form-utils.ts";
import { isRecord, readJsonWithinLimit } from "./speaker-workspace-utils.ts";
import {
  dinnerDiet,
  parseCateringMappings,
  type CateringData,
  type CateringSource,
} from "../site/scripts/attendee-catering-model.ts";

async function readCatering(env: Env) {
  const [row, speakers, guests, organizers, contacts, roster] =
    await Promise.all([
      env.INTERESTS.prepare(
        "SELECT catering_revision, catering_ciphertext, catering_iv FROM attendee_roster WHERE id = 1",
      ).first<{
        catering_revision: number;
        catering_ciphertext: string | null;
        catering_iv: string | null;
      }>(),
      readSpeakerDinnerAdminItems(env),
      readSpeakerDinnerSharedAdminItems(env),
      readOrganizers(env),
      env.INTERESTS.prepare(
        "SELECT speaker_id, email_ciphertext, email_iv FROM speaker_contacts WHERE retention_until > ?",
      )
        .bind(new Date().toISOString())
        .all<{
          speaker_id: string;
          email_ciphertext: string;
          email_iv: string;
        }>(),
      readAttendeeRoster(env),
    ]);
  if (!row) throw new Error("Missing catering migration");
  const emails = new Map(
    await Promise.all(
      contacts.results.map(
        async (contact): Promise<[string, string]> => [
          contact.speaker_id,
          await decryptText(
            contact.email_ciphertext,
            contact.email_iv,
            env.EMAIL_ENCRYPTION_KEY,
          ),
        ],
      ),
    ),
  );
  const retained = Date.now() < Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL);
  const sources: CateringSource[] = [
    ...speakers
      .filter(
        (speaker) =>
          !workspaceOnlySpeakerIds.has(speaker.speaker_id) ||
          (retained && speaker.response),
      )
      .map(
        (speaker): CateringSource => ({
          id: `${workspaceOnlySpeakerIds.has(speaker.speaker_id) ? "dinner-speaker" : "speaker"}:${speaker.speaker_id}`,
          name: speaker.name,
          email: emails.get(speaker.speaker_id) ?? "",
          kind: workspaceOnlySpeakerIds.has(speaker.speaker_id)
            ? "dinner-guest"
            : "speaker",
          diet: retained ? dinnerDiet(speaker.response) : undefined,
        }),
      ),
    ...(retained
      ? guests.map(
          (guest): CateringSource => ({
            id: `dinner-guest:${guest.response_id}`,
            name: guest.name,
            kind: "dinner-guest",
            diet: dinnerDiet(guest.response),
          }),
        )
      : []),
  ];
  const people = organizers.map(({ id, name }) => ({ id, name }));
  const data: CateringData = {
    revision: row.catering_revision,
    version: await sha256Hex(
      JSON.stringify({ sources, organizers: people, attendees: roster.people }),
    ),
    mappings:
      row.catering_ciphertext && row.catering_iv
        ? parseCateringMappings(
            JSON.parse(
              await decryptText(
                row.catering_ciphertext,
                row.catering_iv,
                env.EMAIL_ENCRYPTION_KEY,
              ),
            ),
          )
        : [],
    sources,
    organizers: people,
  };
  return { data, roster };
}

/** Routed only after the admin gate in index.ts. No dietary data reaches desk sessions. */
export async function handleAttendeeCatering(
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
            "Catering sources are unavailable. Reload before exporting the summary.",
        },
        503,
      ),
    );
  }
}
async function handle(request: Request, env: Env): Promise<Response> {
  if (!["GET", "PUT"].includes(request.method))
    return jsonResponse({ error: "Method not allowed." }, 405);
  if (request.method === "PUT") {
    const forbidden = requireAdminAction(request, "manage-attendee-catering");
    if (forbidden) return forbidden;
  }
  const { data, roster } = await readCatering(env);
  if (request.method === "GET") return jsonResponse({ ...data });
  const body = await readJsonWithinLimit(request, 512 * 1024);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0 ||
    typeof body.version !== "string"
  )
    return jsonResponse(
      { error: "Reload catering sources before saving." },
      400,
    );
  if (body.revision !== data.revision || body.version !== data.version)
    return conflict();
  let mappings;
  try {
    mappings = parseCateringMappings(body.mappings);
  } catch {
    return jsonResponse(
      { error: "Choose valid dinner mappings without duplicate responses." },
      400,
    );
  }
  const sources = new Set(data.sources.map((source) => source.id));
  const targets = new Set([
    "exclude",
    "separate",
    ...data.organizers.map((person) => `organizer:${person.id}`),
    ...roster.people
      .filter((person) => person.status === "active")
      .map((person) => `attendee:${person.id}`),
  ]);
  if (
    mappings.some(
      (item) => !sources.has(item.sourceId) || !targets.has(item.target),
    )
  )
    return jsonResponse(
      {
        error:
          "A mapped person is no longer available. Reload and review the dinner mappings.",
      },
      400,
    );
  const encrypted = await encryptText(
    JSON.stringify(mappings),
    env.EMAIL_ENCRYPTION_KEY,
  );
  const result = await env.INTERESTS.prepare(
    "UPDATE attendee_roster SET catering_ciphertext = ?, catering_iv = ?, catering_revision = catering_revision + 1, updated_at = ? WHERE id = 1 AND catering_revision = ? AND revision = ?",
  )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
      data.revision,
      roster.revision,
    )
    .run();
  return result.meta.changes
    ? jsonResponse({ revision: data.revision + 1 })
    : conflict();
}
function conflict(): Response {
  return jsonResponse(
    {
      error:
        "Catering sources or mappings changed. Reload and review before saving again.",
    },
    409,
  );
}
