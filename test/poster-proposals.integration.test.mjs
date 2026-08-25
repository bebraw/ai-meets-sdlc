import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { unstable_dev } from "wrangler";
import { validateTurnstileOutcome } from "../worker/turnstile.ts";

const execFileAsync = promisify(execFile);
const adminAuthorization = `Basic ${Buffer.from(
  "poster-admin:local-test-password",
).toString("base64")}`;
const origin = "https://sdlcai.org";
const presenterTerms =
  "I understand that, if accepted, the designated presenter must attend the poster session and bring, install, and remove an A0 or A1 portrait poster. I agree that the poster title and abstract may be published in the event program.";
const privacyConsent =
  "I consent to Toska Osuuskunta processing this proposal and contacting me about it as described in the privacy policy.";

test("Turnstile outcomes require the configured action and hostname", () => {
  const expectedHostnames = new Set(["sdlcai.org", "www.sdlcai.org"]);
  const validOutcome = {
    action: "turnstile-spin-v2",
    hostname: "SDLCAI.ORG.",
    success: true,
  };

  assert.equal(
    validateTurnstileOutcome(
      validOutcome,
      "turnstile-spin-v2",
      expectedHostnames,
    ).success,
    true,
  );
  assert.deepEqual(
    validateTurnstileOutcome(
      { ...validOutcome, action: "other-form" },
      "turnstile-spin-v2",
      expectedHostnames,
    ),
    {
      ...validOutcome,
      action: "other-form",
      success: false,
      "error-codes": ["action-mismatch"],
    },
  );
  assert.deepEqual(
    validateTurnstileOutcome(
      { ...validOutcome, hostname: "example.com" },
      "turnstile-spin-v2",
      expectedHostnames,
    ),
    {
      ...validOutcome,
      hostname: "example.com",
      success: false,
      "error-codes": ["hostname-mismatch"],
    },
  );
  assert.deepEqual(
    validateTurnstileOutcome(
      { success: "yes" },
      "turnstile-spin-v2",
      expectedHostnames,
    ),
    {
      success: false,
      "error-codes": ["invalid-siteverify-response"],
    },
  );
});

