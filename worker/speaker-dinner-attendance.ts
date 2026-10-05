import { decryptText } from "./form-utils.ts";
import type { SpeakerDinnerResponseData } from "./speaker-workspace-types.ts";

export interface DinnerAttendanceRow {
  attendance_override_ciphertext: string | null;
  attendance_override_iv: string | null;
  dinner_revision: number;
}

/** Apply organizer attendance without replacing the speaker's original food details or consent. */
export async function applyDinnerAttendance(
  row: DinnerAttendanceRow,
  response: SpeakerDinnerResponseData | null,
  env: Env,
): Promise<SpeakerDinnerResponseData | null> {
  if (
    row.attendance_override_ciphertext == null &&
    row.attendance_override_iv == null
  )
    return response;
  if (!row.attendance_override_ciphertext || !row.attendance_override_iv)
    throw new Error("Encrypted dinner attendance is incomplete");
  const attendance: unknown = JSON.parse(
    await decryptText(
      row.attendance_override_ciphertext,
      row.attendance_override_iv,
      env.EMAIL_ENCRYPTION_KEY!,
    ),
  );
  if (attendance !== "attending" && attendance !== "not_attending")
    throw new Error("Encrypted dinner attendance is invalid");
  return {
    ...(response ?? {
      meal_preference: "",
      food_requirements: "",
      cross_contamination: "",
    }),
    attendance,
  };
}
