import { readAttendeeRoster } from "./attendee-roster.ts";
import { readPosterProposals } from "./poster-proposals.ts";
import { readVolunteers } from "./volunteers.ts";
import { decryptText } from "./form-utils.ts";
import { parseCateringMappings } from "../site/scripts/attendee-catering-model.ts";
import {
  mergeEventAttendees,
  type RegistrationMember,
} from "../site/scripts/event-attendee-model.ts";

export async function readEventAttendeeRoster(
  env: Env,
  attempt = 0,
): Promise<
  ReturnType<typeof mergeEventAttendees> & {
    revision: number;
    members: RegistrationMember[];
  }
> {
  const roster = await readAttendeeRoster(env);
  const [posters, volunteers, saved] = await Promise.all([
    readPosterProposals(env),
    readVolunteers(env),
    env.INTERESTS.prepare(
      "SELECT catering_ciphertext, catering_iv FROM attendee_roster WHERE id = 1",
    ).first<{
      catering_ciphertext: string | null;
      catering_iv: string | null;
    }>(),
  ]);
  const members: RegistrationMember[] = [
    ...posters
      .filter((proposal) => proposal.status === "accepted")
      .map(
        (proposal): RegistrationMember => ({
          id: `poster:${proposal.id}`,
          source: "poster",
          name: proposal.name,
          email: proposal.email,
          company: proposal.organization,
          badge: true,
        }),
      ),
    ...volunteers.map(
      (person): RegistrationMember => ({
        id: `volunteer:${person.id}`,
        source: "volunteer",
        name: person.name,
        email: person.email,
        company: "",
        badge: person.badge,
      }),
    ),
  ];
  // Proposal ordering is newest-first; use stable source order for duplicate proposals.
  members.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const mappings =
    saved?.catering_ciphertext && saved.catering_iv
      ? parseCateringMappings(
          JSON.parse(
            await decryptText(
              saved.catering_ciphertext,
              saved.catering_iv,
              env.EMAIL_ENCRYPTION_KEY,
            ),
          ),
        )
      : [];
  const current = await env.INTERESTS.prepare(
    "SELECT revision FROM attendee_roster WHERE id = 1",
  ).first<{ revision: number }>();
  if (current?.revision !== roster.revision) {
    if (attempt < 2) return readEventAttendeeRoster(env, attempt + 1);
    throw new Error("Registration sources changed during the read");
  }
  return {
    revision: roster.revision,
    members,
    ...mergeEventAttendees(roster.people, members, mappings),
  };
}

/** Transfer source check-ins to a newly linked ticket during authorized roster writes. */
export async function reconcileEventArrivals(env: Env) {
  const roster = await readEventAttendeeRoster(env);
  const statements = [...roster.aliases].flatMap(([id, aliases]) =>
    aliases
      .filter((alias) => alias !== id)
      .map((alias) =>
        env.INTERESTS.prepare(
          `UPDATE attendee_arrivals SET attendee_id = ?1 WHERE attendee_id = ?2
      AND NOT EXISTS (SELECT 1 FROM attendee_arrivals WHERE attendee_id = ?1)
      AND EXISTS (SELECT 1 FROM attendee_roster WHERE id = 1 AND revision = ?3)`,
        ).bind(id, alias, roster.revision),
      ),
  );
  // Reconcile larger source lists in bounded batches.
  for (let index = 0; index < statements.length; index += 50)
    await env.INTERESTS.batch(statements.slice(index, index + 50));
}
