import { normalizeHostname, verifyTurnstile } from "./turnstile";
import {
  handleSocialRenderRequest,
  handleSpeakerPromotionManifestRequest,
} from "./social-renderer";
import {
  readCanonicalSpeaker,
  readCanonicalSpeakers,
} from "./canonical-content";
import {
  applyCanonicalContentToResponse,
  isCanonicalPublicHtmlPath,
  serveCanonicalSpeakerPhoto,
} from "./public-content";
import {
  handleSpeakerWorkspaceRequest,
  isSpeakerWorkspacePath,
  purgeExpiredSpeakerWorkspaceData,
  withSpeakerWorkspaceSecurityHeaders,
} from "./speaker-workspace";

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

const posterProposalTermsText =
  "I understand that, if accepted, the designated presenter must attend the poster session and bring, install, and remove an A0 or A1 portrait poster. I agree that the poster title and abstract may be published in the event program.";
const posterProposalConsentText =
  "I consent to Toska Osuuskunta processing this proposal and contacting me about it as described in the privacy policy.";
const speakerDinnerConsentText =
  "I consent to Toska Osuuskunta processing this response and, if I attend, sharing only the necessary food information with the dinner caterer. I can withdraw by contacting info@sdlcai.org.";
const posterSizeCompatibilityValue: PosterSize = "either";
const turnstileAction = "turnstile-spin-v2";
const maxInterestBodyBytes = 16 * 1024;
const maxPosterProposalBodyBytes = 32 * 1024;
const maxSpeakerDinnerBodyBytes = 16 * 1024;
const posterProposalStatuses = [
  "submitted",
  "shortlisted",
  "accepted",
  "waitlisted",
  "declined",
  "withdrawn",
] as const satisfies readonly PosterProposalStatus[];

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const isAdminProtected = isAdminPath(url.pathname);
    const isSpeakerDinnerPrivate = isSpeakerDinnerPath(url.pathname);
    const isSpeakerWorkspacePrivate = isSpeakerWorkspacePath(url.pathname);

    try {
      const canonicalPhotoResponse = await serveCanonicalSpeakerPhoto(
        request,
        env,
      );

      if (canonicalPhotoResponse) return canonicalPhotoResponse;
    } catch (error) {
      console.error("canonical_speaker_photo_error", {
        error: error instanceof Error ? error.message : String(error),
        pathname: url.pathname,
      });
      return new Response("Speaker photo temporarily unavailable.", {
        status: 503,
        headers: { "cache-control": "no-store", "retry-after": "60" },
      });
    }

    const socialRenderResponse = await handleSocialRenderRequest(
      request,
      env,
      ctx,
    );

    if (socialRenderResponse) return socialRenderResponse;

    const promotionManifestResponse =
      await handleSpeakerPromotionManifestRequest(request, env);

    if (promotionManifestResponse) return promotionManifestResponse;

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

    if (url.pathname === "/speaker") {
      return withSpeakerWorkspaceSecurityHeaders(
        Response.redirect(`${url.origin}/speaker/`, 308),
      );
    }

    if (isAdminProtected) {
      const unauthorizedResponse = await requireAdmin(request, env);

      if (unauthorizedResponse) return unauthorizedResponse;
    }

    const speakerWorkspaceResponse = await handleSpeakerWorkspaceRequest(
      request,
      env,
      ctx,
    );

    if (speakerWorkspaceResponse) return speakerWorkspaceResponse;

    const adminSlideRedirect = getAdminSlideRedirect(url);

    if (adminSlideRedirect) {
      return withAdminSecurityHeaders(
        Response.redirect(adminSlideRedirect, 308),
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

    if (url.pathname === "/api/admin/speaker-dinner") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const [speakers, sharedResponses, sharedInviteActive] = await Promise.all(
        [
          readSpeakerDinnerAdminItems(env),
          readSpeakerDinnerSharedAdminItems(env),
          hasSpeakerDinnerSharedInvite(env),
        ],
      );

      return withAdminSecurityHeaders(
        jsonResponse({
          count: speakers.length + sharedResponses.length,
          shared_invite_active: sharedInviteActive,
          shared_responses: sharedResponses,
          speakers,
        }),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner.csv") {
      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const [speakers, sharedResponses] = await Promise.all([
        readSpeakerDinnerAdminItems(env),
        readSpeakerDinnerSharedAdminItems(env),
      ]);

      return withAdminSecurityHeaders(
        new Response(formatSpeakerDinnerCsv(speakers, sharedResponses), {
          headers: {
            "content-disposition":
              'attachment; filename="sdlcai-speaker-dinner-caterer.csv"',
            "content-type": "text/csv; charset=utf-8",
          },
        }),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner/invite") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "rotate-speaker-dinner-invite",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return withAdminSecurityHeaders(
        await handleSpeakerDinnerInvite(request, env),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner/shared-invite") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "rotate-speaker-dinner-shared-invite",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return withAdminSecurityHeaders(
        await handleSpeakerDinnerSharedInvite(request, env),
      );
    }

    if (url.pathname === "/api/admin/speaker-dinner/purge") {
      if (request.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const forbiddenResponse = requireAdminAction(
        request,
        "purge-speaker-dinner-data",
      );

      if (forbiddenResponse) return forbiddenResponse;

      return withAdminSecurityHeaders(
        await handleSpeakerDinnerPurge(request, env),
      );
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

    if (url.pathname === "/api/speaker-dinner") {
      if (request.method === "GET") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerStatus(request, env),
        );
      }

      if (request.method === "POST") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerResponse(request, env),
        );
      }

      return withSpeakerDinnerSecurityHeaders(
        jsonResponse({ error: "Method not allowed" }, 405),
      );
    }

    if (url.pathname === "/api/speaker-dinner/shared") {
      if (request.method === "GET") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerSharedStatus(request, env),
        );
      }

      if (request.method === "POST") {
        return withSpeakerDinnerSecurityHeaders(
          await handleSpeakerDinnerSharedResponse(request, env),
        );
      }

      return withSpeakerDinnerSecurityHeaders(
        jsonResponse({ error: "Method not allowed" }, 405),
      );
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

    if (
      response.ok &&
      request.method !== "HEAD" &&
      isCanonicalPublicHtmlPath(url.pathname)
    ) {
      try {
        response = await applyCanonicalContentToResponse(
          response,
          await readCanonicalSpeakers(env),
          { private: isAdminProtected },
        );
      } catch (error) {
        console.error("canonical_public_content_fallback", {
          error: error instanceof Error ? error.message : String(error),
          pathname: url.pathname,
        });
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store");
        headers.set("x-sdlcai-content-source", "bundled-fallback");
        response = new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        });
      }
    }

    if (isAdminProtected) return withAdminSecurityHeaders(response);

    if (isSpeakerDinnerPrivate) {
      return withSpeakerDinnerSecurityHeaders(response);
    }

    if (isSpeakerWorkspacePrivate) {
      return withSpeakerWorkspaceSecurityHeaders(response);
    }

    return withStaticAssetCache(response, url);
  },

  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    if (env.INTEREST_BACKUPS) {
      ctx.waitUntil(backupInterests(env));
      ctx.waitUntil(backupPosterProposals(env));
      ctx.waitUntil(backupCanonicalSpeakerContent(env));
    }

    if (shouldPurgeSpeakerDinnerData(env)) {
      ctx.waitUntil(purgeSpeakerDinnerData(env));
    }

    ctx.waitUntil(purgeExpiredSpeakerWorkspaceData(env));
  },
} satisfies ExportedHandler<Env>;

