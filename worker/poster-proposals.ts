import {
  jsonResponse,
  readFormDataWithinLimit,
  normalizeFormText,
  normalizeEmail,
  getTurnstileToken,
  isLikelyEmail,
  getTurnstileConfigurationError,
  turnstileAction,
  getExpectedTurnstileHostnames,
  importAesKey,
  encryptTextWithKey,
  decryptTextWithKey,
  decryptOptionalTextWithKey,
  formatCsvValue,
  hashText,
} from "./form-utils.ts";
import { verifyTurnstile } from "./turnstile.ts";

type PosterSize = "a0" | "a1" | "either";

type PosterProposalStatus =
  | "submitted"
  | "shortlisted"
  | "accepted"
  | "waitlisted"
  | "declined"
  | "withdrawn";

interface PosterProposal {
  abstract: string;
  authors: string;
  consent_text: string;
  created_at: string;
  email: string;
  id: number;
  name: string;
  organization: string;
  poster_size: PosterSize;
  reviewed_at: string | null;
  setup_notes: string;
  status: PosterProposalStatus;
  supporting_url: string;
  terms_text: string;
  title: string;
  updated_at: string;
}

interface PosterProposalRow {
  abstract_ciphertext: string;
  abstract_iv: string;
  authors_ciphertext: string;
  authors_iv: string;
  consent_text: string;
  created_at: string;
  email_ciphertext: string;
  email_iv: string;
  id: number;
  name_ciphertext: string;
  name_iv: string;
  organization_ciphertext: string | null;
  organization_iv: string | null;
  poster_size: PosterSize;
  reviewed_at: string | null;
  setup_notes_ciphertext: string | null;
  setup_notes_iv: string | null;
  status: PosterProposalStatus;
  supporting_url_ciphertext: string | null;
  supporting_url_iv: string | null;
  terms_text: string;
  title_ciphertext: string;
  title_iv: string;
  updated_at: string;
}

const posterProposalTermsText =
  "I understand that, if accepted, the designated presenter must attend the poster session and bring, install, and remove an A0 or A1 portrait poster. I agree that the poster title and abstract may be published in the event program.";

const posterProposalConsentText =
  "I consent to Toska Osuuskunta processing this proposal and contacting me about it as described in the privacy policy.";

const posterSizeCompatibilityValue: PosterSize = "either";

const maxPosterProposalBodyBytes = 32 * 1024;

const posterProposalStatuses = [
  "submitted",
  "shortlisted",
  "accepted",
  "waitlisted",
  "declined",
  "withdrawn",
] as const satisfies readonly PosterProposalStatus[];

