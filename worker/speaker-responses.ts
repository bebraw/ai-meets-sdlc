import {
  getConfigurationError,
  json,
  parseFutureConfigurationDate,
  readJsonWithinLimit,
  maxPresentationBodyBytes,
  encryptPrivateText,
  isRecord,
  parseHttpsUrl,
  decryptPrivateText,
  getSpeakerDinnerConfigurationError,
  getSpeakerDinnerConfiguration,
  speakerDinnerConsentText,
  maxDinnerBodyBytes,
  hashToken,
  createToken,
} from "./speaker-workspace-utils.ts";
import {
  type SpeakerPresentationRow,
  type SpeakerPresentationResponseData,
  type SpeakerDinnerRow,
  type SpeakerDinnerResponseData,
} from "./speaker-workspace-types.ts";

export async function getSpeakerPresentation(
  speakerId: string,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const row = await env
    .INTERESTS!.prepare(
      `SELECT
       speaker_id,
       response_ciphertext,
       response_iv,
       expires_at,
       responded_at,
       updated_at
     FROM speaker_presentation_responses
    WHERE speaker_id = ?1
      AND expires_at > ?2
    LIMIT 1`,
    )
    .bind(speakerId, new Date().toISOString())
    .first<SpeakerPresentationRow>();
  let response: SpeakerPresentationResponseData | null = null;

  if (row) {
    try {
      response = await decryptSpeakerPresentationResponse(row, env);
    } catch {
      console.error(
        JSON.stringify({
          message: "Unable to decrypt speaker presentation response",
          speakerId,
        }),
      );
      return json(
        { error: "Your presentation setup could not be loaded." },
        500,
      );
    }
  }

  return json({
    responded_at: row?.responded_at ?? null,
    response,
  });
}

