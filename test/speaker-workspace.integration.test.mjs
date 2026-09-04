import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { unstable_dev } from "wrangler";

const execFileAsync = promisify(execFile);
const origin = "https://sdlcai.org";
const encryptionKey = "speaker-workspace-local-test-key";
const streamWebhookSecret = "speaker-workspace-stream-webhook-secret";
const adminAuthorization = `Basic ${Buffer.from(
  "speaker-admin:local-test-password",
).toString("base64")}`;

test("speaker invitation sessions, revisions, and organizer review stay governed", async (t) => {
  const persistenceDirectory = await mkdtemp(
    path.join(tmpdir(), "sdlcai-speaker-workspace-test-"),
  );
  t.after(() => rm(persistenceDirectory, { force: true, recursive: true }));

  const wranglerPath = path.resolve("node_modules/.bin/wrangler");
  await execFileAsync(
    wranglerPath,
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

  const invitationToken = Buffer.alloc(32, 7).toString("base64url");
  const magicLinkToken = Buffer.alloc(32, 8).toString("base64url");
  const invitationHash = await hmac(
    invitationToken,
    "speaker-workspace-invite-token",
  );
  const magicLinkHash = await hmac(magicLinkToken, "speaker-magic-link-token");
  const email = await encrypt("speaker@example.com");
  const emailFingerprint = await hmac("speaker@example.com", "email-hash");
  const seedSql = `
    INSERT INTO speaker_contacts (
      speaker_id, email_ciphertext, email_iv, email_fingerprint,
      retention_until, created_at, updated_at
    ) VALUES (
      'mo-khazali', '${email.ciphertext}', '${email.iv}', '${emailFingerprint}',
      '2099-11-30T21:59:59Z', '2026-08-26T00:00:00Z', '2026-08-26T00:00:00Z'
    );
    INSERT INTO speaker_workspace_access (
      speaker_id, invite_token_hash, access_generation, invite_created_at,
      invite_expires_at, created_at, updated_at
    ) VALUES (
      'mo-khazali', '${invitationHash}', 1, '2026-08-26T00:00:00Z',
      '2099-10-31T21:59:59Z', '2026-08-26T00:00:00Z', '2026-08-26T00:00:00Z'
    );
    INSERT INTO speaker_magic_links (
      token_hash, request_id, speaker_id, access_generation,
      created_at, expires_at
    ) VALUES (
      '${magicLinkHash}', '22222222-2222-4222-8222-222222222222',
      'mo-khazali', 1, '2026-08-26T00:00:00Z', '2099-10-31T21:59:59Z'
    );
    INSERT INTO speaker_video_submissions (
      submission_id, speaker_id, talk_id, stream_uid, state,
      may_caption, may_crop, may_excerpt, may_edit, may_publish,
      permission_text, permission_recorded_at, upload_expires_at,
      retention_until, created_at, updated_at
    ) VALUES (
      '11111111-1111-4111-8111-111111111111',
      'mo-khazali',
      'mo-khazali-industry-perspective',
      '0123456789abcdef0123456789abcdef',
      'upload_pending',
      1, 1, 1, 0, 1,
      'Test permission evidence.',
      '2026-08-26T00:00:00Z',
      '2099-10-31T21:59:59Z',
      '2099-01-31T21:59:59Z',
      '2026-08-26T00:00:00Z',
      '2026-08-26T00:00:00Z'
    );`;
  await execFileAsync(
    wranglerPath,
    [
      "d1",
      "execute",
      "ai-meets-sdlc-interests",
      "--local",
      "--persist-to",
      persistenceDirectory,
      "--command",
      seedSql,
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
      ADMIN_USERNAME: "speaker-admin",
      EMAIL_ENCRYPTION_KEY: encryptionKey,
      PUBLIC_SITE_ORIGIN: origin,
      SPEAKER_CONTACT_RETENTION_UNTIL: "2099-11-30T21:59:59Z",
      SPEAKER_DINNER_RESPONSE_DEADLINE: "2099-10-05T20:59:59Z",
      SPEAKER_DINNER_RETENTION_UNTIL: "2099-10-26T21:59:59Z",
      SPEAKER_WORKSPACE_ACCESS_UNTIL: "2099-10-31T21:59:59Z",
      SPEAKER_VIDEO_RETENTION_UNTIL: "2099-01-31T21:59:59Z",
      SHOW_INTEREST_FORM: "",
      STREAM_WEBHOOK_SECRET: streamWebhookSecret,
      TURNSTILE_SITE_KEY: "",
    },
  });
  t.after(() => worker.stop());

  const speakerPageResponse = await worker.fetch(`${origin}/speaker/`);
  const speakerPage = await speakerPageResponse.text();
  assert.equal(speakerPageResponse.status, 200);
  assert.equal(speakerPageResponse.headers.get("cache-control"), "no-store");
  assert.match(speakerPage, /data-speaker-login-form/u);
  assert.match(speakerPage, /data-action="speaker-login-v1"/u);
  assert.match(speakerPage, /data-speaker-dinner-form/u);
  assert.match(speakerPage, /I won’t attend/u);
  assert.doesNotMatch(speakerPage, /__TURNSTILE_SITE_KEY__/u);

  const unauthorized = await worker.fetch(`${origin}/api/speaker/workspace`);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("cache-control"), "no-store");

  const unknownLoginResponse = await worker.fetch(
    `${origin}/api/speaker/login`,
    {
      body: JSON.stringify({ email: "unknown@example.com" }),
      headers: { "content-type": "application/json", origin },
      method: "POST",
    },
  );
  const unknownLogin = await unknownLoginResponse.json();
  assert.equal(unknownLoginResponse.status, 202);
  assert.equal(unknownLogin.accepted, true);
  assert.doesNotMatch(JSON.stringify(unknownLogin), /unknown@example\.com/u);

  const magicRedemption = await worker.fetch(`${origin}/api/speaker/session`, {
    headers: { authorization: `Bearer ${magicLinkToken}` },
    method: "POST",
  });
  assert.equal(magicRedemption.status, 200);
  assert.match(
    magicRedemption.headers.get("set-cookie") ?? "",
    /^__Host-sdlcai-speaker-session=/u,
  );
  const magicReplay = await worker.fetch(`${origin}/api/speaker/session`, {
    headers: { authorization: `Bearer ${magicLinkToken}` },
    method: "POST",
  });
  assert.equal(magicReplay.status, 401);

  const redemption = await worker.fetch(`${origin}/api/speaker/session`, {
    headers: { authorization: `Bearer ${invitationToken}` },
    method: "POST",
  });
  assert.equal(redemption.status, 200);
  const cookie = redemption.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^__Host-sdlcai-speaker-session=/u);

  const workspaceResponse = await speakerFetch(worker, cookie);
  assert.equal(workspaceResponse.status, 200);
  const workspace = await workspaceResponse.json();
  assert.equal(workspace.immutable.speaker_id, "mo-khazali");
  assert.equal(workspace.canonical_version, 1);
  assert.deepEqual(workspace.immutable.talk_ids, [
    "mo-khazali-industry-perspective",
  ]);
  assert.equal(workspace.immutable.workspace_only, false);
  assert.equal(workspace.revision, null);

  const emptyDinnerResponse = await worker.fetch(
    `${origin}/api/speaker/dinner`,
    { headers: { cookie } },
  );
  const emptyDinner = await emptyDinnerResponse.json();
  assert.equal(emptyDinnerResponse.status, 200);
  assert.equal(emptyDinner.response, null);

  const rejectedDinnerOrigin = await worker.fetch(
    `${origin}/api/speaker/dinner`,
    {
      body: JSON.stringify({
        attendance: "not_attending",
        consent: true,
      }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://attacker.example",
      },
      method: "POST",
    },
  );
  assert.equal(rejectedDinnerOrigin.status, 403);

  const dinnerSaveResponse = await worker.fetch(
    `${origin}/api/speaker/dinner`,
    {
      body: JSON.stringify({
        attendance: "attending",
        consent: true,
        cross_contamination: "yes",
        food_requirements: "Severe hazelnut allergy",
        meal_preference: "vegetarian",
      }),
      headers: { "content-type": "application/json", cookie, origin },
      method: "POST",
    },
  );
  const dinnerSave = await dinnerSaveResponse.json();
  assert.equal(dinnerSaveResponse.status, 200);
  assert.equal(dinnerSave.response.meal_preference, "vegetarian");

  const sourcePhoto = await readFile("assets/speakers/mo-khazali.webp");
  const photoUploadResponse = await worker.fetch(
    `${origin}/api/speaker/photo`,
    {
      body: sourcePhoto,
      headers: {
        "content-type": "application/octet-stream",
        cookie,
        origin,
      },
      method: "POST",
    },
  );
  const photoUpload = await photoUploadResponse.json();
  assert.equal(photoUploadResponse.status, 201);
  assert.equal(photoUpload.photo.state, "submitted");
  assert.equal(photoUpload.photo.width, 400);
  assert.equal(photoUpload.photo.height, 400);
  assert.ok(photoUpload.photo.byte_size < 250 * 1024);

  const stagedPhotoResponse = await worker.fetch(
    `${origin}/api/speaker/photo/image`,
    { headers: { cookie } },
  );
  assert.equal(stagedPhotoResponse.status, 200);
  assert.equal(stagedPhotoResponse.headers.get("content-type"), "image/webp");
  assert.ok((await stagedPhotoResponse.arrayBuffer()).byteLength > 0);

  const proposed = structuredClone(workspace.content);
  proposed.profile.name = "Mo Javad Khazali";
  proposed.talks[0].title = "AI migrations you can verify";

  const wrongOrigin = await speakerFetch(worker, cookie, {
    action: "save",
    content: proposed,
    requestOrigin: "https://attacker.example",
  });
  assert.equal(wrongOrigin.status, 403);

  const draftResponse = await speakerFetch(worker, cookie, {
    action: "save",
    content: proposed,
  });
  assert.equal(draftResponse.status, 200);
  assert.equal((await draftResponse.json()).revision.state, "draft");

  const submitResponse = await speakerFetch(worker, cookie, {
    action: "submit",
    content: proposed,
  });
  const submittedWorkspace = await submitResponse.json();
  assert.equal(submitResponse.status, 200);
  assert.equal(submittedWorkspace.revision.state, "submitted");

  const blockedResponse = await speakerFetch(worker, cookie, {
    action: "save",
    content: proposed,
  });
  assert.equal(blockedResponse.status, 409);

  const webhookBody = JSON.stringify({
    creator: "mo-khazali",
    duration: 91.4,
    meta: {
      submission_id: "11111111-1111-4111-8111-111111111111",
      talk_id: "mo-khazali-industry-perspective",
    },
    readyToStream: true,
    status: { state: "ready" },
    uid: "0123456789abcdef0123456789abcdef",
  });
  const webhookTimestamp = Math.floor(Date.now() / 1000);
  const webhookSignature = await signStreamWebhook(
    webhookTimestamp,
    webhookBody,
  );
  const webhookResponse = await worker.fetch(`${origin}/api/stream/webhook`, {
    body: webhookBody,
    headers: {
      "content-type": "application/json",
      "webhook-signature": `time=${webhookTimestamp},sig1=${webhookSignature}`,
    },
    method: "POST",
  });
  assert.equal(webhookResponse.status, 204);

  const contactSaveResponse = await worker.fetch(
    `${origin}/api/admin/speakers/contact`,
    {
      body: JSON.stringify({
        email: "ohans@example.com",
        speaker_id: "ohans-emmanuel",
      }),
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/json",
        origin,
        "x-admin-action": "save-speaker-contact",
      },
      method: "POST",
    },
  );
  const contactSave = await contactSaveResponse.json();
  assert.equal(contactSaveResponse.status, 200);
  assert.match(contactSave.message, /Email saved/u);

  const adminResponse = await worker.fetch(`${origin}/api/admin/speakers`, {
    headers: { authorization: adminAuthorization },
  });
  assert.equal(adminResponse.status, 200);
  const admin = await adminResponse.json();
  const speaker = admin.speakers.find(
    ({ speaker_id }) => speaker_id === "mo-khazali",
  );
  assert.equal(speaker.contact.email, "speaker@example.com");
  assert.ok(speaker.contact.email_confirmed_at);
  assert.equal(speaker.revision.state, "submitted");
  assert.equal(speaker.photo.state, "submitted");
  assert.equal(speaker.videos[0].state, "ready");
  assert.equal(speaker.videos[0].duration_seconds, 91.4);
  assert.equal(speaker.workspace_only, false);
  assert.equal(speaker.dinner.response.attendance, "attending");
  assert.equal(
    speaker.dinner.response.food_requirements,
    "Severe hazelnut allergy",
  );

  const dinnerDeclineResponse = await worker.fetch(
    `${origin}/api/speaker/dinner`,
    {
      body: JSON.stringify({ attendance: "not_attending", consent: true }),
      headers: { "content-type": "application/json", cookie, origin },
      method: "POST",
    },
  );
  const dinnerDecline = await dinnerDeclineResponse.json();
  assert.equal(dinnerDeclineResponse.status, 200);
  assert.deepEqual(dinnerDecline.response, {
    attendance: "not_attending",
    cross_contamination: "",
    food_requirements: "",
    meal_preference: "",
  });

  const declinedAdminResponse = await worker.fetch(
    `${origin}/api/admin/speakers`,
    { headers: { authorization: adminAuthorization } },
  );
  const declinedAdmin = await declinedAdminResponse.json();
  const declinedSpeaker = declinedAdmin.speakers.find(
    ({ speaker_id }) => speaker_id === "mo-khazali",
  );
  assert.equal(declinedAdminResponse.status, 200);
  assert.equal(declinedSpeaker.dinner.response.attendance, "not_attending");

  const mappedSpeaker = admin.speakers.find(
    ({ speaker_id }) => speaker_id === "ohans-emmanuel",
  );
  assert.equal(mappedSpeaker.contact.email, "ohans@example.com");
  assert.equal(mappedSpeaker.invitation.last_sent_at, null);
  const privateTestSpeaker = admin.speakers.find(
    ({ speaker_id }) => speaker_id === "juho-vepsalainen",
  );
  assert.equal(privateTestSpeaker.workspace_only, true);
  assert.deepEqual(
    privateTestSpeaker.canonical.talks.map(({ id }) => id),
    ["juho-vepsalainen-test-session"],
  );
  assert.deepEqual(
    speaker.revision.changed_fields.map(({ field }) => field),
    ["profile.name", "talks.mo-khazali-industry-perspective.title"],
  );

  const announcementPreviewResponse = await worker.fetch(
    `${origin}/api/admin/speakers/announcements/preview`,
    {
      body: JSON.stringify({
        category: "operational",
        speaker_ids: ["mo-khazali", "ohans-emmanuel"],
        subject: "SDLCAI programme deadline",
        text_body:
          "Please review your speaker profile and submit any final programme changes this week.",
      }),
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/json",
        origin,
        "x-admin-action": "preview-speaker-announcement",
      },
      method: "POST",
    },
  );
  const announcementPreview = await announcementPreviewResponse.json();
  assert.equal(announcementPreviewResponse.status, 200);
  assert.equal(announcementPreview.recipient_count, 1);
  assert.equal(announcementPreview.recipients[0].speaker_id, "mo-khazali");
  assert.deepEqual(announcementPreview.excluded, [
    { reason: "unconfirmed", speaker_id: "ohans-emmanuel" },
  ]);
  assert.match(announcementPreview.text_body, /Hello \{\{speaker name\}\}/u);
  assert.doesNotMatch(
    JSON.stringify(announcementPreview),
    /speaker@example\.com/u,
  );

  const approvedPhotoResponse = await worker.fetch(
    `${origin}/api/admin/speakers/photos/review`,
    {
      body: JSON.stringify({
        decision: "approve",
        photo_revision_id: speaker.photo.photo_revision_id,
        review_note: "Ready for the public profile.",
      }),
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/json",
        origin,
        "x-admin-action": "review-speaker-photo",
      },
      method: "POST",
    },
  );
  assert.equal(approvedPhotoResponse.status, 200);

  const approvedVideoResponse = await worker.fetch(
    `${origin}/api/admin/speakers/videos/review`,
    {
      body: JSON.stringify({
        decision: "approve",
        review_note: "Approved within the recorded permissions.",
        submission_id: speaker.videos[0].submission_id,
      }),
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/json",
        origin,
        "x-admin-action": "review-speaker-video",
      },
      method: "POST",
    },
  );
  assert.equal(approvedVideoResponse.status, 200);

  const rejectedResponse = await review(worker, {
    decision: "reject",
    review_note: "Please use the name shown on your conference badge.",
    revision_id: speaker.revision.revision_id,
  });
  assert.equal(rejectedResponse.status, 200);

  const returnedDraftResponse = await speakerFetch(worker, cookie);
  const returnedDraft = await returnedDraftResponse.json();
  assert.equal(returnedDraft.revision.state, "draft");
  assert.equal(returnedDraft.content.profile.name, "Mo Javad Khazali");

  const resubmittedResponse = await speakerFetch(worker, cookie, {
    action: "submit",
    content: workspace.content,
  });
  const resubmitted = await resubmittedResponse.json();
  assert.equal(resubmittedResponse.status, 200);
  assert.equal(resubmitted.revision.state, "submitted");

  const approvedResponse = await review(worker, {
    decision: "approve",
    review_note: "Ready to apply.",
    revision_id: resubmitted.revision.revision_id,
  });
  assert.equal(approvedResponse.status, 200);

  const afterApprovalResponse = await speakerFetch(worker, cookie);
  const afterApproval = await afterApprovalResponse.json();
  assert.equal(afterApproval.revision, null);

  const organizerContent = structuredClone(mappedSpeaker.canonical);
  organizerContent.profile.role = "Co-founder and CEO at Coldtea.ai";
  organizerContent.talks[0].title = "AI product engineering in practice";
  const promotionPath =
    "/assets/social/linkedin/sdlcai-2026-talk-ohans-emmanuel-industry-perspective-linkedin-1200x627.jpg";
  const unrelatedPromotionPath =
    "/assets/social/linkedin/sdlcai-2026-talk-mo-khazali-industry-perspective-linkedin-1200x627.jpg";
  const beforePromotionResponse = await worker.fetch(
    `${origin}${promotionPath}`,
    { redirect: "manual" },
  );
  const beforePromotionLocation =
    beforePromotionResponse.headers.get("location");
  assert.equal(beforePromotionResponse.status, 307);
  const unrelatedBeforeResponse = await worker.fetch(
    `${origin}${unrelatedPromotionPath}`,
    { redirect: "manual" },
  );
  const unrelatedBeforeLocation =
    unrelatedBeforeResponse.headers.get("location");
  assert.equal(unrelatedBeforeResponse.status, 307);

  const rejectedOrganizerOrigin = await saveAdminContent(worker, {
    base_content_hash: mappedSpeaker.canonical_hash,
    base_content_version: mappedSpeaker.canonical_version,
    content: organizerContent,
    mode: "draft",
    requestOrigin: "https://attacker.example",
    speaker_id: mappedSpeaker.speaker_id,
  });
  assert.equal(rejectedOrganizerOrigin.status, 403);

  const organizerDraftResponse = await saveAdminContent(worker, {
    base_content_hash: mappedSpeaker.canonical_hash,
    base_content_version: mappedSpeaker.canonical_version,
    content: organizerContent,
    mode: "draft",
    speaker_id: mappedSpeaker.speaker_id,
  });
  const organizerDraft = await organizerDraftResponse.json();
  assert.equal(organizerDraftResponse.status, 200);
  assert.equal(organizerDraft.state, "draft");
  assert.match(organizerDraft.message, /prefilled/u);

  const afterOrganizerDraftResponse = await worker.fetch(
    `${origin}/api/admin/speakers`,
    { headers: { authorization: adminAuthorization } },
  );
  const afterOrganizerDraft = await afterOrganizerDraftResponse.json();
  const draftedSpeaker = afterOrganizerDraft.speakers.find(
    ({ speaker_id }) => speaker_id === mappedSpeaker.speaker_id,
  );
  assert.equal(draftedSpeaker.revision.state, "draft");
  assert.equal(
    draftedSpeaker.revision.content.profile.role,
    "Co-founder and CEO at Coldtea.ai",
  );

  const organizerApprovalResponse = await saveAdminContent(worker, {
    base_content_hash: mappedSpeaker.canonical_hash,
    base_content_version: mappedSpeaker.canonical_version,
    content: organizerContent,
    mode: "approve",
    speaker_id: mappedSpeaker.speaker_id,
  });
  const organizerApproval = await organizerApprovalResponse.json();
  assert.equal(organizerApprovalResponse.status, 200);
  assert.equal(organizerApproval.state, "approved");
  assert.match(organizerApproval.message, /published/u);

  const publishedAdminResponse = await worker.fetch(
    `${origin}/api/admin/speakers`,
    { headers: { authorization: adminAuthorization } },
  );
  const publishedAdmin = await publishedAdminResponse.json();
  const publishedSpeaker = publishedAdmin.speakers.find(
    ({ speaker_id }) => speaker_id === mappedSpeaker.speaker_id,
  );
  assert.equal(publishedSpeaker.canonical_version, 2);
  assert.equal(
    publishedSpeaker.canonical.profile.role,
    "Co-founder and CEO at Coldtea.ai",
  );

  const publicSpeakersResponse = await worker.fetch(`${origin}/speakers/`);
  const publicSpeakers = await publicSpeakersResponse.text();
  assert.equal(publicSpeakersResponse.status, 200);
  assert.equal(
    publicSpeakersResponse.headers.get("x-sdlcai-content-source"),
    "d1",
  );
  assert.match(publicSpeakers, /Co-founder and CEO at Coldtea\.ai/u);
  assert.match(publicSpeakers, /AI product engineering in practice/u);

  const afterPromotionResponse = await worker.fetch(
    `${origin}${promotionPath}`,
    { redirect: "manual" },
  );
  assert.equal(afterPromotionResponse.status, 307);
  assert.notEqual(
    afterPromotionResponse.headers.get("location"),
    beforePromotionLocation,
  );
  const unrelatedAfterResponse = await worker.fetch(
    `${origin}${unrelatedPromotionPath}`,
    { redirect: "manual" },
  );
  assert.equal(
    unrelatedAfterResponse.headers.get("location"),
    unrelatedBeforeLocation,
  );

  const promotionManifestResponse = await worker.fetch(
    `${origin}/assets/social/speakers.json`,
  );
  const promotionManifest = await promotionManifestResponse.json();
  const promotionSpeaker = promotionManifest.speakers.find(
    ({ id }) => id === mappedSpeaker.speaker_id,
  );
  assert.equal(
    promotionSpeaker.talks[0].title,
    "AI product engineering in practice",
  );

  const staleOrganizerEditResponse = await saveAdminContent(worker, {
    base_content_hash: "stale-content-hash",
    base_content_version: mappedSpeaker.canonical_version,
    content: organizerContent,
    mode: "draft",
    speaker_id: mappedSpeaker.speaker_id,
  });
  assert.equal(staleOrganizerEditResponse.status, 409);

  const staleOrganizerVersionResponse = await saveAdminContent(worker, {
    base_content_hash: publishedSpeaker.canonical_hash,
    base_content_version: mappedSpeaker.canonical_version,
    content: publishedSpeaker.canonical,
    mode: "draft",
    speaker_id: mappedSpeaker.speaker_id,
  });
  assert.equal(staleOrganizerVersionResponse.status, 409);

  const rejectedAdminPhotoResponse = await worker.fetch(
    `${origin}/api/admin/speakers/photos/upload?speaker_id=mo-khazali`,
    {
      body: sourcePhoto,
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/octet-stream",
        origin,
        "x-admin-action": "wrong-action",
      },
      method: "POST",
    },
  );
  assert.equal(rejectedAdminPhotoResponse.status, 403);

  const adminPhotoResponse = await worker.fetch(
    `${origin}/api/admin/speakers/photos/upload?speaker_id=mo-khazali`,
    {
      body: sourcePhoto,
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/octet-stream",
        origin,
        "x-admin-action": "upload-speaker-photo",
      },
      method: "POST",
    },
  );
  const adminPhoto = await adminPhotoResponse.json();
  assert.equal(adminPhotoResponse.status, 201);
  assert.equal(adminPhoto.photo.state, "approved");
  assert.match(adminPhoto.message, /published/u);

  const publicPhotoResponse = await worker.fetch(
    `${origin}/media/speakers/mo-khazali/${adminPhoto.photo.content_hash}.webp`,
  );
  assert.equal(publicPhotoResponse.status, 200);
  assert.equal(publicPhotoResponse.headers.get("content-type"), "image/webp");
  assert.match(
    publicPhotoResponse.headers.get("cache-control") ?? "",
    /immutable/u,
  );

  const adminPhotoImageResponse = await worker.fetch(
    `${origin}${adminPhoto.photo.image_url}`,
    { headers: { authorization: adminAuthorization } },
  );
  assert.equal(adminPhotoImageResponse.status, 200);
  assert.equal(
    adminPhotoImageResponse.headers.get("content-type"),
    "image/webp",
  );

  const logoutResponse = await worker.fetch(`${origin}/api/speaker/session`, {
    headers: { cookie, origin },
    method: "DELETE",
  });
  assert.equal(logoutResponse.status, 200);
  const afterLogout = await speakerFetch(worker, cookie);
  assert.equal(afterLogout.status, 401);
});

