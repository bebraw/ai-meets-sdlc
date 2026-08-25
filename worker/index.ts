import {
  normalizeHostname,
  validateTurnstileOutcome,
  type TurnstileOutcome,
} from "./turnstile";

type JsonObject = Record<string, unknown>;

interface EncryptedText {
  ciphertext: string;
  iv: string;
}

interface InterestContact {
  created_at: string;
  email: string;
  name: string;
  organization: string;
}

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

interface AdminBindings {
  ADMIN_PASSWORD?: string;
  ADMIN_USERNAME?: string;
}

interface BackupManifest {
  rows_hash?: string;
}

const posterProposalTermsText =
  "I understand that, if accepted, the designated presenter must attend the poster session and bring, install, and remove an A0 or A1 portrait poster. I agree that the poster title and abstract may be published in the event program.";
const posterProposalConsentText =
  "I consent to Toska Osuuskunta processing this proposal and contacting me about it as described in the privacy policy.";
const posterSizeCompatibilityValue: PosterSize = "either";
const turnstileAction = "turnstile-spin-v2";
const turnstileTimeoutMilliseconds = 10_000;
const maxInterestBodyBytes = 16 * 1024;
const maxPosterProposalBodyBytes = 32 * 1024;
const posterProposalStatuses = [
  "submitted",
  "shortlisted",
  "accepted",
  "waitlisted",
  "declined",
  "withdrawn",
] as const satisfies readonly PosterProposalStatus[];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isAdminProtected = isAdminPath(url.pathname);

    if (isInternalAdminSlidesPath(url.pathname)) {
      return new Response("Not found.", {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      });
    }

    if (url.pathname === "/admin") {
      return Response.redirect(`${url.origin}/admin/`, 308);
    }

    if (isAdminProtected) {
      const unauthorizedResponse = await requireAdmin(request, env);

      if (unauthorizedResponse) return unauthorizedResponse;
    }

    if (url.pathname === "/admin/slides") {
      return withAdminSecurityHeaders(
        Response.redirect(`${url.origin}/admin/slides/`, 308),
      );
    }

    if (url.pathname === "/api/admin/interests") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const contacts = await readInterestContacts(env);

      return jsonResponse({ contacts, count: contacts.length }, 200, {
        "cache-control": "no-store",
      });
    }

    if (url.pathname === "/api/admin/interests.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const contacts = await readInterestContacts(env);

      return new Response(formatContactsCsv(contacts), {
        headers: {
          "cache-control": "no-store",
          "content-disposition": 'attachment; filename="sdlcai-interests.csv"',
          "content-type": "text/csv; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/admin/poster-proposals") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const proposals = await readPosterProposals(env);

      return jsonResponse({ proposals, count: proposals.length }, 200, {
        "cache-control": "no-store",
      });
    }

    if (url.pathname === "/api/admin/poster-proposals.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const proposals = await readPosterProposals(env);

      return new Response(formatPosterProposalsCsv(proposals), {
        headers: {
          "cache-control": "no-store",
          "content-disposition":
            'attachment; filename="sdlcai-poster-proposals.csv"',
          "content-type": "text/csv; charset=utf-8",
        },
      });
    }

    if (url.pathname === "/api/admin/poster-proposals/status") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "update-poster-status",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return handlePosterProposalStatus(request, env);
    }

    if (url.pathname === "/api/interest") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handleInterest(request, env);
    }

    if (url.pathname === "/api/poster-proposals") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return handlePosterProposal(request, env);
    }

    if (url.pathname === "/calendar.ics") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      return calendarResponse();
    }

    const assetRequest = getAssetRequest(request, url);
    let response = await env.ASSETS.fetch(assetRequest);

    if (response.status === 404 && acceptsHtml(request)) {
      response = await serveNotFound(request, env, response);
    } else if (response.headers.get("content-type")?.includes("text/html")) {
      response = await injectRuntimeConfig(response, env);
    }

    if (isAdminProtected) return withAdminSecurityHeaders(response);

    return withStaticAssetCache(response, url);
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (!env.INTEREST_BACKUPS) return;

    ctx.waitUntil(backupInterests(env));
    ctx.waitUntil(backupPosterProposals(env));
  },
} satisfies ExportedHandler<Env>;

const immutableAssetCacheControl = "public, max-age=31536000, immutable";