export async function updateSpeakerPresentation(
  request: Request,
  speakerId: string,
  env: Env,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const retentionUntil = parseFutureConfigurationDate(
    env.SPEAKER_CONTACT_RETENTION_UNTIL,
  );

  if (!retentionUntil) {
    return json(
      { error: "Presentation response storage is not configured." },
      503,
    );
  }

  const body = await readJsonWithinLimit(request, maxPresentationBodyBytes);

  if (body instanceof Response) return body;

  const response = validateSpeakerPresentationResponse(body);

  if (response instanceof Response) return response;

  const encryptedResponse = await encryptPrivateText(
    JSON.stringify(response),
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const respondedAt = new Date().toISOString();

  await env
    .INTERESTS!.prepare(
      `INSERT INTO speaker_presentation_responses (
       speaker_id,
       response_ciphertext,
       response_iv,
       created_at,
       expires_at,
       responded_at,
       updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?4)
     ON CONFLICT (speaker_id) DO UPDATE SET
       response_ciphertext = excluded.response_ciphertext,
       response_iv = excluded.response_iv,
       expires_at = excluded.expires_at,
       responded_at = excluded.responded_at,
       updated_at = excluded.updated_at`,
    )
    .bind(
      speakerId,
      encryptedResponse.ciphertext,
      encryptedResponse.iv,
      respondedAt,
      retentionUntil.toISOString(),
    )
    .run();

  return json({
    message: "Your presentation setup has been saved.",
    responded_at: respondedAt,
    response,
  });
}

function validateSpeakerPresentationResponse(
  value: unknown,
): SpeakerPresentationResponseData | Response {
  if (!isRecord(value)) {
    return json({ error: "Choose how you will present." }, 400);
  }

  if (value.delivery_method === "own_laptop") {
    return {
      delivery_method: "own_laptop",
      material_format: "",
      material_url: "",
    };
  }

  if (value.delivery_method !== "advance_materials") {
    return json({ error: "Choose how you will present." }, 400);
  }

  const materialFormat = value.material_format;

  if (
    materialFormat !== "powerpoint" &&
    materialFormat !== "pdf" &&
    materialFormat !== "web"
  ) {
    return json({ error: "Choose a presentation material format." }, 400);
  }

  if (materialFormat !== "web") {
    return {
      delivery_method: "advance_materials",
      material_format: materialFormat,
      material_url: "",
    };
  }

  const materialUrl =
    typeof value.material_url === "string" ? value.material_url.trim() : "";

  if (materialUrl.length > 2_048) {
    return json({ error: "The web presentation URL is too long." }, 400);
  }

  const parsedUrl = parseHttpsUrl(materialUrl);

  if (!parsedUrl) {
    return json(
      { error: "Enter the complete HTTPS URL for your web presentation." },
      400,
    );
  }

  return {
    delivery_method: "advance_materials",
    material_format: "web",
    material_url: parsedUrl.toString(),
  };
}

export async function decryptSpeakerPresentationResponse(
  row: SpeakerPresentationRow,
  env: Env,
): Promise<SpeakerPresentationResponseData> {
  const plaintext = await decryptPrivateText(
    row.response_ciphertext,
    row.response_iv,
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const candidate: unknown = JSON.parse(plaintext);

  if (!isSpeakerPresentationResponseData(candidate)) {
    throw new Error("Encrypted speaker presentation response is invalid");
  }

  return candidate;
}

function isSpeakerPresentationResponseData(
  candidate: unknown,
): candidate is SpeakerPresentationResponseData {
  if (!isRecord(candidate)) return false;

  if (candidate.delivery_method === "own_laptop") {
    return candidate.material_format === "" && candidate.material_url === "";
  }

  if (candidate.delivery_method !== "advance_materials") return false;

  if (
    candidate.material_format !== "powerpoint" &&
    candidate.material_format !== "pdf" &&
    candidate.material_format !== "web"
  ) {
    return false;
  }

  if (candidate.material_format !== "web") {
    return candidate.material_url === "";
  }

  return (
    typeof candidate.material_url === "string" &&
    candidate.material_url.length <= 2_048 &&
    parseHttpsUrl(candidate.material_url) !== null
  );
}

export async function getSpeakerDinner(
  speakerId: string,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;
  const row = await env
    .INTERESTS!.prepare(
      `SELECT
       speaker_id,
       response_ciphertext,
       response_iv,
       consent_text,
       expires_at,
       responded_at,
       updated_at
     FROM speaker_dinner_responses
    WHERE speaker_id = ?1
    LIMIT 1`,
    )
    .bind(speakerId)
    .first<SpeakerDinnerRow>();
  let response: SpeakerDinnerResponseData | null = null;

  if (row) {
    try {
      response = await decryptSpeakerDinnerResponse(row, env);
    } catch {
      console.error(
        JSON.stringify({
          message: "Unable to decrypt speaker dinner response",
          speakerId,
        }),
      );
      return json({ error: "Your dinner response could not be loaded." }, 500);
    }
  }

  return json({
    closed: Date.now() > configuration.deadline,
    consent_text: speakerDinnerConsentText,
    deadline: new Date(configuration.deadline).toISOString(),
    responded_at: row?.responded_at ?? null,
    response,
  });
}

export async function updateSpeakerDinner(
  request: Request,
  speakerId: string,
  env: Env,
): Promise<Response> {
  const configurationError = getSpeakerDinnerConfigurationError(env);

  if (configurationError) return configurationError;

  const configuration = getSpeakerDinnerConfiguration(env)!;

  if (Date.now() > configuration.deadline) {
    return json(
      { error: "The speaker dinner response deadline has passed." },
      410,
    );
  }

  const body = await readJsonWithinLimit(request, maxDinnerBodyBytes);

  if (body instanceof Response) return body;

  const response = validateSpeakerDinnerResponse(body);

  if (response instanceof Response) return response;

  const encryptedResponse = await encryptPrivateText(
    JSON.stringify(response),
    env.EMAIL_ENCRYPTION_KEY!,
  );
  const hiddenDinnerTokenHash = await hashToken(
    createToken(),
    env.EMAIL_ENCRYPTION_KEY!,
    "speaker-dinner-invite-token",
  );
  const respondedAt = new Date().toISOString();

  await env
    .INTERESTS!.prepare(
      `INSERT INTO speaker_dinner_responses (
       speaker_id,
       token_hash,
       response_ciphertext,
       response_iv,
       consent_text,
       created_at,
       expires_at,
       responded_at,
       updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6, ?6)
     ON CONFLICT (speaker_id) DO UPDATE SET
       response_ciphertext = excluded.response_ciphertext,
       response_iv = excluded.response_iv,
       consent_text = excluded.consent_text,
       expires_at = excluded.expires_at,
       responded_at = excluded.responded_at,
       updated_at = excluded.updated_at`,
    )
    .bind(
      speakerId,
      hiddenDinnerTokenHash,
      encryptedResponse.ciphertext,
      encryptedResponse.iv,
      speakerDinnerConsentText,
      respondedAt,
      new Date(configuration.retention).toISOString(),
    )
    .run();

  return json({
    closed: false,
    consent_text: speakerDinnerConsentText,
    deadline: new Date(configuration.deadline).toISOString(),
    message: "Your dinner response has been saved.",
    responded_at: respondedAt,
    response,
  });
}

function validateSpeakerDinnerResponse(
  value: unknown,
): SpeakerDinnerResponseData | Response {
  if (!isRecord(value) || value.consent !== true) {
    return json({ error: "Consent is required to save dinner details." }, 400);
  }

  if (
    value.attendance !== "attending" &&
    value.attendance !== "not_attending"
  ) {
    return json({ error: "Tell us whether you can attend." }, 400);
  }

  if (value.attendance === "not_attending") {
    return {
      attendance: "not_attending",
      cross_contamination: "",
      food_requirements: "",
      meal_preference: "",
    };
  }

  const mealPreference = value.meal_preference;
  const crossContamination = value.cross_contamination;
  const foodRequirements =
    typeof value.food_requirements === "string"
      ? value.food_requirements.trim()
      : "";

  if (
    mealPreference !== "omnivore" &&
    mealPreference !== "vegetarian" &&
    mealPreference !== "vegan" &&
    mealPreference !== "other"
  ) {
    return json({ error: "Choose a meal preference." }, 400);
  }

  if (
    crossContamination !== "yes" &&
    crossContamination !== "no" &&
    crossContamination !== "unsure"
  ) {
    return json(
      { error: "Tell us whether cross-contamination is a concern." },
      400,
    );
  }

  if (foodRequirements.length > 800) {
    return json(
      { error: "Keep food requirements to 800 characters or fewer." },
      400,
    );
  }

  return {
    attendance: "attending",
    cross_contamination: crossContamination,
    food_requirements: foodRequirements,
    meal_preference: mealPreference,
  };
}

export async function decryptSpeakerDinnerResponse(
  row: SpeakerDinnerRow,
  env: Env,
): Promise<SpeakerDinnerResponseData | null> {
  if (row.response_ciphertext === null && row.response_iv === null) return null;

  if (row.response_ciphertext === null || row.response_iv === null) {
    throw new Error("Encrypted speaker dinner response is incomplete");
  }

  const plaintext = await decryptPrivateText(
    row.response_ciphertext,
    row.response_iv,
    env.EMAIL_ENCRYPTION_KEY!,
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
  if (!isRecord(candidate)) return false;

  const attendance = candidate.attendance;
  const mealPreference = candidate.meal_preference;
  const crossContamination = candidate.cross_contamination;

  return (
    (attendance === "attending" || attendance === "not_attending") &&
    (mealPreference === "" ||
      mealPreference === "omnivore" ||
      mealPreference === "vegetarian" ||
      mealPreference === "vegan" ||
      mealPreference === "other") &&
    (crossContamination === "" ||
      crossContamination === "yes" ||
      crossContamination === "no" ||
      crossContamination === "unsure") &&
    typeof candidate.food_requirements === "string"
  );
}
