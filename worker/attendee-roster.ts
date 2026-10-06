import { decryptText } from "./form-utils.ts";
import {
  parseAttendeeRoster,
  type AttendeeRecord,
} from "../site/scripts/attendee-model.ts";

export async function readAttendeeRoster(
  env: Env,
): Promise<{ revision: number; people: AttendeeRecord[] }> {
  const row = await env.INTERESTS.prepare(
    "SELECT revision, ciphertext, iv FROM attendee_roster WHERE id = 1",
  ).first<{ revision: number; ciphertext: string | null; iv: string | null }>();
  if (!row) throw new Error("Missing attendee migration");
  return {
    revision: row.revision,
    people:
      row.ciphertext && row.iv
        ? parseAttendeeRoster(
            JSON.parse(
              await decryptText(
                row.ciphertext,
                row.iv,
                env.EMAIL_ENCRYPTION_KEY!,
              ),
            ),
          )
        : [],
  };
}
