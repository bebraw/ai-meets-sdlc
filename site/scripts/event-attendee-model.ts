import type { AttendeeRecord } from "./attendee-model.ts";
import type { CateringMapping } from "./attendee-catering-model.ts";

export interface RegistrationMember {
  id: string;
  source: "poster" | "volunteer";
  name: string;
  email: string;
  company: string;
  badge: boolean;
}
export const memberAttendeeId = (member: RegistrationMember) =>
  member.id.replace(":", "-");
const nameKey = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
const emailKey = (value: string) => value.trim().toLowerCase();

/** Overlay live membership without copying it into the imported ticket roster. */
export function mergeEventAttendees(
  imported: readonly AttendeeRecord[],
  members: readonly RegistrationMember[],
  mappings: readonly CateringMapping[] = [],
) {
  const people = imported.map((person) => ({ ...person }));
  const links = new Map(mappings.map((item) => [item.sourceId, item.target]));
  const aliases = new Map(people.map((person) => [person.id, [person.id]]));
  const memberTargets = new Map<string, string | null>();
  // Exact emails identify repeated proposals; a name match only applies when unique.
  for (const member of members) {
    const link = links.get(member.id);
    let matches: AttendeeRecord[] = [];
    if (link?.startsWith("attendee:"))
      matches = people.filter((person) => person.id === link.slice(9));
    else if (link !== "separate") {
      const emails = member.email
        ? people.filter(
            (person) => emailKey(person.email) === emailKey(member.email),
          )
        : [];
      matches = emails.length
        ? emails
        : people.filter(
            (person) => nameKey(person.name) === nameKey(member.name),
          );
      if (matches.length > 1) {
        const named = matches.filter(
          (person) => nameKey(person.name) === nameKey(member.name),
        );
        if (named.length === 1) matches = named;
      }
    }
    if (
      matches.length > 1 ||
      (link?.startsWith("attendee:") && !matches.length)
    ) {
      memberTargets.set(member.id, null);
      continue;
    }
    const person = matches[0] ?? {
      id: memberAttendeeId(member),
      source: member.source,
      sourceKey: member.id,
      name: member.name,
      email: member.email,
      company: member.company,
      ticketCode: "",
      status: "active" as const,
      type:
        member.source === "volunteer"
          ? ("organizer" as const)
          : ("attendee" as const),
      badge: member.badge,
    };
    if (!matches.length) {
      people.push(person);
      aliases.set(person.id, [person.id]);
    }
    if (member.source === "volunteer") person.type = "organizer";
    const ids = aliases.get(person.id)!;
    if (!ids.includes(memberAttendeeId(member)))
      ids.push(memberAttendeeId(member));
    memberTargets.set(member.id, person.id);
  }
  return {
    people,
    aliases,
    memberTargets,
    pending: [...memberTargets.values()].filter((id) => !id).length,
  };
}