test("poster proposals can be submitted, reviewed, and exported", async (t) => {
  const persistenceDirectory = await mkdtemp(
    path.join(tmpdir(), "sdlcai-poster-test-"),
  );

  t.after(async () => {
    await rm(persistenceDirectory, { force: true, recursive: true });
  });

  await execFileAsync(
    path.resolve("node_modules/.bin/wrangler"),
    [
      "d1",
      "migrations",
      "apply",
      "ai-meets-sdlc-interests",
      "--local",
      "--persist-to",
      persistenceDirectory,
    ],
    { cwd: process.cwd() },
  );

  const worker = await unstable_dev("worker/index.ts", {
    config: "wrangler.jsonc",
    experimental: {
      disableExperimentalWarning: true,
      forceLocal: true,
    },
    local: true,
    logLevel: "error",
    persist: true,
    persistTo: persistenceDirectory,
    vars: {
      ADMIN_PASSWORD: "local-test-password",
      ADMIN_USERNAME: "poster-admin",
      EMAIL_ENCRYPTION_KEY: "local-test-encryption-key",
      POSTER_PROPOSAL_DEADLINE: "2099-09-27T20:59:59Z",
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
      SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
      SHOW_INTEREST_FORM: "",
      TURNSTILE_SITE_KEY: "",
    },
  });

  t.after(async () => {
    await worker.stop();
  });

  const proposalFields = {
    abstract:
      "A grounded field report on using AI-assisted review throughout delivery, including failures, controls, and lessons that other teams can apply.",
    consent: "yes",
    email: "ada@example.com",
    name: "Ada Example",
    organization: "Example Cooperative",
    terms: "yes",
    title: "AI-assisted review beyond code completion",
  };
  const ignoredLegacyFields = {
    setup_notes: "No special setup required.",
    supporting_url: "https://example.com/research",
  };
  const createProposalBody = () => {
    const body = new FormData();

    for (const [name, value] of Object.entries(proposalFields)) {
      body.append(name, value);
    }

    // Old cached clients may still send these names. They must not be stored.
    for (const [name, value] of Object.entries(ignoredLegacyFields)) {
      body.append(name, value);
    }

    return body;
  };
  const createProposalRequest = async () => {
    const request = new Request(`${origin}/api/poster-proposals`, {
      method: "POST",
      body: createProposalBody(),
    });

    return {
      body: await request.arrayBuffer(),
      headers: Object.fromEntries(request.headers),
      method: "POST",
    };
  };
  const submissionResponse = await worker.fetch(
    `${origin}/api/poster-proposals`,
    await createProposalRequest(),
  );
  const submission = await submissionResponse.json();

  assert.equal(submissionResponse.status, 201);
  assert.equal(submission.ok, true);
  assert.equal(submission.duplicate, undefined);

  const duplicateResponse = await worker.fetch(
    `${origin}/api/poster-proposals`,
    await createProposalRequest(),
  );
  const duplicate = await duplicateResponse.json();

  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);

  const unauthorizedResponse = await worker.fetch(
    `${origin}/api/admin/poster-proposals`,
  );
  assert.equal(unauthorizedResponse.status, 401);

  const publicSlidesResponse = await worker.fetch(`${origin}/slides/`, {
    headers: { accept: "text/html" },
  });
  const publicSlidesHtml = await publicSlidesResponse.text();

  assert.equal(publicSlidesResponse.status, 200);
  assert.equal(publicSlidesResponse.headers.get("x-robots-tag"), null);
  assert.match(publicSlidesHtml, /Slide library/i);
  assert.match(
    publicSlidesHtml,
    /\/assets\/social\/linkedin\/sdlcai-2026-slide-01-linkedin-1200x627\.jpg/,
  );

  const publicDeckResponse = await worker.fetch(`${origin}/slides/deck/`, {
    headers: { accept: "text/html" },
  });
  const publicDeckHtml = await publicDeckResponse.text();

  assert.equal(publicDeckResponse.status, 200);
  assert.equal(publicDeckResponse.headers.get("x-robots-tag"), null);
  assert.equal(
    (publicDeckHtml.match(/data-presentation-slide/g) ?? []).length,
    23,
  );
  assert.match(publicDeckHtml, /alt="Wunderdog"/);
  assert.doesNotMatch(publicDeckHtml, /bit\.ly\/4wRkjCa/);

  const publicScheduleSlidesResponse = await worker.fetch(
    `${origin}/slides/schedule/`,
    { headers: { accept: "text/html" } },
  );
  const publicScheduleSlidesHtml = await publicScheduleSlidesResponse.text();

  assert.equal(publicScheduleSlidesResponse.status, 200);
  assert.equal(publicScheduleSlidesResponse.headers.get("x-robots-tag"), null);
  assert.equal(
    (
      publicScheduleSlidesHtml.match(/class="presentation-schedule-item"/g) ??
      []
    ).length,
    13,
  );
  assert.match(publicScheduleSlidesHtml, /alt="Aalto University"/);

  for (const socialExportPath of [
    "/assets/social/linkedin/sdlcai-2026-slide-01-linkedin-1200x627.jpg",
    "/assets/social/x/sdlcai-2026-slide-01-x-1600x900.jpg",
    "/assets/social/bluesky/sdlcai-2026-slide-01-bluesky-1600x900.jpg",
  ]) {
    const socialExportResponse = await worker.fetch(
      `${origin}${socialExportPath}`,
    );

    assert.equal(socialExportResponse.status, 200);
    assert.match(
      socialExportResponse.headers.get("content-type") ?? "",
      /^image\/jpeg/,
    );
    assert.equal(socialExportResponse.headers.get("x-robots-tag"), null);
  }

  for (const internalPath of [
    "/admin-slides/",
    "/admin-slide-deck/",
    "/admin-slide-schedule/",
  ]) {
    const internalSlidesResponse = await worker.fetch(
      `${origin}${internalPath}`,
      { headers: { authorization: adminAuthorization } },
    );
    assert.equal(internalSlidesResponse.status, 404);
  }

  const unauthorizedSlidesResponse = await worker.fetch(
    `${origin}/admin/slides/`,
    { headers: { accept: "text/html" } },
  );
  assert.equal(unauthorizedSlidesResponse.status, 401);
  assert.equal(
    unauthorizedSlidesResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );

  const slidesResponse = await worker.fetch(`${origin}/admin/slides/`, {
    headers: {
      accept: "text/html",
      authorization: adminAuthorization,
    },
  });
  const slidesHtml = await slidesResponse.text();

  assert.equal(slidesResponse.status, 200);
  assert.equal(slidesResponse.headers.get("cache-control"), "no-store");
  assert.equal(
    slidesResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.match(slidesResponse.headers.get("vary") ?? "", /authorization/i);
  assert.match(
    slidesHtml,
    /<meta name="robots" content="noindex,nofollow,noarchive">/,
  );

  const unauthorizedDeckResponse = await worker.fetch(
    `${origin}/admin/slides/deck/`,
    { headers: { accept: "text/html" } },
  );
  assert.equal(unauthorizedDeckResponse.status, 401);

  const deckRedirectResponse = await worker.fetch(
    `${origin}/admin/slides/deck?slide=4`,
    {
      headers: { authorization: adminAuthorization },
      redirect: "manual",
    },
  );
  assert.equal(deckRedirectResponse.status, 308);
  assert.equal(
    deckRedirectResponse.headers.get("location"),
    `${origin}/admin/slides/deck/?slide=4`,
  );

  const deckResponse = await worker.fetch(`${origin}/admin/slides/deck/`, {
    headers: {
      accept: "text/html",
      authorization: adminAuthorization,
    },
  });
  const deckHtml = await deckResponse.text();

  assert.equal(deckResponse.status, 200);
  assert.equal(deckResponse.headers.get("cache-control"), "no-store");
  assert.equal(
    deckResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.equal((deckHtml.match(/data-presentation-slide/g) ?? []).length, 23);
  assert.match(deckHtml, /alt="Wunderdog"/);
  assert.match(deckHtml, /alt="Reaktor"/);
  assert.doesNotMatch(deckHtml, /alt="AIMBITION"/);
  assert.doesNotMatch(deckHtml, /alt="Aalto University"/);

  const scheduleSlidesResponse = await worker.fetch(
    `${origin}/admin/slides/schedule/`,
    {
      headers: {
        accept: "text/html",
        authorization: adminAuthorization,
      },
    },
  );
  const scheduleSlidesHtml = await scheduleSlidesResponse.text();

  assert.equal(scheduleSlidesResponse.status, 200);
  assert.equal(
    scheduleSlidesResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.equal(
    (scheduleSlidesHtml.match(/class="presentation-schedule-item"/g) ?? [])
      .length,
    13,
  );
  assert.match(scheduleSlidesHtml, /alt="Wunderdog"/);
  assert.match(scheduleSlidesHtml, /alt="AIMBITION"/);
  assert.match(scheduleSlidesHtml, /alt="Aalto University"/);

  const unauthorizedSlidesPdfResponse = await worker.fetch(
    `${origin}/assets/slides/sdlcai-2026-screen-ad.pdf`,
  );
  assert.equal(unauthorizedSlidesPdfResponse.status, 401);

  const slidesPdfResponse = await worker.fetch(
    `${origin}/assets/slides/sdlcai-2026-screen-ad.pdf`,
    { headers: { authorization: adminAuthorization } },
  );

  assert.equal(slidesPdfResponse.status, 200);
  assert.match(
    slidesPdfResponse.headers.get("content-type") ?? "",
    /^application\/pdf/,
  );
  assert.equal(slidesPdfResponse.headers.get("cache-control"), "no-store");
  assert.equal(
    slidesPdfResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );

  const dinnerPageResponse = await worker.fetch(`${origin}/speaker-dinner/`, {
    headers: { accept: "text/html" },
  });
  const dinnerPageHtml = await dinnerPageResponse.text();

  assert.equal(dinnerPageResponse.status, 200);
  assert.equal(dinnerPageResponse.headers.get("cache-control"), "no-store");
  assert.equal(
    dinnerPageResponse.headers.get("referrer-policy"),
    "no-referrer",
  );
  assert.equal(
    dinnerPageResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.match(
    dinnerPageHtml,
    /<meta name="robots" content="noindex,nofollow,noarchive">/,
  );
  assert.doesNotMatch(dinnerPageHtml, /Mo Khazali/);

  const unauthorizedDinnerAdminResponse = await worker.fetch(
    `${origin}/api/admin/speaker-dinner`,
  );
  assert.equal(unauthorizedDinnerAdminResponse.status, 401);

  const initialDinnerAdminResponse = await worker.fetch(
    `${origin}/api/admin/speaker-dinner`,
    { headers: { authorization: adminAuthorization } },
  );
  const initialDinnerAdmin = await initialDinnerAdminResponse.json();

  assert.equal(initialDinnerAdminResponse.status, 200);
  assert.equal(initialDinnerAdmin.speakers.length, 9);
  assert.equal(
    initialDinnerAdmin.speakers.every((speaker) => !speaker.invited),
    true,
  );

  const forbiddenInviteResponse = await worker.fetch(
    `${origin}/api/admin/speaker-dinner/invite`,
    {
      method: "POST",
      body: new URLSearchParams({ speaker_id: "mo-khazali" }),
      headers: { authorization: adminAuthorization },
    },
  );
  assert.equal(forbiddenInviteResponse.status, 403);

  const createDinnerInvite = () =>
    worker.fetch(`${origin}/api/admin/speaker-dinner/invite`, {
      method: "POST",
      body: new URLSearchParams({ speaker_id: "mo-khazali" }),
      headers: {
        authorization: adminAuthorization,
        origin,
        "x-admin-action": "rotate-speaker-dinner-invite",
      },
    });
  const inviteResponse = await createDinnerInvite();
  const invite = await inviteResponse.json();
  const inviteToken = new URL(invite.invite_url).hash.slice(1);

  assert.equal(inviteResponse.status, 201);
  assert.match(inviteToken, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(inviteResponse.headers.get("location") ?? "", /./);

  const invitationStatusResponse = await worker.fetch(
    `${origin}/api/speaker-dinner`,
    { headers: { authorization: `Bearer ${inviteToken}` } },
  );
  const invitationStatus = await invitationStatusResponse.json();

  assert.equal(invitationStatusResponse.status, 200);
  assert.equal(
    invitationStatusResponse.headers.get("cache-control"),
    "no-store",
  );
  assert.equal(
    invitationStatusResponse.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.equal(invitationStatus.name, "Mo Khazali");
  assert.equal(invitationStatus.response, null);

  const dinnerSubmissionResponse = await worker.fetch(
    `${origin}/api/speaker-dinner`,
    {
      method: "POST",
      body: new URLSearchParams({
        attendance: "attending",
        consent: "yes",
        cross_contamination: "yes",
        food_requirements: "Severe hazelnut allergy",
        meal_preference: "vegan",
      }),
      headers: { authorization: `Bearer ${inviteToken}` },
    },
  );
  const dinnerSubmission = await dinnerSubmissionResponse.json();

  assert.equal(dinnerSubmissionResponse.status, 200);
  assert.equal(dinnerSubmission.ok, true);

  const dinnerAdminResponse = await worker.fetch(
    `${origin}/api/admin/speaker-dinner`,
    { headers: { authorization: adminAuthorization } },
  );
  const dinnerAdmin = await dinnerAdminResponse.json();
  const moDinner = dinnerAdmin.speakers.find(
    (speaker) => speaker.speaker_id === "mo-khazali",
  );

  assert.equal(moDinner.invited, true);
  assert.deepEqual(moDinner.response, {
    attendance: "attending",
    cross_contamination: "yes",
    food_requirements: "Severe hazelnut allergy",
    meal_preference: "vegan",
  });

  const dinnerCsvResponse = await worker.fetch(
    `${origin}/api/admin/speaker-dinner.csv`,
    { headers: { authorization: adminAuthorization } },
  );
  const dinnerCsv = await dinnerCsvResponse.text();

  assert.equal(dinnerCsvResponse.status, 200);
  assert.match(dinnerCsv, /Mo Khazali/);
  assert.match(dinnerCsv, /Severe hazelnut allergy/);
  assert.doesNotMatch(dinnerCsv, /consent|token|responded_at/i);

  const replacementInviteResponse = await createDinnerInvite();
  const replacementInvite = await replacementInviteResponse.json();
  const replacementToken = new URL(replacementInvite.invite_url).hash.slice(1);
  const invalidatedInviteResponse = await worker.fetch(
    `${origin}/api/speaker-dinner`,
    { headers: { authorization: `Bearer ${inviteToken}` } },
  );
  const replacementStatusResponse = await worker.fetch(
    `${origin}/api/speaker-dinner`,
    { headers: { authorization: `Bearer ${replacementToken}` } },
  );
  const replacementStatus = await replacementStatusResponse.json();

  assert.equal(invalidatedInviteResponse.status, 404);
  assert.equal(replacementStatusResponse.status, 200);
  assert.equal(replacementStatus.response.meal_preference, "vegan");

  const adminResponse = await worker.fetch(
    `${origin}/api/admin/poster-proposals`,
    { headers: { authorization: adminAuthorization } },
  );
  const adminPayload = await adminResponse.json();

  assert.equal(adminResponse.status, 200);
  assert.equal(adminResponse.headers.get("cache-control"), "no-store");
  assert.equal(adminPayload.count, 1);
  assert.equal(adminPayload.proposals.length, 1);
  assert.deepEqual(
    {
      abstract: adminPayload.proposals[0].abstract,
      authors: adminPayload.proposals[0].authors,
      email: adminPayload.proposals[0].email,
      name: adminPayload.proposals[0].name,
      poster_size: adminPayload.proposals[0].poster_size,
      setup_notes: adminPayload.proposals[0].setup_notes,
      status: adminPayload.proposals[0].status,
      supporting_url: adminPayload.proposals[0].supporting_url,
      title: adminPayload.proposals[0].title,
    },
    {
      abstract: proposalFields.abstract,
      authors: "",
      email: "ada@example.com",
      name: "Ada Example",
      poster_size: "either",
      setup_notes: "",
      status: "submitted",
      supporting_url: "",
      title: "AI-assisted review beyond code completion",
    },
  );
  assert.equal(adminPayload.proposals[0].terms_text, presenterTerms);
  assert.equal(adminPayload.proposals[0].consent_text, privacyConsent);

  const proposalId = String(adminPayload.proposals[0].id);
  const forbiddenStatusResponse = await worker.fetch(
    `${origin}/api/admin/poster-proposals/status`,
    {
      method: "POST",
      body: new URLSearchParams({ id: proposalId, status: "accepted" }),
      headers: { authorization: adminAuthorization },
    },
  );

  assert.equal(forbiddenStatusResponse.status, 403);

  const statusResponse = await worker.fetch(
    `${origin}/api/admin/poster-proposals/status`,
    {
      method: "POST",
      body: new URLSearchParams({ id: proposalId, status: "accepted" }),
      headers: {
        authorization: adminAuthorization,
        origin,
        "x-admin-action": "update-poster-status",
      },
    },
  );
  const statusPayload = await statusResponse.json();

  assert.equal(statusResponse.status, 200);
  assert.equal(statusPayload.ok, true);
  assert.equal(statusPayload.proposal.status, "accepted");
  assert.equal(typeof statusPayload.proposal.reviewed_at, "string");

  const csvResponse = await worker.fetch(
    `${origin}/api/admin/poster-proposals.csv`,
    { headers: { authorization: adminAuthorization } },
  );
  const csv = await csvResponse.text();

  assert.equal(csvResponse.status, 200);
  assert.equal(csvResponse.headers.get("cache-control"), "no-store");
  assert.match(csvResponse.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(csv, /AI-assisted review beyond code completion/);
  assert.match(csv, /accepted/);

  const purgeResponse = await worker.fetch(
    `${origin}/api/admin/speaker-dinner/purge`,
    {
      method: "POST",
      body: new URLSearchParams({ confirmation: "DELETE" }),
      headers: {
        authorization: adminAuthorization,
        origin,
        "x-admin-action": "purge-speaker-dinner-data",
      },
    },
  );
  const purge = await purgeResponse.json();

  assert.equal(purgeResponse.status, 200);
  assert.equal(purge.deleted, 1);

  const purgedInviteResponse = await worker.fetch(
    `${origin}/api/speaker-dinner`,
    { headers: { authorization: `Bearer ${replacementToken}` } },
  );
  assert.equal(purgedInviteResponse.status, 404);
});

test("poster proposal validation and Turnstile fail closed", async (t) => {
  const persistenceDirectory = await mkdtemp(
    path.join(tmpdir(), "sdlcai-poster-validation-test-"),
  );

  t.after(async () => {
    await rm(persistenceDirectory, { force: true, recursive: true });
  });

  await execFileAsync(
    path.resolve("node_modules/.bin/wrangler"),
    [
      "d1",
      "migrations",
      "apply",
      "ai-meets-sdlc-interests",
      "--local",
      "--persist-to",
      persistenceDirectory,
    ],
    { cwd: process.cwd() },
  );

  const worker = await unstable_dev("worker/index.ts", {
    config: "wrangler.jsonc",
    experimental: {
      disableExperimentalWarning: true,
      forceLocal: true,
    },
    local: true,
    logLevel: "error",
    persist: true,
    persistTo: persistenceDirectory,
    vars: {
      ADMIN_PASSWORD: "local-test-password",
      ADMIN_USERNAME: "poster-admin",
      EMAIL_ENCRYPTION_KEY: "local-test-encryption-key",
      POSTER_PROPOSAL_DEADLINE: "2099-09-27T20:59:59Z",
      SHOW_INTEREST_FORM: "",
      TURNSTILE_HOSTNAMES: "localhost,127.0.0.1,sdlcai.org",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
  });

  t.after(async () => {
    await worker.stop();
  });

  const response = await worker.fetch(`${origin}/api/poster-proposals`, {
    method: "POST",
    body: new URLSearchParams({
      consent: "yes",
      email: "ada@example.com",
      name: "Ada Example",
      terms: "yes",
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(typeof payload.error, "string");

  const missingTokenResponse = await worker.fetch(
    `${origin}/api/poster-proposals`,
    {
      method: "POST",
      body: new URLSearchParams({
        abstract:
          "A sufficiently detailed account of an AI-assisted delivery experiment and the concrete lessons that attendees can apply in their own teams.",
        consent: "yes",
        email: "ada@example.com",
        name: "Ada Example",
        terms: "yes",
        title: "An evidence-based poster proposal",
      }),
    },
  );
  const missingTokenPayload = await missingTokenResponse.json();

  assert.equal(missingTokenResponse.status, 400);
  assert.equal(missingTokenPayload.error, "Verification failed");

  const oversizedResponse = await worker.fetch(
    `${origin}/api/poster-proposals`,
    {
      method: "POST",
      body: new URLSearchParams({ padding: "x".repeat(33 * 1024) }),
    },
  );
  const oversizedPayload = await oversizedResponse.json();

  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversizedPayload.error, "Submission is too large.");
});

test("poster proposal deadline is enforced before accepting data", async (t) => {
  const persistenceDirectory = await mkdtemp(
    path.join(tmpdir(), "sdlcai-poster-deadline-test-"),
  );

  t.after(async () => {
    await rm(persistenceDirectory, { force: true, recursive: true });
  });

  const worker = await unstable_dev("worker/index.ts", {
    config: "wrangler.jsonc",
    experimental: {
      disableExperimentalWarning: true,
      forceLocal: true,
    },
    local: true,
    logLevel: "error",
    persist: true,
    persistTo: persistenceDirectory,
    vars: {
      ADMIN_PASSWORD: "local-test-password",
      ADMIN_USERNAME: "poster-admin",
      EMAIL_ENCRYPTION_KEY: "local-test-encryption-key",
      POSTER_PROPOSAL_DEADLINE: "2000-01-01T00:00:00Z",
      SHOW_INTEREST_FORM: "",
      TURNSTILE_SITE_KEY: "",
    },
  });

  t.after(async () => {
    await worker.stop();
  });

  const response = await worker.fetch(`${origin}/api/poster-proposals`, {
    method: "POST",
    body: new URLSearchParams(),
  });
  const payload = await response.json();

  assert.equal(response.status, 410);
  assert.equal(payload.error, "The call for poster proposals has closed.");
});
