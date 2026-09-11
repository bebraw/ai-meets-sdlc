import {
  jsonResponse,
  readFormDataWithinLimit,
  normalizeFormText,
  encryptText,
  importAesKey,
  encryptTextWithKey,
  decryptTextWithKey,
  decryptText,
  base64Encode,
  hashText,
  formatCsvValue,
} from "./form-utils.ts";
import {
  readCanonicalSpeaker,
  readCanonicalSpeakers,
} from "./canonical-content.ts";

type SpeakerDinnerAttendance = "attending" | "not_attending";

type SpeakerDinnerMealPreference =
  | ""
  | "omnivore"
  | "vegetarian"
  | "vegan"
  | "other";

type SpeakerDinnerCrossContamination = "" | "yes" | "no" | "unsure";

interface SpeakerDinnerResponseData {
  attendance: SpeakerDinnerAttendance;
  cross_contamination: SpeakerDinnerCrossContamination;
  food_requirements: string;
  meal_preference: SpeakerDinnerMealPreference;
}

interface SpeakerDinnerRow {
  consent_text: string | null;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  response_ciphertext: string | null;
  response_iv: string | null;
  speaker_id: string;
  token_hash: string;
  updated_at: string;
}

interface SpeakerDinnerAdminItem {
  expires_at: string | null;
  invited: boolean;
  name: string;
  responded_at: string | null;
  response: SpeakerDinnerResponseData | null;
  speaker_id: string;
  updated_at: string | null;
}

interface SpeakerDinnerSharedInviteRow {
  created_at: string;
  expires_at: string;
  id: number;
  token_hash: string;
  updated_at: string;
}

interface SpeakerDinnerSharedResponseRow {
  consent_text: string;
  created_at: string;
  name_ciphertext: string;
  name_iv: string;
  responded_at: string;
  response_ciphertext: string;
  response_id: string;
  response_iv: string;
  updated_at: string;
}

interface SpeakerDinnerSharedAdminItem {
  name: string;
  responded_at: string;
  response: SpeakerDinnerResponseData;
  updated_at: string;
}

const speakerDinnerConsentText =
  "I consent to Toska Osuuskunta processing this response and, if I attend, sharing only the necessary food information with the dinner caterer. I can withdraw by contacting info@sdlcai.org.";

const maxSpeakerDinnerBodyBytes = 16 * 1024;

export function withSpeakerDinnerSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function handleSpeakerDinnerInvite(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;

  if (Date.now() > configuration.deadline) {
    return jsonResponse(
      { error: "The speaker dinner response deadline has passed." },
      410,
    );
  }

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxSpeakerDinnerBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  const speakerId = normalizeFormText(formDataResult.get("speaker_id"));
  const speaker = await readCanonicalSpeaker(env, speakerId);

  if (!speaker) {
    return jsonResponse({ error: "Choose a current SDLCAI speaker." }, 400);
  }

  const token = generateSpeakerDinnerToken();
  const tokenHash = await hashSpeakerDinnerToken(
    token,
    env.EMAIL_ENCRYPTION_KEY,
  );
  const now = new Date().toISOString();
  const expiresAt = new Date(configuration.retention).toISOString();

  await env.INTERESTS.prepare(
    `INSERT INTO speaker_dinner_responses (
      speaker_id,
      token_hash,
      created_at,
      expires_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(speaker_id) DO UPDATE SET
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at`,
  )
    .bind(speaker.speakerId, tokenHash, now, expiresAt, now)
    .run();

  const inviteUrl = new URL("/speaker-dinner/", request.url);
  inviteUrl.hash = token;

  return jsonResponse(
    {
      invite_url: inviteUrl.toString(),
      message: `A new private link was created for ${speaker.content.profile.name}. Any earlier link is now invalid.`,
      ok: true,
      speaker_id: speaker.speakerId,
    },
    201,
  );
}