async function speakerFetch(worker, cookie, update) {
  const init = { headers: { cookie } };

  if (update) {
    init.method = "POST";
    init.headers["content-type"] = "application/json";
    init.headers.origin = update.requestOrigin ?? origin;
    init.body = JSON.stringify({
      action: update.action,
      base_content_version: update.base_content_version ?? 1,
      content: update.content,
    });
  }

  return worker.fetch(`${origin}/api/speaker/workspace`, init);
}

function review(worker, body) {
  return worker.fetch(`${origin}/api/admin/speakers/review`, {
    body: JSON.stringify(body),
    headers: {
      authorization: adminAuthorization,
      "content-type": "application/json",
      origin,
      "x-admin-action": "review-speaker-revision",
    },
    method: "POST",
  });
}

function saveAdminContent(worker, body) {
  const { requestOrigin = origin, ...payload } = body;

  return worker.fetch(`${origin}/api/admin/speakers/content`, {
    body: JSON.stringify(payload),
    headers: {
      authorization: adminAuthorization,
      "content-type": "application/json",
      origin: requestOrigin,
      "x-admin-action": "save-speaker-content",
    },
    method: "POST",
  });
}

async function hmac(value, purpose) {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${purpose}:${encryptionKey}`),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    derived,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Buffer.from(signature).toString("base64");
}

async function encrypt(value) {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`email-encryption:${encryptionKey}`),
  );
  const key = await crypto.subtle.importKey("raw", derived, "AES-GCM", false, [
    "encrypt",
  ]);
  const iv = new Uint8Array(12).fill(9);
  const ciphertext = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    key,
    new TextEncoder().encode(value),
  );
  return {
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}

async function signStreamWebhook(timestamp, body) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(streamWebhookSecret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return [...new Uint8Array(signature)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