function withStaticAssetCache(response: Response, url: URL): Response {
  if (response.status !== 200 || !isImmutableAssetPath(url.pathname)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("cache-control", immutableAssetCacheControl);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function withAdminSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  const vary = headers.get("vary");
  const variesByAuthorization = vary
    ?.split(",")
    .some((value) => value.trim().toLowerCase() === "authorization");

  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");

  if (!variesByAuthorization) {
    headers.append("vary", "Authorization");
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isImmutableAssetPath(pathname: string): boolean {
  return /^\/tailwind-[a-z0-9]+\.css$/.test(pathname);
}

function getAssetRequest(request: Request, url: URL): Request {
  if (url.pathname !== "/admin/slides/") return request;

  const assetUrl = new URL(url);
  assetUrl.pathname = "/admin-slides/";

  return new Request(assetUrl, request);
}

function isInternalAdminSlidesPath(pathname: string): boolean {
  return pathname === "/admin-slides" || pathname.startsWith("/admin-slides/");
}

async function handleInterest(request: Request, env: Env): Promise<Response> {
  if (!env.INTERESTS) {
    return jsonResponse({ error: "Interest storage is not configured" }, 503);
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Encryption is not configured" }, 503);
  }

  const formDataResult = await readFormDataWithinLimit(
    request,
    maxInterestBodyBytes,
  );

  if (formDataResult instanceof Response) return formDataResult;

  const formData = formDataResult;
  const email = normalizeEmail(formData.get("email"));
  const name = normalizeOptionalText(formData.get("name"), 120);
  const organization = normalizeOptionalText(formData.get("organization"), 160);
  const consent = formData.get("consent") === "yes";
  const turnstileToken = getTurnstileToken(formData);

  if (!email || !isLikelyEmail(email)) {
    return jsonResponse({ error: "Enter a valid email address" }, 400);
  }

  if (!consent) {
    return jsonResponse({ error: "Consent is required" }, 400);
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
      });

      return jsonResponse({ error: "Verification failed" }, 400);
    }
  }

  const keyMaterial = env.EMAIL_ENCRYPTION_KEY;
  const emailHash = await hashEmail(email, keyMaterial);
  const encryptedEmail = await encryptText(email, keyMaterial);
  const encryptedName = name ? await encryptText(name, keyMaterial) : null;
  const encryptedOrganization = organization
    ? await encryptText(organization, keyMaterial)
    : null;
  const consentText =
    "I agree to be contacted about SDLCAI seminar registration.";
  const createdAt = new Date().toISOString();

  try {
    await env.INTERESTS.prepare(
      `INSERT INTO interests (
        email_hash,
        email_ciphertext,
        email_iv,
        name_ciphertext,
        name_iv,
        organization_ciphertext,
        organization_iv,
        consent_text,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        emailHash,
        encryptedEmail.ciphertext,
        encryptedEmail.iv,
        encryptedName?.ciphertext ?? null,
        encryptedName?.iv ?? null,
        encryptedOrganization?.ciphertext ?? null,
        encryptedOrganization?.iv ?? null,
        consentText,
        createdAt,
      )
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return jsonResponse({
        ok: true,
        duplicate: true,
        message: "You are already on the interest list.",
      });
    }

    throw error;
  }

  return jsonResponse({
    ok: true,
    message: "Thanks. We will notify you when registration opens.",
  });
}

async function handlePosterProposal(
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

function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin/" ||
    pathname.startsWith("/admin/") ||
    pathname.startsWith("/api/admin/") ||
    pathname === "/assets/slides" ||
    pathname.startsWith("/assets/slides/")
  );
}

function acceptsHtml(request: Request): boolean {
  if (!["GET", "HEAD"].includes(request.method)) return false;

  const accept = request.headers.get("accept") ?? "";

  return accept.includes("text/html");
}

async function serveNotFound(
  request: Request,
  env: Env,
  originalResponse: Response,
): Promise<Response> {
  const url = new URL(request.url);
  const notFoundUrl = new URL("/404/", url.origin);
  const notFoundResponse = await env.ASSETS.fetch(
    new Request(notFoundUrl, request),
  );

  if (!notFoundResponse.headers.get("content-type")?.includes("text/html")) {
    return originalResponse;
  }

  return injectRuntimeConfig(notFoundResponse, env, 404);
}

async function requireAdmin(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const adminEnv = env as Env & AdminBindings;

  if (!adminEnv.ADMIN_USERNAME || !adminEnv.ADMIN_PASSWORD) {
    return new Response("Admin auth is not configured.", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        vary: "Authorization",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  }

  const credentials = parseBasicAuth(request.headers.get("authorization"));
  const isAuthorized =
    credentials &&
    (await timingSafeEqual(credentials.username, adminEnv.ADMIN_USERNAME)) &&
    (await timingSafeEqual(credentials.password, adminEnv.ADMIN_PASSWORD));

  if (isAuthorized) return null;

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      vary: "Authorization",
      "www-authenticate": 'Basic realm="SDLCAI Admin", charset="UTF-8"',
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

function requireAdminAction(
  request: Request,
  expectedAction: string,
): Response | null {
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  const action = request.headers.get("x-admin-action");

  if (origin === requestOrigin && action === expectedAction) return null;

  return jsonResponse({ error: "Admin action could not be verified." }, 403, {
    "cache-control": "no-store",
  });
}

async function handlePosterProposalStatus(
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

function parseBasicAuth(
  authorization: string | null,
): { password: string; username: string } | null {
  if (!authorization?.startsWith("Basic ")) return null;

  try {
    const decoded = atob(authorization.slice("Basic ".length));
    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [aHash, bHash] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);

  if (aHash.byteLength !== bHash.byteLength) return false;

  let difference = 0;

  for (let index = 0; index < aHash.byteLength; index++) {
    difference |= aHash[index]! ^ bHash[index]!;
  }

  return difference === 0;
}

async function readInterestContacts(env: Env): Promise<InterestContact[]> {
  if (!env.INTERESTS) {
    throw new Error("Interest storage is not configured");
  }

  if (!env.EMAIL_ENCRYPTION_KEY) {
    throw new Error("Encryption is not configured");
  }

  const { results } = await env.INTERESTS.prepare(
    `SELECT
      email_ciphertext,
      email_iv,
      name_ciphertext,
      name_iv,
      organization_ciphertext,
      organization_iv,
      created_at
    FROM interests
    ORDER BY created_at ASC`,
  ).all();
  const rows = results ?? [];

  return Promise.all(
    rows.map((row) => decryptInterestContact(row, env.EMAIL_ENCRYPTION_KEY)),
  );
}

async function readPosterProposals(env: Env): Promise<PosterProposal[]> {
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

async function decryptInterestContact(
  row: Record<string, unknown>,
  keyMaterial: string,
): Promise<InterestContact> {
  return {
    email: await decryptText(
      assertString(row.email_ciphertext),
      assertString(row.email_iv),
      keyMaterial,
    ),
    name:
      typeof row.name_ciphertext === "string" && typeof row.name_iv === "string"
        ? await decryptText(row.name_ciphertext, row.name_iv, keyMaterial)
        : "",
    organization:
      typeof row.organization_ciphertext === "string" &&
      typeof row.organization_iv === "string"
        ? await decryptText(
            row.organization_ciphertext,
            row.organization_iv,
            keyMaterial,
          )
        : "",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function assertString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected encrypted interest field to be a string");
  }

  return value;
}

function formatContactsCsv(contacts: InterestContact[]): string {
  const rows = [
    ["email", "name", "organization", "created_at"],
    ...contacts.map((contact) => [
      contact.email,
      contact.name,
      contact.organization,
      contact.created_at,
    ]),
  ];

  return `${rows.map((row) => row.map(formatCsvValue).join(",")).join("\n")}\n`;
}

function formatPosterProposalsCsv(proposals: PosterProposal[]): string {
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

function formatCsvValue(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@\t\r]/u.test(value)
    ? `'${value}`
    : value;

  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
}

async function verifyTurnstile({
  expectedAction,
  expectedHostnames,
  request,
  secret,
  token,
}: {
  expectedAction: string;
  expectedHostnames: ReadonlySet<string>;
  request: Request;
  secret: string;
  token: string;
}): Promise<TurnstileOutcome> {
  if (!token) {
    return { success: false, "error-codes": ["missing-input-response"] };
  }

  if (token.length > 2048) {
    return { success: false, "error-codes": ["invalid-input-response"] };
  }

  const payload = new FormData();
  payload.append("secret", secret);
  payload.append("response", token);

  const ip = request.headers.get("CF-Connecting-IP");

  if (ip) {
    payload.append("remoteip", ip);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: payload,
        signal: AbortSignal.timeout(turnstileTimeoutMilliseconds),
      },
    );

    if (!response.ok) {
      return { success: false, "error-codes": ["siteverify-unavailable"] };
    }

    const candidate: unknown = await response.json();

    return validateTurnstileOutcome(
      candidate,
      expectedAction,
      expectedHostnames,
    );
  } catch {
    return { success: false, "error-codes": ["siteverify-unavailable"] };
  }
}