export async function handleSpeakerDinnerStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const invitation = await readSpeakerDinnerInvitation(request, env);

  if (!invitation) return speakerDinnerInvitationError();

  const speaker = await readCanonicalSpeaker(env, invitation.speaker_id);

  if (!speaker) return speakerDinnerInvitationError();

  const configuration = getSpeakerDinnerConfiguration(env)!;
  const response = await decryptSpeakerDinnerResponse(invitation, env);

  return jsonResponse({
    closed: Date.now() > configuration.deadline,
    deadline: new Date(configuration.deadline).toISOString(),
    name: speaker.content.profile.name,
    response,
    responded_at: invitation.responded_at,
  });
}

export async function handleSpeakerDinnerResponse(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;

  if (Date.now() > configuration.deadline) {
    return jsonResponse(
      { error: "The speaker dinner response deadline has passed." },
      410,
    );
  }

  const invitation = await readSpeakerDinnerInvitation(request, env);

  if (!invitation) return speakerDinnerInvitationError();

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxSpeakerDinnerBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  const responseDataResult = parseSpeakerDinnerResponseData(formDataResult);

  if (responseDataResult instanceof Response) return responseDataResult;

  const responseData = responseDataResult;
  const encryptedResponse = await encryptText(
    JSON.stringify(responseData),
    env.EMAIL_ENCRYPTION_KEY,
  );
  const respondedAt = new Date().toISOString();
  const result = await env.INTERESTS.prepare(
    `UPDATE speaker_dinner_responses
    SET response_ciphertext = ?,
        response_iv = ?,
        consent_text = ?,
        responded_at = ?,
        updated_at = ?
    WHERE speaker_id = ? AND token_hash = ?`,
  )
    .bind(
      encryptedResponse.ciphertext,
      encryptedResponse.iv,
      speakerDinnerConsentText,
      respondedAt,
      respondedAt,
      invitation.speaker_id,
      invitation.token_hash,
    )
    .run();

  if (result.meta.changes === 0) return speakerDinnerInvitationError();

  return jsonResponse({
    message:
      "Your dinner response has been saved. You can use this link to update it before the deadline.",
    ok: true,
    responded_at: respondedAt,
    response: responseData,
  });
}