export async function handlePosterProposal(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Proposal storage is not configured" }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured" }, 503);
  }

  const proposalDeadline = parsePosterProposalDeadline(
    env.POSTER_PROPOSAL_DEADLINE,
  );

  if (proposalDeadline === null) {
    return jsonResponse({ error: "The poster call is not configured." }, 503);
  }

  if (Date.now() > proposalDeadline) {
    return jsonResponse(
      { error: "The call for poster proposals has closed." },
      410,
    );
  }

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxPosterProposalBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  const formData = formDataResult;

  const name = normalizeFormText(formData.get("name"));
  const email = normalizeEmail(formData.get("email"));
  const organization = normalizeFormText(formData.get("organization"));
  const title = normalizeFormText(formData.get("title"));
  const abstract = normalizeFormText(formData.get("abstract"));
  const termsAccepted = formData.get("terms") === "yes";
  const consentGiven = formData.get("consent") === "yes";
  const turnstileToken = getTurnstileToken(formData);

  if (!name) {
    return jsonResponse(
      { error: "Enter the designated presenter's name." },
      400,
    );
  }

  if (name.length > 120) {
    return jsonResponse(
      {
        error:
          "Keep the designated presenter's name to 120 characters or fewer.",
      },
      400,
    );
  }

  if (!email || email.length > 254 || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address." }, 400);
  }

  if (organization.length > 160) {
    return jsonResponse(
      { error: "Keep the organization to 160 characters or fewer." },
      400,
    );
  }

  if (!title || title.length > 200) {
    return jsonResponse(
      { error: "Enter a title using 200 characters or fewer." },
      400,
    );
  }

  if (abstract.length < 80 || abstract.length > 1500) {
    return jsonResponse(
      { error: "Enter an abstract between 80 and 1,500 characters." },
      400,
    );
  }

  if (!termsAccepted) {
    return jsonResponse(
      { error: "Confirm the presenter and publication terms." },
      400,
    );
  }

  if (!consentGiven) {
    return jsonResponse({ error: "Consent is required." }, 400);
  }

  const turnstileConfigurationError = getTurnstileConfigurationError(env);

  if (turnstileConfigurationError) return turnstileConfigurationError;

  if (env.TURNSTILE_SECRET_KEY) {
    const turnstileOutcome = await verifyTurnstile({
      expectedAction: turnstileAction,
      expectedHostnames: getExpectedTurnstileHostnames(env),
      request,
      secret: env.TURNSTILE_SECRET_KEY,
      token: turnstileToken,
    });

    if (!turnstileOutcome.success) {
      console.warn("Turnstile verification failed", {
        errors: turnstileOutcome["error-codes"] ?? [],
        hostname: turnstileOutcome.hostname,
        hasToken: Boolean(turnstileToken),
        form: "poster-proposal",
      });

      return jsonResponse({ error: "Verification failed" }, 400);
    }
  }

  const keyMaterial = env.EMAIL_ENCRYPTION_KEY;
  const [fingerprint, encryptionKey] = await Promise.all([
    hashPosterProposalFingerprint(email, title, keyMaterial),
    importAesKey(keyMaterial),
  ]);
  const [
    encryptedName,
    encryptedEmail,
    encryptedOrganization,
    encryptedLegacyAuthors,
    encryptedTitle,
    encryptedAbstract,
  ] = await Promise.all([
    encryptTextWithKey(name, encryptionKey),
    encryptTextWithKey(email, encryptionKey),
    organization
      ? encryptTextWithKey(organization, encryptionKey)
      : Promise.resolve(null),
    // The deployed schema requires this pair, but new submissions do not
    // collect additional author or presenter names.
    encryptTextWithKey("", encryptionKey),
    encryptTextWithKey(title, encryptionKey),
    encryptTextWithKey(abstract, encryptionKey),
  ]);
  const createdAt = new Date().toISOString();

  try {
    await env.INTERESTS.prepare(
      `INSERT INTO poster_proposals (
        fingerprint,
        name_ciphertext,
        name_iv,
        email_ciphertext,
        email_iv,
        organization_ciphertext,
        organization_iv,
        authors_ciphertext,
        authors_iv,
        title_ciphertext,
        title_iv,
        abstract_ciphertext,
        abstract_iv,
        poster_size,
        supporting_url_ciphertext,
        supporting_url_iv,
        setup_notes_ciphertext,
        setup_notes_iv,
        terms_text,
        consent_text,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        fingerprint,
        encryptedName.ciphertext,
        encryptedName.iv,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        encryptedOrganization?.ciphertext ?? null,
        encryptedOrganization?.iv ?? null,
        encryptedLegacyAuthors.ciphertext,
        encryptedLegacyAuthors.iv,
        encryptedTitle.ciphertext,
        encryptedTitle.iv,
        encryptedAbstract.ciphertext,
        encryptedAbstract.iv,
        // Keep the deployed NOT NULL column populated without collecting a
        // preference that is not used in review or event planning.
        posterSizeCompatibilityValue,
        // These optional pairs remain in the deployed schema for legacy rows.
        // New submissions do not collect or persist either value.
        null,
        null,
        null,
        null,
        posterProposalTermsText,
        posterProposalConsentText,
        "submitted",
        createdAt,
        createdAt,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        message:
          "We already received this poster proposal. No need to submit it again.",
      });
    }

    throw error;
  }

  return jsonResponse(
    {
      ok: true,
      message:
        "Thanks. We received your poster proposal and will review it on a rolling basis.",
    },
    201,
  );
}

export async function handlePosterProposalStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Proposal storage is not configured" }, 503);
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: "Submit a valid status update." }, 400);
  }

  const idValue = normalizeFormText(formData.get("id"));
  const statusValue = normalizeFormText(formData.get("status"));

  if (!/^\d+$/.test(idValue)) {
    return jsonResponse({ error: "Choose a valid proposal." }, 400);
  }

  const id = Number(idValue);

  if (!Number.isSafeInteger(id) || id < 1) {
    return jsonResponse({ error: "Choose a valid proposal." }, 400);
  }

  if (!isPosterProposalStatus(statusValue)) {
    return jsonResponse({ error: "Choose a valid proposal status." }, 400);
  }

  const proposal = await readPosterProposalById(env, id);

  if (!proposal) {
    return jsonResponse({ error: "Poster proposal not found." }, 404);
  }

  const updatedAt = new Date().toISOString();
  const reviewedAt = statusValue === "submitted" ? null : updatedAt;
  const result = await env.INTERESTS.prepare(
    `UPDATE poster_proposals
    SET status = ?, updated_at = ?, reviewed_at = ?
    WHERE id = ?`,
  )
    .bind(statusValue, updatedAt, reviewedAt, id)
    .run();

  if (result.meta.changes === 0) {
    return jsonResponse({ error: "Poster proposal not found." }, 404);
  }

  return jsonResponse(
    {
      ok: true,
      proposal: {
        ...proposal,
        reviewed_at: reviewedAt,
        status: statusValue,
        updated_at: updatedAt,
      },
    },
    200,
    { "cache-control": "no-store" },
  );
}

export async function readPosterProposals(env: Env): Promise<PosterProposal[]> {
  if (!env.INTERESTS) {
    throw new Error("Proposal storage is not configured");
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    throw new Error("Encryption is not configured");
  }

  const { results } = await env.INTERESTS.prepare(
    `SELECT
      id,
      name_ciphertext,
      name_iv,
      email_ciphertext,
      email_iv,
      organization_ciphertext,
      organization_iv,
      authors_ciphertext,
      authors_iv,
      title_ciphertext,
      title_iv,
      abstract_ciphertext,
      abstract_iv,
      poster_size,
      supporting_url_ciphertext,
      supporting_url_iv,
      setup_notes_ciphertext,
      setup_notes_iv,
      terms_text,
      consent_text,
      status,
      created_at,
      updated_at,
      reviewed_at
    FROM poster_proposals
    ORDER BY created_at ASC, id ASC`,
  ).all<PosterProposalRow>();
  const encryptionKey = await importAesKey(env.EMAIL_ENCRYPTION_KEY);

  return Promise.all(
    results.map((row) => decryptPosterProposal(row, encryptionKey)),
  );
}

async function readPosterProposalById(
  env: Env,
  id: number,
): Promise<PosterProposal | null> {
  if (!env.EMAIL_ENCRYPTION_KEY) {
    throw new Error("Encryption is not configured");
  }

  const row = await env.INTERESTS.prepare(
    `SELECT
      id,
      name_ciphertext,
      name_iv,
      email_ciphertext,
      email_iv,
      organization_ciphertext,
      organization_iv,
      authors_ciphertext,
      authors_iv,
      title_ciphertext,
      title_iv,
      abstract_ciphertext,
      abstract_iv,
      poster_size,
      supporting_url_ciphertext,
      supporting_url_iv,
      setup_notes_ciphertext,
      setup_notes_iv,
      terms_text,
      consent_text,
      status,
      created_at,
      updated_at,
      reviewed_at
    FROM poster_proposals
    WHERE id = ?`,
  )
    .bind(id)
    .first<PosterProposalRow>();

  if (!row) return null;

  const encryptionKey = await importAesKey(env.EMAIL_ENCRYPTION_KEY);

  return decryptPosterProposal(row, encryptionKey);
}

async function decryptPosterProposal(
  row: PosterProposalRow,
  key: CryptoKey,
): Promise<PosterProposal> {
  const [
    name,
    email,
    organization,
    authors,
    title,
    abstract,
    supportingUrl,
    setupNotes,
  ] = await Promise.all([
    decryptTextWithKey(row.name_ciphertext, row.name_iv, key),
    decryptTextWithKey(row.email_ciphertext, row.email_iv, key),
    decryptOptionalTextWithKey(
      row.organization_ciphertext,
      row.organization_iv,
      key,
    ),
    decryptTextWithKey(row.authors_ciphertext, row.authors_iv, key),
    decryptTextWithKey(row.title_ciphertext, row.title_iv, key),
    decryptTextWithKey(row.abstract_ciphertext, row.abstract_iv, key),
    decryptOptionalTextWithKey(
      row.supporting_url_ciphertext,
      row.supporting_url_iv,
      key,
    ),
    decryptOptionalTextWithKey(
      row.setup_notes_ciphertext,
      row.setup_notes_iv,
      key,
    ),
  ]);

  return {
    id: row.id,
    name,
    email,
    organization,
    authors,
    title,
    abstract,
    poster_size: row.poster_size,
    supporting_url: supportingUrl,
    setup_notes: setupNotes,
    terms_text: row.terms_text,
    consent_text: row.consent_text,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reviewed_at: row.reviewed_at,
  };
}

export function formatPosterProposalsCsv(proposals: PosterProposal[]): string {
  const rows = [
    [
      "id",
      "name",
      "email",
      "organization",
      "authors",
      "title",
      "abstract",
      "poster_size",
      "supporting_url",
      "setup_notes",
      "terms_text",
      "consent_text",
      "status",
      "created_at",
      "updated_at",
      "reviewed_at",
    ],
    ...proposals.map((proposal) => [
      String(proposal.id),
      proposal.name,
      proposal.email,
      proposal.organization,
      proposal.authors,
      proposal.title,
      proposal.abstract,
      proposal.poster_size,
      proposal.supporting_url,
      proposal.setup_notes,
      proposal.terms_text,
      proposal.consent_text,
      proposal.status,
      proposal.created_at,
      proposal.updated_at,
      proposal.reviewed_at ?? "",
    ]),
  ];

  return `${rows.map((row) => row.map(formatCsvValue).join(",")).join("\n")}\n`;
}

async function hashPosterProposalFingerprint(
  email: string,
  title: string,
  keyMaterial: string,
): Promise<string> {
  const normalizedTitle = title
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ");

  return hashText(
    `${email}\n${normalizedTitle}`,
    keyMaterial,
    "poster-proposal-fingerprint",
  );
}

function parsePosterProposalDeadline(value: string | undefined): number | null {
  if (!value?.trim()) return null;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function isPosterProposalStatus(value: string): value is PosterProposalStatus {
  return posterProposalStatuses.some((status) => status === value);
}