const immutableAssetCacheControl = "public, max-age=31536000, immutable";
const adminSlideAssetPaths = new Map([
  ["/admin/slides/", "/admin-slides/"],
  ["/admin/slides/deck/", "/admin-slide-deck/"],
  ["/admin/slides/schedule/", "/admin-slide-schedule/"],
]);
const internalAdminSlidePrefixes = [
  "/admin-slides",
  "/admin-slide-deck",
  "/admin-slide-schedule",
];

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

function withSpeakerDinnerSecurityHeaders(response: Response): Response {
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

function isImmutableAssetPath(pathname: string): boolean {
  return /^\/tailwind-[a-z0-9]+\.css$/.test(pathname);
}

function getAssetRequest(request: Request, url: URL): Request {
  const assetPath = adminSlideAssetPaths.get(url.pathname);

  if (!assetPath) return request;

  const assetUrl = new URL(url);
  assetUrl.pathname = assetPath;

  return new Request(assetUrl, request);
}

function isInternalAdminSlidesPath(pathname: string): boolean {
  return internalAdminSlidePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function getAdminSlideRedirect(url: URL): string | null {
  const canonicalPath = adminSlideAssetPaths.has(`${url.pathname}/`)
    ? `${url.pathname}/`
    : null;

  return canonicalPath ? `${url.origin}${canonicalPath}${url.search}` : null;
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

async function handleSpeakerDinnerInvite(
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

async function handleSpeakerDinnerStatus(
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

async function handleSpeakerDinnerResponse(
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

async function handleSpeakerDinnerSharedInvite(
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
  const now = new Date().toISOString();
  const expiresAt = new Date(configuration.retention).toISOString();

  await env.INTERESTS.prepare(
    `INSERT INTO speaker_dinner_shared_invites (
      id,
      token_hash,
      created_at,
      expires_at,
      updated_at
    ) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at`,
  )
    .bind(tokenHash, now, expiresAt, now)
    .run();

  const inviteUrl = new URL("/speaker-dinner/shared/", request.url);
  inviteUrl.hash = token;

  return jsonResponse(
    {
      invite_url: inviteUrl.toString(),
      message:
        "A new shared dinner link was created. Any earlier shared link is now invalid.",
      ok: true,
    },
    201,
  );
}

async function handleSpeakerDinnerSharedStatus(
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

async function handleSpeakerDinnerSharedResponse(
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

async function handleSpeakerDinnerPurge(
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
    WHERE id = 1 AND token_hash = ? AND expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<SpeakerDinnerSharedInviteRow>();
}

async function hasSpeakerDinnerSharedInvite(env: Env): Promise<boolean> {
  const now = new Date().toISOString();
  const row = await env.INTERESTS.prepare(
    `SELECT id
    FROM speaker_dinner_shared_invites
    WHERE id = 1 AND expires_at > ?`,
  )
    .bind(now)
    .first<{ id: number }>();

  return Boolean(row);
}

async function readSpeakerDinnerAdminItems(
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

async function readSpeakerDinnerSharedAdminItems(
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

function shouldPurgeSpeakerDinnerData(env: Env): boolean {
  const configuration = getSpeakerDinnerConfiguration(env);

  return Boolean(
    env.INTERESTS && configuration && Date.now() > configuration.retention,
  );
}

async function purgeSpeakerDinnerData(env: Env): Promise<void> {
  await deleteSpeakerDinnerData(env);
}

function deleteSpeakerDinnerData(env: Env) {
  return env.INTERESTS.batch([
    env.INTERESTS.prepare("DELETE FROM speaker_dinner_shared_responses"),
    env.INTERESTS.prepare("DELETE FROM speaker_dinner_shared_invites"),
    env.INTERESTS.prepare("DELETE FROM speaker_dinner_responses"),
  ]);
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

function isSpeakerDinnerPath(pathname: string): boolean {
  return (
    pathname === "/speaker-dinner" ||
    pathname.startsWith("/speaker-dinner/") ||
    pathname === "/api/speaker-dinner" ||
    pathname === "/api/speaker-dinner/shared"
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

function formatSpeakerDinnerCsv(
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

function formatCsvValue(value: string): string {
  const spreadsheetSafeValue = /^[=+\-@\t\r]/u.test(value)
    ? `'${value}`
    : value;

  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
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

async function backupCanonicalSpeakerContent(env: Env): Promise<void> {
  const { results } = await env.INTERESTS.prepare(
    `SELECT * FROM canonical_speaker_content
      ORDER BY sort_order ASC, speaker_id ASC`,
  ).all();
  const rows = results ?? [];
  const rowsHash = await sha256Hex(JSON.stringify(rows));
  const latestBackup = await getLatestCanonicalSpeakerBackupManifest(env);

  if (latestBackup?.rows_hash === rowsHash) return;

  const exportedAt = new Date().toISOString();
  const body = JSON.stringify({ exported_at: exportedAt, rows }, null, 2);
  const key = `speaker-content/${exportedAt.slice(0, 10)}.json`;

  await env.INTEREST_BACKUPS.put(key, body, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { rows_hash: rowsHash },
  });

  await env.INTEREST_BACKUPS.put(
    "speaker-content/latest.json",
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

async function getLatestCanonicalSpeakerBackupManifest(
  env: Env,
): Promise<BackupManifest | null> {
  const latestBackup = await env.INTEREST_BACKUPS.get(
    "speaker-content/latest.json",
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
