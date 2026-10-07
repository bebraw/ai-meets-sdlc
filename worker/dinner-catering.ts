import { withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  decryptText,
  encryptText,
  jsonResponse,
  requireAdminAction,
  sha256Hex,
} from "./form-utils.ts";
import { isRecord, readJsonWithinLimit } from "./speaker-workspace-utils.ts";
import {
  readSpeakerDinnerAdminItems,
  readSpeakerDinnerSharedAdminItems,
} from "./speaker-dinner.ts";
import {
  parseDietReviews,
  type DietReview,
} from "../site/scripts/attendee-diet-reviews.ts";
import {
  buildDinnerCateringRoster,
  type DinnerCateringData,
  type DinnerCateringResponse,
} from "../site/scripts/dinner-diets.ts";

export async function readDinnerCatering(
  env: Env,
  guests: readonly DinnerCateringResponse[],
): Promise<DinnerCateringData> {
  const row = await env.INTERESTS.prepare(
    "SELECT revision, reviews_ciphertext, reviews_iv FROM speaker_dinner_catering WHERE id = 1",
  ).first<{
    revision: number;
    reviews_ciphertext: string | null;
    reviews_iv: string | null;
  }>();
  if (!row) throw new Error("Missing dinner catering migration");
  const retained = Date.now() < Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL);
  return {
    revision: row.revision,
    version: await sha256Hex(JSON.stringify(guests)),
    reviews:
      retained && row.reviews_ciphertext && row.reviews_iv
        ? parseDietReviews(
            JSON.parse(
              await decryptText(
                row.reviews_ciphertext,
                row.reviews_iv,
                env.EMAIL_ENCRYPTION_KEY,
              ),
            ),
          )
        : [],
  };
}

/** The admin gate in index.ts protects all access to these dietary decisions. */
export async function handleDinnerDietReview(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await saveReview(request, env));
  } catch {
    return withAdminSecurityHeaders(
      jsonResponse(
        {
          error: "Dinner catering is unavailable. Refresh before saving again.",
        },
        503,
      ),
    );
  }
}

async function saveReview(request: Request, env: Env): Promise<Response> {
  if (request.method !== "PUT")
    return jsonResponse({ error: "Method not allowed." }, 405);
  const forbidden = requireAdminAction(request, "review-dinner-diet");
  if (forbidden) return forbidden;
  if (Date.now() >= Date.parse(env.SPEAKER_DINNER_RETENTION_UNTIL))
    return jsonResponse({ error: "Dinner data retention has ended." }, 410);
  const body = await readJsonWithinLimit(request, 32 * 1024);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0 ||
    typeof body.version !== "string"
  )
    return jsonResponse(
      { error: "Refresh dinner responses before saving." },
      400,
    );
  let review: DietReview;
  try {
    const parsed = parseDietReviews([body.review])[0];
    if (!parsed) throw new Error("Missing review");
    review = parsed;
  } catch {
    return jsonResponse(
      { error: "Choose valid dietary categories and catering instructions." },
      400,
    );
  }
  const [speakers, guests] = await Promise.all([
    readSpeakerDinnerAdminItems(env),
    readSpeakerDinnerSharedAdminItems(env),
  ]);
  const responses = [...speakers, ...guests];
  const data = await readDinnerCatering(env, responses);
  if (data.revision !== body.revision || data.version !== body.version)
    return conflict();
  if (
    !buildDinnerCateringRoster(responses).some(
      (person) =>
        person.id === review.personId &&
        person.sourceSignature === review.sourceSignature,
    )
  )
    return conflict();
  const reviews = data.reviews.filter(
    (saved) => saved.personId !== review.personId,
  );
  reviews.push(review);
  const encrypted = await encryptText(
    JSON.stringify(reviews),
    env.EMAIL_ENCRYPTION_KEY,
  );
  const result = await env.INTERESTS.prepare(
    "UPDATE speaker_dinner_catering SET reviews_ciphertext = ?, reviews_iv = ?, revision = revision + 1 WHERE id = 1 AND revision = ?",
  )
    .bind(encrypted.ciphertext, encrypted.iv, data.revision)
    .run();
  return result.meta.changes
    ? jsonResponse({ ...data, reviews, revision: data.revision + 1 })
    : conflict();
}

function conflict(): Response {
  return jsonResponse(
    {
      error:
        "Dinner responses or dietary reviews changed. Refresh and review before saving again.",
    },
    409,
  );
}
