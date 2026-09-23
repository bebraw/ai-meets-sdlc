import {
  readCanonicalSpeaker,
  hashCanonicalContent,
} from "./canonical-content.ts";
import { getChangedFields } from "./speaker-content.ts";
import { validateSpeakerWorkspaceContent } from "./speaker-content-validation.ts";
import { reviewSpeakerRevision } from "./speaker-revision-review.ts";
import { insertActivity } from "./activity-log.ts";
import { speakerReviewTokenPurpose } from "./speaker-review-digest.ts";
import {
  reviewChangesHtml,
  speakerReviewPage,
} from "./speaker-review-templates.ts";
import {
  escapeHtml,
  hashToken,
  isSameOriginMutation,
  tokenPattern,
} from "./speaker-workspace-utils.ts";
import { readFormDataWithinLimit, sha256Hex } from "./form-utils.ts";
import { type SpeakerRevisionRow } from "./speaker-workspace-types.ts";

export async function handleSpeakerEmailReview(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/speaker-review/")) return null;
  const fail = (title: string, intro: string, status: number) =>
    speakerReviewPage({ title, intro, status });
  if (!["GET", "HEAD", "POST"].includes(request.method)) {
    return fail(
      "Method not allowed",
      "Open the review link from your digest email.",
      405,
    );
  }
  const token = url.pathname.slice("/speaker-review/".length);
  if (!tokenPattern.test(token))
    return fail(
      "Review link unavailable",
      "Use the private link from your latest digest or open speaker administration.",
      404,
    );
  if (
    !env.INTERESTS ||
    !env.EMAIL_ENCRYPTION_KEY ||
    env.SPEAKER_REVIEW_DIGEST_ENABLED !== "true"
  ) {
    return fail(
      "Review temporarily unavailable",
      "Please try again later or use speaker administration.",
      503,
    );
  }

  try {
    const tokenHash = await hashToken(
      token,
      env.EMAIL_ENCRYPTION_KEY,
      speakerReviewTokenPurpose,
    );
    const revision = await env.INTERESTS.prepare(
      `SELECT r.revision_id, r.speaker_id, r.base_content_hash, r.base_content_version,
              r.content_json, r.state, r.submitted_at, r.updated_at,
              t.content_hash AS ticket_content_hash, t.expires_at
       FROM speaker_review_tokens t JOIN speaker_content_revisions r ON r.revision_id = t.revision_id
       WHERE t.token_hash = ?1 AND t.expires_at > ?2 AND r.state = 'submitted'
         AND t.base_content_version = r.base_content_version`,
    )
      .bind(tokenHash, new Date().toISOString())
      .first<
        SpeakerRevisionRow & {
          speaker_id: string;
          ticket_content_hash: string;
          expires_at: string;
        }
      >();
    if (
      !revision ||
      (await sha256Hex(revision.content_json)) !== revision.ticket_content_hash
    ) {
      return fail(
        "Review link no longer available",
        "This link has expired, the changes were already reviewed, or the revision has changed. Use the latest digest or open speaker administration.",
        410,
      );
    }
    const canonical = await readCanonicalSpeaker(env, revision.speaker_id);
    if (
      !canonical ||
      canonical.contentVersion !== revision.base_content_version ||
      (await hashCanonicalContent(canonical.content)) !==
        revision.base_content_hash
    ) {
      return fail(
        "The published details have changed",
        "This revision was based on an older version. Reconcile the changes in speaker administration before approving them.",
        409,
      );
    }
    const proposed = validateSpeakerWorkspaceContent(
      JSON.parse(revision.content_json) as unknown,
      canonical.content.talks.map((talk) => talk.id),
    ).content;
    if (!proposed)
      return fail(
        "This revision needs attention",
        "Open speaker administration to review the submitted content.",
        409,
      );

    if (request.method === "POST") {
      if (!isSameOriginMutation(request))
        return fail(
          "Approval could not be verified",
          "Open the email link and use the approval button on this site.",
          403,
        );
      const form = await readFormDataWithinLimit(request, 1024);
      if (form instanceof Response)
        return fail(
          "Approval form could not be read",
          "Reload the review page and try again.",
          form.status,
        );
      if (
        form.get("decision") !== "approve" ||
        form.get("content_hash") !== revision.ticket_content_hash
      ) {
        return fail(
          "Review the changes again",
          "Reload the review page before confirming this revision.",
          409,
        );
      }
      // Reuse the admin publication transaction, adding a token/snapshot guard.
      // No general admin session or credentials are created by this capability.
      const result = await reviewSpeakerRevision(
        new Request(request.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revision_id: revision.revision_id,
            decision: "approve",
            review_note: "Approved from the organizer email digest.",
          }),
        }),
        env,
        tokenHash,
      );
      if (!result.ok) {
        const error = (await result.json()) as { error: string };
        return fail("Approval not completed", error.error, result.status);
      }
      try {
        await insertActivity(env, {
          actorType: "admin",
          actorId: "organizer review link",
          subjectSpeakerId: revision.speaker_id,
          category: "Speaker revision",
          action: "approved",
        });
      } catch (error) {
        console.error("activity_log_write_failed", {
          error: error instanceof Error ? error.message : String(error),
          category: "Speaker revision",
        });
      }
      return speakerReviewPage({
        title: "Changes approved",
        intro: `${canonical.content.profile.name}’s update is now published. There is nothing else to do for this revision.`,
        content: '<p><a href="/speakers/">View the published speakers</a></p>',
      });
    }

    const changes = getChangedFields(canonical.content, proposed);
    const expiry = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Europe/Helsinki",
    }).format(new Date(revision.expires_at));
    const response = speakerReviewPage({
      title: `Review ${canonical.content.profile.name}’s changes`,
      intro:
        "Compare the published text with the proposed update below. Nothing changes until you confirm approval.",
      content: `${changes.length ? reviewChangesHtml(changes) : "<p>This revision makes no changes to the published text.</p>"}
        <form method="post" action="${escapeHtml(url.pathname)}">
          <input type="hidden" name="content_hash" value="${escapeHtml(revision.ticket_content_hash)}">
          <p>Approval publishes all changes shown above.</p>
          <button type="submit" name="decision" value="approve">Approve and publish changes</button>
          <p class="note">Private link · Expires ${escapeHtml(expiry)} (Helsinki time). To request edits instead, open speaker administration.</p>
        </form>`,
    });
    return request.method === "HEAD"
      ? new Response(null, {
          status: response.status,
          headers: response.headers,
        })
      : response;
  } catch {
    console.error("speaker_email_review_failed");
    return fail(
      "Review temporarily unavailable",
      "Your approval could not be completed. Try again later or open speaker administration.",
      503,
    );
  }
}
