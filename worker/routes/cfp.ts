import { isCfpEnabled } from "../domain/feature-flags";
import { encryptText, hashEmail } from "../utils/crypto";
import {
  isLikelyEmail,
  normalizeCfpFormat,
  normalizeEmail,
  normalizeOptionalText,
} from "../utils/normalize";
import { jsonResponse } from "../utils/response";

export async function handleCfpProposal(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await isCfpEnabled(env))) {
    return jsonResponse({ error: "Call for proposals is not open" }, 503);
  }

  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "CFP storage is not configured" }, 503);
  }

  const formData = await request.formData();
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeOptionalText(formData.get("name"), 120);
  const organization = normalizeOptionalText(formData.get("organization"), 160);
  const format = normalizeCfpFormat(formData.get("format"));
  const title = normalizeOptionalText(formData.get("title"), 180);
  const summary = normalizeOptionalText(formData.get("summary"), 2400);
  const bio = normalizeOptionalText(formData.get("bio"), 1200);
  const consent = formData.get("consent") === "yes";

  if (!email || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (!name) {
    return jsonResponse({ error: "Enter the presenter name" }, 400);
  }

  if (!format) {
    return jsonResponse({ error: "Choose poster or 15 minute pitch" }, 400);
  }

  if (!title) {
    return jsonResponse({ error: "Enter a proposal title" }, 400);
  }

  if (!summary || summary.length < 80) {
    return jsonResponse(
      { error: "Enter a proposal summary of at least 80 characters" },
      400,
    );
  }

  if (!consent) {
    return jsonResponse({ error: "Consent is required" }, 400);
  }

  const keyMaterial = env.EMAIL_ENCRYPTION_KEY;
  const emailHash = await hashEmail(email, keyMaterial);
  const encryptedEmail = await encryptText(email, keyMaterial);
  const encryptedName = await encryptText(name, keyMaterial);
  const encryptedOrganization = organization
    ? await encryptText(organization, keyMaterial)
    : null;
  const encryptedTitle = await encryptText(title, keyMaterial);
  const encryptedSummary = await encryptText(summary, keyMaterial);
  const encryptedBio = bio ? await encryptText(bio, keyMaterial) : null;
  const createdAt = new Date().toISOString();
  const consentText =
    "I understand CFP acceptance covers only the event participation ticket.";

  await env.INTERESTS.prepare(
    `INSERT INTO cfp_proposals (
      format,
      email_hash,
      email_ciphertext,
      email_iv,
      name_ciphertext,
      name_iv,
      organization_ciphertext,
      organization_iv,
      title_ciphertext,
      title_iv,
      summary_ciphertext,
      summary_iv,
      bio_ciphertext,
      bio_iv,
      consent_text,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      format,
      emailHash,
      encryptedEmail.ciphertext,
      encryptedEmail.iv,
      encryptedName.ciphertext,
      encryptedName.iv,
      encryptedOrganization?.ciphertext ?? null,
      encryptedOrganization?.iv ?? null,
      encryptedTitle.ciphertext,
      encryptedTitle.iv,
      encryptedSummary.ciphertext,
      encryptedSummary.iv,
      encryptedBio?.ciphertext ?? null,
      encryptedBio?.iv ?? null,
      consentText,
      createdAt,
    )
    .run();

  return jsonResponse({
    ok: true,
    message: "Proposal received. We will review it after the CFP closes.",
  });
}
