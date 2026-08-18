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