async function backupInterests(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM interests ORDER BY created_at ASC",
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      rows,
    },
    null,
    2,
  );
  const key = `interests/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "interests/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        row_count: rows.length,
        rows_hash: rowsHash,
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );
}

async function backupPosterProposals(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT * FROM poster_proposals ORDER BY created_at ASC, id ASC",
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestPosterProposalBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify(
    {
      exported_at: exportedAt,
      rows,
    },
    null,
    2,
  );
  const key = `poster-proposals/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "poster-proposals/latest.json",
    JSON.stringify(
      {
        key,
        exported_at: exportedAt,
        row_count: rows.length,
        rows_hash: rowsHash,
      },
      null,
      2,
    ),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { rows_hash: rowsHash },
    },
  );
}

async function getLatestBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get("interests/latest.json");

  if (!latestBackup) return null;

  if (latestBackup.customMetadata?.rows_hash) {
    return { rows_hash: latestBackup.customMetadata.rows_hash };
  }

  try {
    const manifest = await latestBackup.json();

    return isBackupManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

async function getLatestPosterProposalBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get(
    "poster-proposals/latest.json",
  );

  if (!latestBackup) return null;

  if (latestBackup.customMetadata?.rows_hash) {
    return { rows_hash: latestBackup.customMetadata.rows_hash };
  }

  try {
    const manifest = await latestBackup.json();

    return isBackupManifest(manifest) ? manifest : null;
  } catch {
    return null;
  }
}

