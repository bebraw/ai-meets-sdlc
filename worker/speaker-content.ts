import { authenticateSpeaker } from "./speaker-login.ts";
import {
  json,
  isSameOriginMutation,
  readJsonWithinLimit,
  maxWorkspaceBodyBytes,
  isRecord,
  staleCanonicalResponse,
} from "./speaker-workspace-utils.ts";
import {
  validateSpeakerWorkspaceContent,
  socialFields,
} from "./speaker-content-validation.ts";
import {
  readCanonicalSpeaker,
  hashCanonicalContent,
  getCanonicalPhotoUrl,
  workspaceOnlySpeakerIds,
  type SpeakerWorkspaceContent,
} from "./canonical-content.ts";
import {
  type SpeakerRevisionRow,
  type SpeakerAdminRevisionRow,
} from "./speaker-workspace-types.ts";

export async function getSpeakerWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await authenticateSpeaker(request, env);

  if (session instanceof Response) return session;

  return json(await buildWorkspacePayload(session.speaker_id, env));
}

export async function updateSpeakerWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return json({ error: "Request origin was not accepted." }, 403);
  }

  const session = await authenticateSpeaker(request, env);

  if (session instanceof Response) return session;

  const body = await readJsonWithinLimit(request, maxWorkspaceBodyBytes);

  if (body instanceof Response) return body;

  if (!isRecord(body)) {
    return json({ error: "Submit the workspace form again." }, 400);
  }

  const action = body.action;

  if (action !== "save" && action !== "submit") {
    return json(
      { error: "Choose whether to save or submit the changes." },
      400,
    );
  }

  const canonicalRecord = await readCanonicalSpeaker(env, session.speaker_id);

  if (!canonicalRecord) {
    return json({ error: "Speaker profile was not found." }, 404);
  }

  const canonical = canonicalRecord.content;
  const baseContentVersion =
    typeof body.base_content_version === "number"
      ? body.base_content_version
      : Number.NaN;

  if (baseContentVersion !== canonicalRecord.contentVersion) {
    return staleCanonicalResponse();
  }

  const validation = validateSpeakerWorkspaceContent(
    body.content,
    canonical.talks.map(({ id }) => id),
  );

  if (!validation.content) {
    return json(
      {
        error: "Review the highlighted fields.",
        field_errors: validation.errors,
      },
      400,
    );
  }

  const canonicalHash = await hashCanonicalContent(canonical);
  const now = new Date().toISOString();
  const pending = await env
    .INTERESTS!.prepare(
      `SELECT revision_id, state
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'submitted'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{
      revision_id: string;
      state: "submitted";
    }>();

  if (pending) {
    return json(
      {
        error:
          "Your submitted changes are awaiting organizer review. You can edit again after that review.",
      },
      409,
    );
  }

  const draft = await env
    .INTERESTS!.prepare(
      `SELECT revision_id, base_content_hash, base_content_version
       FROM speaker_content_revisions
      WHERE speaker_id = ?1 AND state = 'draft'
      LIMIT 1`,
    )
    .bind(session.speaker_id)
    .first<{
      base_content_hash: string;
      base_content_version: number;
      revision_id: string;
    }>();

  if (
    draft &&
    (draft.base_content_hash !== canonicalHash ||
      draft.base_content_version !== canonicalRecord.contentVersion)
  ) {
    return json(
      {
        error:
          "The published profile changed after this draft began. Reload the workspace and review the latest version.",
      },
      409,
    );
  }

  const revisionId = draft?.revision_id ?? crypto.randomUUID();
  const contentJson = JSON.stringify(validation.content);

  if (draft) {
    const result = await env
      .INTERESTS!.prepare(
        `UPDATE speaker_content_revisions
          SET content_json = ?2,
              state = ?3,
              submitted_at = CASE WHEN ?3 = 'submitted' THEN ?4 ELSE NULL END,
              updated_at = ?4
        WHERE revision_id = ?1
          AND state = 'draft'
          AND base_content_version = ?5
          AND EXISTS (
            SELECT 1 FROM canonical_speaker_content
             WHERE speaker_id = ?6 AND content_version = ?5
          )`,
      )
      .bind(
        revisionId,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        now,
        baseContentVersion,
        session.speaker_id,
      )
      .run();

    if (result.meta.changes !== 1) return staleCanonicalResponse();
  } else {
    const result = await env
      .INTERESTS!.prepare(
        `INSERT INTO speaker_content_revisions (
         revision_id,
         speaker_id,
         base_content_hash,
         base_content_version,
         content_json,
         state,
         submitted_at,
         created_at,
         updated_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8
         FROM canonical_speaker_content
        WHERE speaker_id = ?2 AND content_version = ?4`,
      )
      .bind(
        revisionId,
        session.speaker_id,
        canonicalHash,
        baseContentVersion,
        contentJson,
        action === "submit" ? "submitted" : "draft",
        action === "submit" ? now : null,
        now,
      )
      .run();

    if (result.meta.changes !== 1) return staleCanonicalResponse();
  }

  return json({
    ...(await buildWorkspacePayload(session.speaker_id, env)),
    message:
      action === "submit"
        ? "Changes submitted for organizer review."
        : "Draft saved.",
  });
}

async function buildWorkspacePayload(
  speakerId: string,
  env: Env,
): Promise<Record<string, unknown>> {
  const canonicalRecord = await readCanonicalSpeaker(env, speakerId);

  if (!canonicalRecord) {
    throw new Error(`Canonical speaker content is missing for ${speakerId}.`);
  }

  const canonical = canonicalRecord.content;
  const revision = await env
    .INTERESTS!.prepare(
      `SELECT
       revision_id,
       base_content_hash,
       base_content_version,
       content_json,
       state,
       submitted_at,
       updated_at
     FROM speaker_content_revisions
    WHERE speaker_id = ?1 AND state IN ('draft', 'submitted')
    ORDER BY CASE state WHEN 'submitted' THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1`,
    )
    .bind(speakerId)
    .first<SpeakerRevisionRow>();
  let content = canonical;

  if (revision) {
    try {
      const parsed = JSON.parse(revision.content_json) as unknown;
      const validated = validateSpeakerWorkspaceContent(
        parsed,
        canonical.talks.map(({ id }) => id),
      );

      if (validated.content) {
        content = validated.content;
      }
    } catch {
      console.error("Invalid stored speaker revision", {
        revisionId: revision.revision_id,
        speakerId,
      });
    }
  }

  return {
    authenticated: true,
    canonical,
    canonical_version: canonicalRecord.contentVersion,
    content,
    immutable: {
      photo: getCanonicalPhotoUrl(canonicalRecord),
      speaker_id: speakerId,
      talk_ids: canonical.talks.map(({ id }) => id),
      workspace_only: workspaceOnlySpeakerIds.has(speakerId),
    },
    revision: revision
      ? {
          revision_id: revision.revision_id,
          state: revision.state,
          submitted_at: revision.submitted_at,
          updated_at: revision.updated_at,
        }
      : null,
  };
}

export function serializeAdminRevision(
  revision: SpeakerAdminRevisionRow,
  canonical: SpeakerWorkspaceContent,
): Record<string, unknown> {
  let proposed: SpeakerWorkspaceContent | null = null;

  try {
    const validation = validateSpeakerWorkspaceContent(
      JSON.parse(revision.content_json) as unknown,
      canonical.talks.map(({ id }) => id),
    );
    proposed = validation.content ?? null;
  } catch {
    proposed = null;
  }

  return {
    base_content_hash: revision.base_content_hash,
    base_content_version: revision.base_content_version,
    changed_fields: proposed ? getChangedFields(canonical, proposed) : [],
    content: proposed,
    review_note: revision.review_note,
    reviewed_at: revision.reviewed_at,
    revision_id: revision.revision_id,
    state: revision.state,
    submitted_at: revision.submitted_at,
    updated_at: revision.updated_at,
  };
}

export function getChangedFields(
  canonical: SpeakerWorkspaceContent,
  proposed: SpeakerWorkspaceContent,
): Array<{ before: string; field: string; value: string }> {
  const changes: Array<{ before: string; field: string; value: string }> = [];

  for (const field of ["name", "role", "bio", ...socialFields] as const) {
    if (canonical.profile[field] !== proposed.profile[field]) {
      changes.push({
        before: canonical.profile[field],
        field: `profile.${field}`,
        value: proposed.profile[field],
      });
    }
  }

  const canonicalTalks = new Map(
    canonical.talks.map((talk) => [talk.id, talk]),
  );

  for (const talk of proposed.talks) {
    const current = canonicalTalks.get(talk.id);

    if (!current) continue;

    for (const field of ["title", "abstract"] as const) {
      if (current[field] !== talk[field]) {
        changes.push({
          before: current[field],
          field: `talks.${talk.id}.${field}`,
          value: talk[field],
        });
      }
    }
  }

  return changes;
}
