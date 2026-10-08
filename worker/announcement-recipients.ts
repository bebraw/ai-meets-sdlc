import { readCanonicalSpeakers } from "./canonical-content.ts";
import {
  readSpeakerDinnerAdminItems,
  readSpeakerDinnerSharedAdminItems,
} from "./speaker-dinner.ts";
import {
  decryptPrivateText,
  hashPrivateText,
  isLikelyEmail,
  normalizeEmail,
} from "./speaker-workspace-utils.ts";
import type {
  SpeakerAnnouncementRecipient,
  SpeakerContactRow,
  SpeakerEmailCategory,
} from "./speaker-workspace-types.ts";

export async function getAnnouncementRecipients(
  env: Env,
  speakerIds: string[],
  category: SpeakerEmailCategory,
  includeDinner = false,
) {
  const result = await env.INTERESTS.prepare(
    `SELECT * FROM speaker_contacts`,
  ).all<SpeakerContactRow & { email_fingerprint: string }>();
  const speakers = new Map(
    (await readCanonicalSpeakers(env)).map((s) => [
      s.speakerId,
      s.content.profile.name,
    ]),
  );
  const contacts = new Map(result.results.map((c) => [c.speaker_id, c]));
  const emails = new Map<string, string>();
  const blockedEmails = new Map<string, string>();
  const excluded: Array<{ reason: string; speaker_id: string; name?: string }> =
    [];
  const recipients = new Map<string, SpeakerAnnouncementRecipient>();
  const reasonFor = (contact: SpeakerContactRow | undefined): string => {
    if (!contact) return "no-contact";
    if (
      !Number.isFinite(Date.parse(contact.retention_until)) ||
      Date.parse(contact.retention_until) <= Date.now()
    )
      return "contact-expired";
    if (contact.delivery_status !== "active") return "suppressed";
    if (category === "operational" && contact.operational_email_enabled !== 1)
      return "operational-disabled";
    if (category === "promotion" && !contact.email_confirmed_at)
      return "unconfirmed";
    if (category === "promotion" && contact.promotion_email_enabled !== 1)
      return "promotion-disabled";
    return "";
  };
  // A dinner address must never bypass a speaker's suppression or preferences.
  for (const contact of result.results) {
    let reason = reasonFor(contact);
    try {
      const email = normalizeEmail(
        await decryptPrivateText(
          contact.email_ciphertext,
          contact.email_iv,
          env.EMAIL_ENCRYPTION_KEY,
        ),
      );
      if (!isLikelyEmail(email)) reason ||= "contact-unavailable";
      else emails.set(contact.speaker_id, email);
      if (reason)
        blockedEmails.set(
          await hashPrivateText(email, env.EMAIL_ENCRYPTION_KEY, "email-hash"),
          reason,
        );
    } catch {
      blockedEmails.set(contact.email_fingerprint, "contact-unavailable");
    }
  }
  async function add(
    email: string | undefined,
    name: string,
    sourceId: string,
    group: "speakers" | "dinner",
    speakerId: string,
    reason = "",
  ) {
    if (!email) reason ||= "no-contact";
    const fingerprint = email
      ? await hashPrivateText(email, env.EMAIL_ENCRYPTION_KEY, "email-hash")
      : "";
    reason ||= blockedEmails.get(fingerprint) ?? "";
    if (reason || !email) {
      excluded.push({ reason, speaker_id: speakerId, name });
      return;
    }
    const previous = recipients.get(fingerprint);
    if (previous) {
      if (!previous.sourceIds.includes(sourceId))
        previous.sourceIds.push(sourceId);
      if (!previous.groups.includes(group)) previous.groups.push(group);
    } else
      recipients.set(fingerprint, {
        email,
        name,
        speakerId,
        sourceIds: [sourceId],
        groups: [group],
        emailFingerprint: fingerprint,
      });
  }
  for (const speakerId of speakerIds) {
    await add(
      emails.get(speakerId),
      speakers.get(speakerId) ?? speakerId,
      `speaker:${speakerId}`,
      "speakers",
      speakerId,
      reasonFor(contacts.get(speakerId)),
    );
  }
  if (includeDinner) {
    const retention = Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL ?? "");
    if (!Number.isFinite(retention) || Date.now() >= retention) {
      excluded.push({ reason: "dinner-retention-ended", speaker_id: "dinner" });
    } else {
      const [dinnerSpeakers, guests] = await Promise.all([
        readSpeakerDinnerAdminItems(env),
        readSpeakerDinnerSharedAdminItems(env),
      ]);
      for (const speaker of dinnerSpeakers) {
        if (
          speaker.response?.attendance !== "attending" ||
          !speaker.expires_at ||
          Date.parse(speaker.expires_at) <= Date.now()
        )
          continue;
        await add(
          emails.get(speaker.speaker_id),
          speaker.name,
          `dinner-speaker:${speaker.speaker_id}`,
          "dinner",
          speaker.speaker_id,
          reasonFor(contacts.get(speaker.speaker_id)),
        );
      }
      for (const guest of guests) {
        if (guest.response.attendance !== "attending") continue;
        const email = normalizeEmail(guest.email);
        await add(
          isLikelyEmail(email) ? email : undefined,
          guest.name,
          `dinner-guest:${guest.response_id}`,
          "dinner",
          `dinner-guest:${guest.response_id}`,
        );
      }
    }
  }
  return { excluded, recipients: [...recipients.values()] };
}