function isBackupManifest(value: unknown): value is BackupManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    (!("rows_hash" in value) || typeof value.rows_hash === "string")
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await sha256Bytes(value);

  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return new Uint8Array(digest);
}

async function injectRuntimeConfig(
  response: Response,
  env: Env,
  status = response.status,
): Promise<Response> {
  const html = await response.text();
  const showInterestForm = env.SHOW_INTEREST_FORM === "true";

  return new Response(
    html
      .replaceAll("__TURNSTILE_SITE_KEY__", env.TURNSTILE_SITE_KEY ?? "")
      .replaceAll(
        "data-interest-section hidden",
        showInterestForm
          ? "data-interest-section"
          : "data-interest-section hidden",
      ),
    {
      headers: response.headers,
      status,
      statusText:
        status === response.status ? response.statusText : "Not Found",
    },
  );
}

async function encryptText(
  value: string,
  keyMaterial: string,
): Promise<EncryptedText> {
  const key = await importAesKey(keyMaterial);

  return encryptTextWithKey(value, key);
}

async function encryptTextWithKey(
  value: string,
  key: CryptoKey,
): Promise<EncryptedText> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  );

  return {
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
    iv: base64Encode(iv),
  };
}

async function decryptText(
  ciphertext: string,
  iv: string,
  keyMaterial: string,
): Promise<string> {
  const key = await importAesKey(keyMaterial);

  return decryptTextWithKey(ciphertext, iv, key);
}

