import {
  getConfigurationError,
  json,
  readJsonWithinLimit,
  isRecord,
  staleCanonicalResponse,
} from "./speaker-workspace-utils.ts";
import {
  readCanonicalSpeaker,
  hashCanonicalContent,
  type SpeakerWorkspaceContent,
} from "./canonical-content.ts";
import { validateSpeakerWorkspaceContent } from "./speaker-content-validation.ts";
import { type SpeakerRevisionRow } from "./speaker-workspace-types.ts";
import { sha256Hex } from "./form-utils.ts";

export async function reviewSpeakerRevision(
  request: Request,
  env: Env,
  emailTokenHash?: string,
): Promise<Response> {
  const configurationError = getConfigurationError(env);

  if (configurationError) return configurationError;

  const body = await readJsonWithinLimit(request, 8 * 1024);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Choose a submitted revision." }, 400);
  }

  const revisionId =
    typeof body.revision_id === "string" ? body.revision_id.trim() : "";
  const decision = body.decision;
  const reviewNote =
    typeof body.review_note === "string" ? body.review_note.trim() : "";

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(revisionId)) {
    return json({ error: "Choose a submitted revision." }, 400);
  }

  if (decision !== "approve" && decision !== "reject") {
    return json({ error: "Choose approve or request changes." }, 400);
  }

  if (reviewNote.length > 1_000) {
    return json({ error: "Keep the review note under 1,000 characters." }, 400);
  }

  if (decision === "reject" && reviewNote.length < 3) {
    return json(
      { error: "Add a short note explaining the requested changes." },
      400,
    );
  }

  const revision = await env
    .INTERESTS!.prepare(
      `SELECT
       revision_id,
       speaker_id,
       base_content_hash,
       base_content_version,
       content_json,
       state,
       submitted_at,
       updated_at
     FROM speaker_content_revisions
    WHERE revision_id = ?1 AND state = 'submitted'
    LIMIT 1`,
    )
    .bind(revisionId)
    .first<SpeakerRevisionRow & { speaker_id: string }>();

  if (!revision) {
    return json({ error: "That revision is no longer awaiting review." }, 409);
  }

  const now = new Date().toISOString();
  const snapshotHash = await sha256Hex(revision.content_json);
  if (emailTokenHash) {
    const ticket = await env.INTERESTS.prepare(
      `SELECT token_hash FROM speaker_review_tokens
       WHERE token_hash = ?1 AND revision_id = ?2 AND content_hash = ?3
         AND base_content_version = ?4 AND expires_at > ?5`,
    )
      .bind(
        emailTokenHash,
        revisionId,
        snapshotHash,
        revision.base_content_version,
        now,
      )
      .first();
    if (!ticket || decision !== "approve") {
      return json({ error: "This approval link is no longer valid." }, 410);
    }
  }
  const reviewer = emailTokenHash ? "email:info@sdlcai.org" : "admin";

  const canonicalRecord = await readCanonicalSpeaker(env, revision.speaker_id);

  if (!canonicalRecord) {
    return json({ error: "The speaker profile no longer exists." }, 409);
  }

  const canonical = canonicalRecord.content;

  if (
    canonicalRecord.contentVersion !== revision.base_content_version ||
    (await hashCanonicalContent(canonical)) !== revision.base_content_hash
  ) {
    return json(
      {
        error:
          "The public profile changed after this revision was submitted. Reconcile it before reviewing.",
      },
      409,
    );
  }

  let proposed: SpeakerWorkspaceContent;

  try {
    const validation = validateSpeakerWorkspaceContent(
      JSON.parse(revision.content_json) as unknown,
      canonical.talks.map(({ id }) => id),
    );

    if (!validation.content) throw new Error("Invalid revision content");
    proposed = validation.content;
  } catch {
    return json(
      { error: "That revision is invalid and cannot be published." },
      409,
    );
  }

  if (decision === "approve") {
    const results = await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE canonical_speaker_content
              SET content_json = ?4,
                  content_version = content_version + 1,
                  last_content_revision_id = ?1,
                  updated_at = ?5,
                  updated_by = ?6
            WHERE speaker_id = ?2
              AND content_version = ?3
              AND EXISTS (
                SELECT 1 FROM speaker_content_revisions
                 WHERE revision_id = ?1 AND state = 'submitted'
                   AND content_json = ?9 AND base_content_version = ?3
              )
              AND (?7 IS NULL OR EXISTS (
                SELECT 1 FROM speaker_review_tokens
                 WHERE token_hash = ?7 AND revision_id = ?1
                   AND content_hash = ?8 AND base_content_version = ?3
                   AND expires_at > ?5
              ))`,
        )
        .bind(
          revisionId,
          revision.speaker_id,
          revision.base_content_version,
          JSON.stringify(proposed),
          now,
          reviewer,
          emailTokenHash ?? null,
          snapshotHash,
          revision.content_json,
        ),
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
              SET state = 'approved',
                  reviewed_at = ?4,
                  reviewed_by = ?6,
                  review_note = ?5,
                  updated_at = ?4
            WHERE revision_id = ?1
              AND speaker_id = ?2
              AND state = 'submitted'
              AND EXISTS (
                SELECT 1 FROM canonical_speaker_content
                 WHERE speaker_id = ?2
                   AND content_version = ?3 + 1
                   AND last_content_revision_id = ?1
              )`,
        )
        .bind(
          revisionId,
          revision.speaker_id,
          revision.base_content_version,
          now,
          reviewNote || null,
          reviewer,
        ),
    ]);

    // D1 counts audit-trigger writes too; these statements target unique keys.
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      return staleCanonicalResponse();
    }
  } else {
    const draftRevisionId = crypto.randomUUID();
    const results = await env.INTERESTS!.batch([
      env
        .INTERESTS!.prepare(
          `UPDATE speaker_content_revisions
            SET state = 'rejected',
                reviewed_at = ?2,
                reviewed_by = 'admin',
                review_note = ?3,
                updated_at = ?2
          WHERE revision_id = ?1
            AND state = 'submitted'
            AND EXISTS (
              SELECT 1 FROM canonical_speaker_content
               WHERE speaker_id = ?4 AND content_version = ?5
            )`,
        )
        .bind(
          revisionId,
          now,
          reviewNote,
          revision.speaker_id,
          revision.base_content_version,
        ),
      env
        .INTERESTS!.prepare(
          `INSERT INTO speaker_content_revisions (
           revision_id,
           speaker_id,
           base_content_hash,
           base_content_version,
           content_json,
           state,
           created_at,
           updated_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?6
           FROM canonical_speaker_content
          WHERE speaker_id = ?2 AND content_version = ?4`,
        )
        .bind(
          draftRevisionId,
          revision.speaker_id,
          revision.base_content_hash,
          revision.base_content_version,
          revision.content_json,
          now,
        ),
    ]);

    // D1 counts audit-trigger writes too; these statements target unique keys.
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
      return staleCanonicalResponse();
    }
  }

  return json({
    decision,
    message:
      decision === "approve"
        ? "Revision approved and published."
        : "Changes requested. The speaker can edit the returned draft.",
    revision_id: revisionId,
    speaker_id: revision.speaker_id,
  });
}