export async function handleSpeakerDinnerSharedInvite(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;

  if (Date.now() > configuration.deadline) {
    return jsonResponse(
      { error: "The speaker dinner response deadline has passed." },
      410,
    );
  }

  const token = generateSpeakerDinnerToken();
  const tokenHash = await hashSpeakerDinnerSharedToken(
    token,
    env.EMAIL_ENCRYPTION_KEY,
  );
  const encryptedToken = await encryptText(token, env.EMAIL_ENCRYPTION_KEY);
  const now = new Date().toISOString();
  const expiresAt = new Date(configuration.retention).toISOString();

  await env.INTERESTS.prepare(
    `INSERT INTO speaker_dinner_shared_invites (
      token_hash,
      token_ciphertext,
      token_iv,
      created_at,
      expires_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      tokenHash,
      encryptedToken.ciphertext,
      encryptedToken.iv,
      now,
      expiresAt,
      now,
    )
    .run();

  const inviteUrl = new URL("/speaker-dinner/shared/", request.url);
  inviteUrl.hash = token;

  return jsonResponse(
    {
      invite_url: inviteUrl.toString(),
      message:
        "A new shared dinner link was created. Earlier shared links remain valid.",
      ok: true,
    },
    201,
  );
}

export async function handleSpeakerDinnerSharedStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const invitation = await readSpeakerDinnerSharedInvitation(request, env);

  if (!invitation) return speakerDinnerInvitationError();

  const configuration = getSpeakerDinnerConfiguration(env)!;
  const responseId = parseSpeakerDinnerResponseId(
    request.headers.get("x-dinner-response-id"),
  );
  const savedResponse = responseId
    ? await readSpeakerDinnerSharedResponse(env, responseId)
    : null;

  return jsonResponse({
    closed: Date.now() > configuration.deadline,
    deadline: new Date(configuration.deadline).toISOString(),
    name: savedResponse?.name ?? "",
    response: savedResponse?.response ?? null,
    responded_at: savedResponse?.responded_at ?? null,
  });
}

export async function handleSpeakerDinnerSharedResponse(
  request: Request,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;

  if (Date.now() > configuration.deadline) {
    return jsonResponse(
      { error: "The speaker dinner response deadline has passed." },
      410,
    );
  }

  const invitation = await readSpeakerDinnerSharedInvitation(request, env);

  if (!invitation) return speakerDinnerInvitationError();

  const responseId = parseSpeakerDinnerResponseId(
    request.headers.get("x-dinner-response-id"),
  );

  if (!responseId) {
    return jsonResponse({ error: "Reload the invitation and try again." }, 400);
  }

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxSpeakerDinnerBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  const name = normalizeFormText(formDataResult.get("name"));

  if (!name) {
    return jsonResponse({ error: "Enter your name." }, 400);
  }

  if (name.length > 120) {
    return jsonResponse(
      { error: "Keep your name to 120 characters or fewer." },
      400,
    );
  }

  const responseDataResult = parseSpeakerDinnerResponseData(formDataResult);

  if (responseDataResult instanceof Response) return responseDataResult;

  const encryptionKey = await importAesKey(env.EMAIL_ENCRYPTION_KEY);
  const [encryptedName, encryptedResponse] = await Promise.all([
    encryptTextWithKey(name, encryptionKey),
    encryptTextWithKey(JSON.stringify(responseDataResult), encryptionKey),
  ]);
  const respondedAt = new Date().toISOString();

  await env.INTERESTS.prepare(
    `INSERT INTO speaker_dinner_shared_responses (
      response_id,
      name_ciphertext,
      name_iv,
      response_ciphertext,
      response_iv,
      consent_text,
      created_at,
      responded_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(response_id) DO UPDATE SET
      name_ciphertext = excluded.name_ciphertext,
      name_iv = excluded.name_iv,
      response_ciphertext = excluded.response_ciphertext,
      response_iv = excluded.response_iv,
      consent_text = excluded.consent_text,
      responded_at = excluded.responded_at,
      updated_at = excluded.updated_at`,
  )
    .bind(
      responseId,
      encryptedName.ciphertext,
      encryptedName.iv,
      encryptedResponse.ciphertext,
      encryptedResponse.iv,
      speakerDinnerConsentText,
      respondedAt,
      respondedAt,
      respondedAt,
    )
    .run();

  return jsonResponse({
    message:
      "Your dinner response has been saved. Keep this tab open to update it before the deadline.",
    name,
    ok: true,
    responded_at: respondedAt,
    response: responseDataResult,
  });
}

function parseSpeakerDinnerResponseData(
  formData: FormData,
): SpeakerDinnerResponseData | Response {
  const consentGiven = formData.get("consent") === "yes";
  const attendance = normalizeFormText(formData.get("attendance"));

  if (!consentGiven) {
    return jsonResponse({ error: "Consent is required." }, 400);
  }

  if (attendance !== "attending" && attendance !== "not_attending") {
    return jsonResponse({ error: "Tell us whether you can attend." }, 400);
  }

  let mealPreference: SpeakerDinnerMealPreference = "";
  let foodRequirements = "";
  let crossContamination: SpeakerDinnerCrossContamination = "";

  if (attendance === "attending") {
    const mealPreferenceValue = normalizeFormText(
      formData.get("meal_preference"),
    );
    const crossContaminationValue = normalizeFormText(
      formData.get("cross_contamination"),
    );
    foodRequirements = normalizeFormText(formData.get("food_requirements"));

    if (!isSpeakerDinnerMealPreference(mealPreferenceValue)) {
      return jsonResponse({ error: "Choose a meal preference." }, 400);
    }

    if (!isSpeakerDinnerCrossContamination(crossContaminationValue)) {
      return jsonResponse(
        { error: "Tell us whether cross-contamination is a concern." },
        400,
      );
    }

    if (foodRequirements.length > 800) {
      return jsonResponse(
        { error: "Keep food requirements to 800 characters or fewer." },
        400,
      );
    }

    mealPreference = mealPreferenceValue;
    crossContamination = crossContaminationValue;
  }

  return {
    attendance,
    cross_contamination: crossContamination,
    food_requirements: foodRequirements,
    meal_preference: mealPreference,
  };
}

export async function handleSpeakerDinnerPurge(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Dinner storage is not configured." }, 503);
  }

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxSpeakerDinnerBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  if (normalizeFormText(formDataResult.get("confirmation")) !== "DELETE") {
    return jsonResponse(
      { error: "Type DELETE to confirm removal of all dinner data." },
      400,
    );
  }

  const results = await deleteSpeakerDinnerData(env);
  const deleted = results.reduce(
    (total, result) => total + result.meta.changes,
    0,
  );

  return jsonResponse({ deleted, ok: true });
}

async function readSpeakerDinnerInvitation(
  request: Request,
  env: Env,
): Promise<SpeakerDinnerRow | null> {
  const token = parseSpeakerDinnerBearerToken(
    request.headers.get("authorization"),
  );

  if (!token) return null;

  const tokenHash = await hashSpeakerDinnerToken(
    token,
    env.EMAIL_ENCRYPTION_KEY,
  );
  const now = new Date().toISOString();

  return env.INTERESTS.prepare(
    `SELECT
      speaker_id,
      token_hash,
      response_ciphertext,
      response_iv,
      consent_text,
      created_at,
      expires_at,
      responded_at,
      updated_at
    FROM speaker_dinner_responses
    WHERE token_hash = ? AND expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<SpeakerDinnerRow>();
}

async function readSpeakerDinnerSharedInvitation(
  request: Request,
  env: Env,
): Promise<SpeakerDinnerSharedInviteRow | null> {
  const token = parseSpeakerDinnerBearerToken(
    request.headers.get("authorization"),
  );

  if (!token) return null;

  const tokenHash = await hashSpeakerDinnerSharedToken(
    token,
    env.EMAIL_ENCRYPTION_KEY,
  );
  const now = new Date().toISOString();

  return env.INTERESTS.prepare(
    `SELECT id, token_hash, created_at, expires_at, updated_at
    FROM speaker_dinner_shared_invites
    WHERE token_hash = ? AND expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<SpeakerDinnerSharedInviteRow>();
}

export async function readSpeakerDinnerSharedInvite(
  request: Request,
  env: Env,
): Promise<{ active: boolean; invite_url: string | null }> {
  const now = new Date().toISOString();
  const row = await env.INTERESTS.prepare(
    `SELECT token_ciphertext, token_iv
    FROM speaker_dinner_shared_invites
    WHERE expires_at > ?
    ORDER BY id DESC
    LIMIT 1`,
  )
    .bind(now)
    .first<{ token_ciphertext: string | null; token_iv: string | null }>();

  if (!row) return { active: false, invite_url: null };
  if (!row.token_ciphertext || !row.token_iv)
    return { active: true, invite_url: null };

  const token = await decryptText(
    row.token_ciphertext,
    row.token_iv,
    env.EMAIL_ENCRYPTION_KEY,
  );
  const inviteUrl = new URL("/speaker-dinner/shared/", request.url);
  inviteUrl.hash = token;
  return { active: true, invite_url: inviteUrl.toString() };
}

export async function readSpeakerDinnerAdminItems(
  env: Env,
): Promise<SpeakerDinnerAdminItem[]> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) {
    throw new Error("Speaker dinner storage is not configured");
  }

  const { results } = await env.INTERESTS.prepare(
    `SELECT
      speaker_id,
      token_hash,
      response_ciphertext,
      response_iv,
      consent_text,
      created_at,
      expires_at,
      responded_at,
      updated_at
    FROM speaker_dinner_responses
    ORDER BY speaker_id ASC`,
  ).all<SpeakerDinnerRow>();
  const rowBySpeakerId = new Map(results.map((row) => [row.speaker_id, row]));
  const canonicalRecords = await readCanonicalSpeakers(env);

  return Promise.all(
    canonicalRecords.map(async (speaker) => {
      const row = rowBySpeakerId.get(speaker.speakerId);

      return {
        expires_at: row?.expires_at ?? null,
        invited: Boolean(row),
        name: speaker.content.profile.name,
        responded_at: row?.responded_at ?? null,
        response: row ? await decryptSpeakerDinnerResponse(row, env) : null,
        speaker_id: speaker.speakerId,
        updated_at: row?.updated_at ?? null,
      };
    }),
  );
}

export async function readSpeakerDinnerSharedAdminItems(
  env: Env,
): Promise<SpeakerDinnerSharedAdminItem[]> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) {
    throw new Error("Speaker dinner storage is not configured");
  }

  const { results } = await env.INTERESTS.prepare(
    `SELECT
      response_id,
      name_ciphertext,
      name_iv,
      response_ciphertext,
      response_iv,
      consent_text,
      created_at,
      responded_at,
      updated_at
    FROM speaker_dinner_shared_responses
    ORDER BY responded_at ASC, response_id ASC`,
  ).all<SpeakerDinnerSharedResponseRow>();
  const encryptionKey = await importAesKey(env.EMAIL_ENCRYPTION_KEY);

  return Promise.all(
    results.map((row) =>
      decryptSpeakerDinnerSharedResponse(row, encryptionKey),
    ),
  );
}

async function readSpeakerDinnerSharedResponse(
  env: Env,
  responseId: string,
): Promise<SpeakerDinnerSharedAdminItem | null> {
  const row = await env.INTERESTS.prepare(
    `SELECT
      response_id,
      name_ciphertext,
      name_iv,
      response_ciphertext,
      response_iv,
      consent_text,
      created_at,
      responded_at,
      updated_at
    FROM speaker_dinner_shared_responses
    WHERE response_id = ?`,
  )
    .bind(responseId)
    .first<SpeakerDinnerSharedResponseRow>();

  if (!row) return null;

  const encryptionKey = await importAesKey(env.EMAIL_ENCRYPTION_KEY);

  return decryptSpeakerDinnerSharedResponse(row, encryptionKey);
}

async function decryptSpeakerDinnerSharedResponse(
  row: SpeakerDinnerSharedResponseRow,
  encryptionKey: CryptoKey,
): Promise<SpeakerDinnerSharedAdminItem> {
  const [name, responseJson] = await Promise.all([
    decryptTextWithKey(row.name_ciphertext, row.name_iv, encryptionKey),
    decryptTextWithKey(row.response_ciphertext, row.response_iv, encryptionKey),
  ]);
  const candidate: unknown = JSON.parse(responseJson);

  if (!isSpeakerDinnerResponseData(candidate)) {
    throw new Error("Encrypted shared dinner response is invalid");
  }

  return {
    name,
    responded_at: row.responded_at,
    response: candidate,
    updated_at: row.updated_at,
  };
}

async function decryptSpeakerDinnerResponse(
  row: SpeakerDinnerRow,
  env: Env,
): Promise<SpeakerDinnerResponseData | null> {
  if (row.response_ciphertext === null && row.response_iv === null) return null;

  if (row.response_ciphertext === null || row.response_iv === null) {
    throw new Error("Encrypted speaker dinner response is incomplete");
  }

  const plaintext = await decryptText(
    row.response_ciphertext,
    row.response_iv,
    env.EMAIL_ENCRYPTION_KEY,
  );
  const candidate: unknown = JSON.parse(plaintext);

  if (!isSpeakerDinnerResponseData(candidate)) {
    throw new Error("Encrypted speaker dinner response is invalid");
  }

  return candidate;
}

function isSpeakerDinnerResponseData(
  candidate: unknown,
): candidate is SpeakerDinnerResponseData {
  if (typeof candidate !== "object" || candidate === null) return false;

  const response = candidate as Record<string, unknown>;
  const attendance = response.attendance;
  const mealPreference = response.meal_preference;
  const foodRequirements = response.food_requirements;
  const crossContamination = response.cross_contamination;

  return (
    (attendance === "attending" || attendance === "not_attending") &&
    typeof foodRequirements === "string" &&
    foodRequirements.length <= 800 &&
    typeof mealPreference === "string" &&
    (mealPreference === "" || isSpeakerDinnerMealPreference(mealPreference)) &&
    typeof crossContamination === "string" &&
    (crossContamination === "" ||
      isSpeakerDinnerCrossContamination(crossContamination))
  );
}

function isSpeakerDinnerMealPreference(
  value: string,
): value is Exclude<SpeakerDinnerMealPreference, ""> {
  return ["omnivore", "vegetarian", "vegan", "other"].includes(value);
}

function isSpeakerDinnerCrossContamination(
  value: string,
): value is Exclude<SpeakerDinnerCrossContamination, ""> {
  return ["yes", "no", "unsure"].includes(value);
}

function parseSpeakerDinnerBearerToken(
  authorization: string | null,
): string | null {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);

  return match?.[1] ?? null;
}

function generateSpeakerDinnerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return base64Encode(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function hashSpeakerDinnerToken(
  token: string,
  keyMaterial: string,
): Promise<string> {
  return hashText(token, keyMaterial, "speaker-dinner-invite-token");
}

async function hashSpeakerDinnerSharedToken(
  token: string,
  keyMaterial: string,
): Promise<string> {
  return hashText(token, keyMaterial, "speaker-dinner-shared-invite-token");
}

function parseSpeakerDinnerResponseId(value: string | null): string | null {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    return null;
  }

  return value.toLowerCase();
}

function getSpeakerDinnerConfiguration(
  env: Env,
): { deadline: number; retention: number } | null {
  const deadline = Date.parse(env.SPEAKER_DINNER_RESPONSE_DEADLINE ?? "");
  const retention = Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL ?? "");

  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(retention) ||
    retention <= deadline
  ) {
    return null;
  }

  return { deadline, retention };
}

function getSpeakerDinnerConfigurationError(env: Env): Response | null {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Dinner storage is not configured." }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured." }, 503);
  }

  if (!getSpeakerDinnerConfiguration(env)) {
    return jsonResponse(
      { error: "The speaker dinner response period is not configured." },
      503,
    );
  }

  return null;
}

function speakerDinnerInvitationError(): Response {
  return jsonResponse(
    { error: "This invitation link is invalid or has expired." },
    404,
  );
}

export function shouldPurgeSpeakerDinnerData(env: Env): boolean {
  const configuration = getSpeakerDinnerConfiguration(env);

  return Boolean(
    env.INTERESTS && configuration && Date.now() > configuration.retention,
  );
}

export async function purgeSpeakerDinnerData(env: Env): Promise<void> {
  await deleteSpeakerDinnerData(env);
}

function deleteSpeakerDinnerData(env: Env) {
  return env.INTERESTS.batch([
    env.INTERESTS.prepare("DELETE FROM speaker_dinner_shared_responses"),
    env.INTERESTS.prepare("DELETE FROM speaker_dinner_shared_invites"),
    env.INTERESTS.prepare("DELETE FROM speaker_dinner_responses"),
  ]);
}

export function isSpeakerDinnerPath(pathname: string): boolean {
  return (
    pathname === "/speaker-dinner" ||
    pathname.startsWith("/speaker-dinner/") ||
    pathname === "/api/speaker-dinner" ||
    pathname === "/api/speaker-dinner/shared"
  );
}

export function formatSpeakerDinnerCsv(
  speakers: SpeakerDinnerAdminItem[],
  sharedResponses: SpeakerDinnerSharedAdminItem[],
): string {
  const rows = [
    [
      "name",
      "invitation",
      "meal_preference",
      "food_requirements",
      "cross_contamination_concern",
    ],
    ...speakers
      .filter((speaker) => speaker.response?.attendance === "attending")
      .map((speaker) => [
        speaker.name,
        "personalized speaker link",
        speaker.response?.meal_preference ?? "",
        speaker.response?.food_requirements ?? "",
        speaker.response?.cross_contamination ?? "",
      ]),
    ...sharedResponses
      .filter((item) => item.response.attendance === "attending")
      .map((item) => [
        item.name,
        "shared link",
        item.response.meal_preference,
        item.response.food_requirements,
        item.response.cross_contamination,
      ]),
  ];

  return `${rows.map((row) => row.map(formatCsvValue).join(",")).join("\n")}\n`;
}