async function decryptTextWithKey(
  ciphertext: string,
  iv: string,
  key: CryptoKey,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64Decode(iv) },
    key,
    base64Decode(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

async function decryptOptionalTextWithKey(
  ciphertext: string | null,
  iv: string | null,
  key: CryptoKey,
): Promise<string> {
  if (ciphertext === null && iv === null) return "";

  if (ciphertext === null || iv === null) {
    throw new Error("Encrypted poster proposal field is incomplete");
  }

  return decryptTextWithKey(ciphertext, iv, key);
}

async function hashEmail(email: string, keyMaterial: string): Promise<string> {
  return hashText(email, keyMaterial, "email-hash");
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

async function hashText(
  value: string,
  keyMaterial: string,
  purpose: string,
): Promise<string> {
  const key = await importHmacKey(keyMaterial, purpose);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );

  return base64Encode(new Uint8Array(signature));
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, "email-encryption");

  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

async function importHmacKey(
  keyMaterial: string,
  purpose: string,
): Promise<CryptoKey> {
  const bytes = await deriveBytes(keyMaterial, purpose);

  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function deriveBytes(
  secret: string,
  purpose: string,
): Promise<ArrayBuffer> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${secret}`),
  );

  return digest;
}

async function readFormDataWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<FormData | Response> {
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader !== null) {
    if (!/^\d+$/u.test(contentLengthHeader)) {
      return jsonResponse({ error: "Submit the form again." }, 400);
    }

    if (Number(contentLengthHeader) > maxBytes) {
      return jsonResponse({ error: "Submission is too large." }, 413);
    }
  }

  const contentType = request.headers.get("content-type") ?? "";
  const normalizedContentType = contentType.toLowerCase();

  if (
    !normalizedContentType.startsWith("multipart/form-data;") &&
    !normalizedContentType.startsWith("application/x-www-form-urlencoded")
  ) {
    return jsonResponse({ error: "Submit the form again." }, 415);
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (request.body) {
    const reader = request.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        totalBytes += value.byteLength;

        if (totalBytes > maxBytes) {
          await reader.cancel();

          return jsonResponse({ error: "Submission is too large." }, 413);
        }

        chunks.push(value);
      }
    } catch {
      return jsonResponse({ error: "Submit the form again." }, 400);
    } finally {
      reader.releaseLock();
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const boundedRequest = new Request(request.url, {
      body,
      headers: { "content-type": contentType },
      method: "POST",
    });

    return await boundedRequest.formData();
  } catch {
    return jsonResponse({ error: "Submit the form again." }, 400);
  }
}

function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeFormText(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(
  value: FormDataEntryValue | null,
  maxLength: number,
): string {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, maxLength);
}

function getTurnstileToken(formData: FormData): string {
  const values = formData
    .getAll("cf-turnstile-response")
    .map((value) => normalizeOptionalText(value, 2048))
    .filter(Boolean);

  return values.at(-1) ?? "";
}

function hasConfiguredTurnstileSiteKey(env: Env): boolean {
  return Boolean(
    env.TURNSTILE_SITE_KEY?.trim() &&
    env.TURNSTILE_SITE_KEY !== "__TURNSTILE_SITE_KEY__",
  );
}

function getExpectedTurnstileHostnames(env: Env): Set<string> {
  return new Set(
    (env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map(normalizeHostname)
      .filter(Boolean),
  );
}

function getTurnstileConfigurationError(env: Env): Response | null {
  const hasSiteKey = hasConfiguredTurnstileSiteKey(env);
  const hasSecretKey = Boolean(env.TURNSTILE_SECRET_KEY?.trim());

  if (hasSiteKey !== hasSecretKey) {
    return jsonResponse({ error: "Verification is not configured" }, 503);
  }

  if (hasSecretKey && getExpectedTurnstileHostnames(env).size === 0) {
    return jsonResponse({ error: "Verification is not configured" }, 503);
  }

  return null;
}

function parsePosterProposalDeadline(value: string | undefined): number | null {
  if (!value?.trim()) return null;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function isPosterProposalStatus(value: string): value is PosterProposalStatus {
  return posterProposalStatuses.some((status) => status === value);
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function jsonResponse(
  payload: JsonObject,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function calendarResponse(): Response {
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SDLCAI//Seminar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:SDLCAI",
    "BEGIN:VEVENT",
    "UID:20261013@sdlcai.org",
    "DTSTAMP:20260618T000000Z",
    "DTSTART:20261013T050000Z",
    "DTEND:20261013T180000Z",
    "SUMMARY:SDLCAI: AI Meets SDLC",
    "DESCRIPTION:A one-day seminar on AI across the software development lifecycle.",
    "LOCATION:Marsio Saastamoinen Foundation Stage, Aalto University, Espoo, Finland",
    "URL:https://sdlcai.org/",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(`${calendar}\r\n`, {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-disposition": 'attachment; filename="sdlcai.ics"',
      "content-type": "text/calendar; charset=utf-8",
    },
  });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
