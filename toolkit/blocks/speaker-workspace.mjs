import { randomUUID } from "node:crypto";
import {
  anyone,
  bool,
  changed,
  choice,
  dateValue,
  decode,
  email,
  encode,
  fail,
  id,
  invitation,
  newToken,
  obj,
  operation,
  organizer,
  rev,
  text,
  time,
  tokenField,
  transaction,
  word,
} from "./workflow-helpers.mjs";

const access = { talkId: id, token: tokenField };
const sampleToken = "token-from-speaker-assign";
const exampleProfile = {
  name: "Alex Li",
  bio: "Accessible design researcher.",
  title: "Accessible diagrams",
  abstract: "Making technical diagrams easier to read.",
};
const profile = {
  name: word(),
  bio: text(6000),
  title: word(300),
  abstract: text(8000),
};
const samplePdf = "JVBERi0xLjQKJSVFT0YK";
const maxFileBytes = 8 * 1024 * 1024;
function workspace(ctx, input) {
  // A bearer grant names exactly one talk. Signed-in speaker principals can access only their assigned ID.
  let row;
  if (input.token) {
    row = ctx.db
      .prepare(
        "SELECT * FROM tk_speaker_workspaces WHERE grant_hash=? AND grant_until>?",
      )
      .get(ctx.fingerprint(input.token), time());
    if (!row || (input.talkId && row.talk !== input.talkId))
      fail("Speaker access is invalid, expired or revoked.", 403);
  } else if (ctx.role === "organizer" || ctx.role === "speaker") {
    if (!input.talkId) fail("Provide a talk ID or private speaker invitation.");
    row = ctx.db
      .prepare("SELECT * FROM tk_speaker_workspaces WHERE talk=?")
      .get(input.talkId);
    if (
      !row ||
      (ctx.role === "speaker" &&
        (row.speaker !== ctx.actor ||
          row.grant_until <= time() ||
          !row.grant_hash))
    )
      fail("Speaker access is unavailable.", 403);
  } else fail("A private speaker invitation is required.", 403);
  return row;
}
function canSetSharing(ctx, input) {
  // The caller must first resolve the workspace using the assigned speaker identity or its active invitation.
  return Boolean(input.token) || ctx.role === "speaker";
}
function materials(ctx, talk, visibleOnly = false) {
  const rows = ctx.db
    .prepare(
      `SELECT id,name,may_share,published,revision FROM tk_speaker_materials WHERE talk=? ${visibleOnly ? "AND may_share=1 AND published=1" : ""} ORDER BY rowid`,
    )
    .all(talk);
  return rows.map((r) => ({
    id: r.id,
    filename: ctx.open(r.name),
    ...(visibleOnly
      ? {}
      : {
          mayShare: Boolean(r.may_share),
          published: Boolean(r.published),
          revision: r.revision,
        }),
  }));
}
function details(ctx, row, canShare = false) {
  return {
    speakerId: row.speaker,
    talkId: row.talk,
    revision: row.revision,
    status: row.status,
    draft: decode(ctx, row.draft),
    published: row.approved ? decode(ctx, row.approved) : null,
    reviewNote: row.note ? ctx.open(row.note) : "",
    mayPublish: Boolean(row.may_publish),
    canSetSharing: canShare,
    materials: materials(ctx, row.talk),
  };
}
function saveDraft(ctx, row, input, fromSpeaker) {
  const draft = encode(ctx, {
    name: input.name.trim(),
    bio: input.bio.trim(),
    title: input.title.trim(),
    abstract: input.abstract.trim(),
  });
  const status = fromSpeaker ? "submitted" : "awaiting_speaker";
  // An organizer's edits need fresh confirmation from the speaker. Keep any previously approved public copy.
  const mayPublish = fromSpeaker ? Number(input.mayPublish) : row.may_publish;
  changed(
    ctx.db
      .prepare(
        "UPDATE tk_speaker_workspaces SET draft=?,may_publish=?,approved=CASE WHEN ?=1 THEN approved ELSE NULL END,status=?,note=NULL,revision=revision+1 WHERE talk=? AND revision=?",
      )
      .run(draft, mayPublish, mayPublish, status, row.talk, input.revision),
  );
  ctx.db
    .prepare("INSERT INTO tk_speaker_revisions VALUES(?,?,?,?,?)")
    .run(row.talk, input.revision + 1, draft, status, time());
  return { talkId: row.talk, status, revision: input.revision + 1 };
}
function checkedPdf(base64) {
  const bytes = Buffer.from(base64, "base64");
  if (
    !bytes.length ||
    bytes.length > maxFileBytes ||
    bytes.toString("base64") !== base64 ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
  )
    fail("Supply a base64-encoded PDF of up to 8 MiB.");
  return bytes;
}
async function invitationResult(ctx, input, token, row) {
  const invite = invitation(ctx, "speaker_read_workspace", token);
  if (input.sendEmail) {
    const to = ctx.open(row.contact);
    try {
      await ctx.services.sendMail({
        to,
        subject: "Speaker workspace invitation",
        text:
          "Open the private workspace to review your assigned talk.\n\n" +
          (invite.url ??
            "Use this token with speaker_read_workspace: " + token),
      });
    } catch {
      // Delivery may have succeeded. Preserve the original grant for a manual hand-off.
      return { ...invite, delivery: "unknown" };
    }
  }
  return { ...invite, delivery: input.sendEmail ? "accepted" : "manual" };
}
export const speakers = {
  id: "speaker-workspace",
  title: "Speaker workspace",
  description:
    "Assign a speaker and talk, collect private revisions and PDFs, and publish only approved information and permitted materials.",
  migrate(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS tk_speaker_workspaces(talk TEXT PRIMARY KEY,speaker TEXT NOT NULL,contact TEXT NOT NULL,grant_hash TEXT UNIQUE,grant_until TEXT NOT NULL,draft TEXT NOT NULL,approved TEXT,may_publish INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'draft',note TEXT);
    CREATE TABLE IF NOT EXISTS tk_speaker_materials(id TEXT PRIMARY KEY,talk TEXT NOT NULL REFERENCES tk_speaker_workspaces(talk),name TEXT NOT NULL,contents TEXT NOT NULL,may_share INTEGER NOT NULL,published INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS tk_speaker_revisions(talk TEXT NOT NULL,revision INTEGER NOT NULL,draft TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(talk,revision))`);
  },
  operations: [
    operation(
      "speaker_assign",
      "Assign a talk to a speaker and issue a private invitation. Optionally send it with a configured mail service.",
      obj(
        {
          speakerId: id,
          talkId: id,
          name: word(),
          title: word(300),
          email,
          expiresAt: word(64),
          sendEmail: bool,
        },
        ["speakerId", "talkId", "name", "title", "email", "expiresAt"],
      ),
      {
        speakerId: "speaker-alex",
        talkId: "talk-diagrams",
        name: "Alex Li",
        title: "Accessible diagrams",
        email: "alex@example.test",
        expiresAt: "2030-09-01T18:00:00Z",
      },
      organizer,
      async (input, ctx) => {
        const until = dateValue(input.expiresAt);
        if (until <= time()) fail("Choose a future expiry date.");
        if (input.sendEmail && !ctx.services?.sendMail)
          fail("Configure a transactional mail sender first.", 503);
        const token = newToken(),
          contact = ctx.seal(input.email.toLowerCase()),
          draft = encode(ctx, {
            name: input.name.trim(),
            bio: "",
            title: input.title.trim(),
            abstract: "",
          });
        const result = ctx.db
          .prepare(
            "INSERT INTO tk_speaker_workspaces(talk,speaker,contact,grant_hash,grant_until,draft) VALUES(?,?,?,?,?,?) ON CONFLICT(talk) DO NOTHING",
          )
          .run(
            input.talkId,
            input.speakerId,
            contact,
            ctx.fingerprint(token),
            until,
            draft,
          );
        if (!result.changes)
          fail("This talk already has an assigned speaker workspace.", 409);
        return {
          talkId: input.talkId,
          revision: 1,
          ...(await invitationResult(ctx, input, token, { contact })),
        };
      },
    ),
    operation(
      "speaker_reissue",
      "Replace the previous invitation with a new private link.",
      obj({ talkId: id, expiresAt: word(64), revision: rev, sendEmail: bool }, [
        "talkId",
        "expiresAt",
        "revision",
      ]),
      {
        talkId: "talk-diagrams",
        revision: 1,
        expiresAt: "2030-09-01T18:00:00Z",
      },
      organizer,
      async (input, ctx) => {
        const until = dateValue(input.expiresAt);
        if (until <= time()) fail("Choose a future expiry date.");
        if (input.sendEmail && !ctx.services?.sendMail)
          fail("Configure a transactional mail sender first.", 503);
        const row = workspace(ctx, input),
          token = newToken();
        changed(
          ctx.db
            .prepare(
              "UPDATE tk_speaker_workspaces SET grant_hash=?,grant_until=?,revision=revision+1 WHERE talk=? AND revision=?",
            )
            .run(ctx.fingerprint(token), until, row.talk, input.revision),
        );
        return {
          talkId: row.talk,
          revision: input.revision + 1,
          ...(await invitationResult(ctx, input, token, row)),
        };
      },
    ),
    operation(
      "speaker_revoke",
      "Revoke private access to a speaker’s talk workspace.",
      obj({ talkId: id, revision: rev }),
      { talkId: "talk-diagrams", revision: 1 },
      organizer,
      (input, ctx) => {
        changed(
          ctx.db
            .prepare(
              "UPDATE tk_speaker_workspaces SET grant_hash=NULL,revision=revision+1 WHERE talk=? AND revision=?",
            )
            .run(input.talkId, input.revision),
        );
        return { revoked: true, revision: input.revision + 1 };
      },
    ),
    operation(
      "speaker_read_workspace",
      "Open your assigned talk using its private invitation or an authorized actor and talk ID.",
      obj(access, []),
      { token: sampleToken },
      anyone,
      (input, ctx) =>
        details(ctx, workspace(ctx, input), canSetSharing(ctx, input)),
    ),
    operation(
      "speaker_edit_draft",
      "Prepare a private revision for the speaker to confirm. Existing public copy stays available.",
      obj({ talkId: id, revision: rev, ...profile }),
      { talkId: "talk-diagrams", revision: 1, ...exampleProfile },
      organizer,
      (input, ctx) =>
        transaction(ctx.db, () =>
          saveDraft(ctx, workspace(ctx, input), input, false),
        ),
    ),
    operation(
      "speaker_submit",
      "Submit a profile and talk revision for review. Withdrawing permission immediately removes the public entry.",
      obj({ ...access, revision: rev, ...profile, mayPublish: bool }, [
        "revision",
        "name",
        "bio",
        "title",
        "abstract",
        "mayPublish",
      ]),
      { token: sampleToken, revision: 1, ...exampleProfile, mayPublish: true },
      anyone,
      (input, ctx) =>
        transaction(ctx.db, () => {
          const row = workspace(ctx, input);
          if (!canSetSharing(ctx, input))
            fail(
              "Only the assigned speaker can submit publication choices. Organizers can prepare a private draft.",
              403,
            );
          return saveDraft(ctx, row, input, true);
        }),
    ),
    operation(
      "speaker_review_queue",
      "Read private speaker submissions, materials, current revision and review status.",
      obj({}),
      {},
      organizer,
      (_, ctx) => ({
        workspaces: ctx.db
          .prepare("SELECT * FROM tk_speaker_workspaces ORDER BY talk")
          .all()
          .map((row) => details(ctx, row)),
      }),
    ),
    operation(
      "speaker_review",
      "Approve a submitted revision for publication or return it to the speaker with a note.",
      obj(
        {
          talkId: id,
          revision: rev,
          decision: choice("approve", "request_changes"),
          note: text(2000),
        },
        ["talkId", "revision", "decision"],
      ),
      { talkId: "talk-diagrams", revision: 2, decision: "approve" },
      organizer,
      (input, ctx) =>
        transaction(ctx.db, () => {
          const row = workspace(ctx, input);
          if (row.status !== "submitted")
            fail("Submit a revision before review.", 409);
          const approved = input.decision === "approve";
          if (approved && !row.may_publish)
            fail("The speaker has withheld publication permission.", 409);
          const state = approved ? "approved" : "changes_requested";
          changed(
            ctx.db
              .prepare(
                "UPDATE tk_speaker_workspaces SET status=?,approved=CASE WHEN ?=1 THEN draft ELSE approved END,note=?,revision=revision+1 WHERE talk=? AND revision=?",
              )
              .run(
                state,
                Number(approved),
                ctx.seal(input.note ?? ""),
                row.talk,
                input.revision,
              ),
          );
          ctx.db
            .prepare("INSERT INTO tk_speaker_revisions VALUES(?,?,?,?,?)")
            .run(row.talk, input.revision + 1, row.draft, state, time());
          return { status: state, revision: input.revision + 1 };
        }),
    ),
    operation(
      "speaker_revision_history",
      "Read the private history of submissions and review outcomes for an assigned talk.",
      obj(access, []),
      { token: sampleToken },
      anyone,
      (input, ctx) => {
        const row = workspace(ctx, input);
        return {
          revisions: ctx.db
            .prepare(
              "SELECT * FROM tk_speaker_revisions WHERE talk=? ORDER BY revision",
            )
            .all(row.talk)
            .map((r) => ({
              revision: r.revision,
              at: r.at,
              state: r.state,
              profile: decode(ctx, r.draft),
            })),
        };
      },
    ),
    operation(
      "speaker_upload_material",
      "Upload a private PDF of up to 8 MiB and choose whether the organizer may publish it.",
      obj(
        {
          ...access,
          filename: {
            ...word(150),
            pattern: "^[^/\\\\\\x00-\\x1F]+\\.[pP][dD][fF]$",
          },
          contentBase64: {
            ...word(11200000),
            contentEncoding: "base64",
            contentMediaType: "application/pdf",
          },
          mayShare: bool,
        },
        ["filename", "contentBase64", "mayShare"],
      ),
      {
        token: sampleToken,
        filename: "diagrams.pdf",
        contentBase64: samplePdf,
        mayShare: false,
      },
      anyone,
      (input, ctx) => {
        const row = workspace(ctx, input);
        if (input.mayShare && !canSetSharing(ctx, input))
          fail("Only the assigned speaker can authorize slide sharing.", 403);
        const bytes = checkedPdf(input.contentBase64),
          id = randomUUID();
        ctx.db
          .prepare(
            "INSERT INTO tk_speaker_materials(id,talk,name,contents,may_share) VALUES(?,?,?,?,?)",
          )
          .run(
            id,
            row.talk,
            ctx.seal(input.filename),
            ctx.seal(input.contentBase64),
            Number(input.mayShare),
          );
        return {
          id,
          talkId: row.talk,
          revision: 1,
          byteSize: bytes.length,
          published: false,
        };
      },
    ),
    operation(
      "speaker_material_permission",
      "Grant or withdraw sharing permission for one of your materials. Withdrawal takes effect immediately.",
      obj({ ...access, materialId: id, revision: rev, mayShare: bool }, [
        "materialId",
        "revision",
        "mayShare",
      ]),
      {
        token: sampleToken,
        materialId: "from-speaker-upload-material",
        revision: 1,
        mayShare: true,
      },
      anyone,
      (input, ctx) => {
        const row = workspace(ctx, input);
        if (!canSetSharing(ctx, input))
          fail(
            "Only the assigned speaker can change slide sharing permission.",
            403,
          );
        changed(
          ctx.db
            .prepare(
              "UPDATE tk_speaker_materials SET may_share=?,published=CASE WHEN ?=1 THEN published ELSE 0 END,revision=revision+1 WHERE id=? AND talk=? AND revision=?",
            )
            .run(
              Number(input.mayShare),
              Number(input.mayShare),
              input.materialId,
              row.talk,
              input.revision,
            ),
        );
        return { revision: input.revision + 1 };
      },
    ),
    operation(
      "speaker_publish_material",
      "Publish or unpublish a PDF after checking its explicit sharing permission.",
      obj({ materialId: id, revision: rev, publish: bool }),
      {
        materialId: "from-speaker-upload-material",
        revision: 1,
        publish: true,
      },
      organizer,
      (input, ctx) => {
        changed(
          ctx.db
            .prepare(
              "UPDATE tk_speaker_materials SET published=?,revision=revision+1 WHERE id=? AND revision=? AND (may_share=1 OR ?=0)",
            )
            .run(
              Number(input.publish),
              input.materialId,
              input.revision,
              Number(input.publish),
            ),
        );
        return { published: input.publish, revision: input.revision + 1 };
      },
    ),
    operation(
      "speaker_download_material",
      "Download an approved public slide PDF, or supply the owner’s invitation for private access.",
      obj({ ...access, materialId: id }, ["materialId"]),
      { materialId: "from-speaker-upload-material" },
      anyone,
      (input, ctx) => {
        const r = ctx.db
          .prepare(
            "SELECT m.*,w.approved,w.may_publish FROM tk_speaker_materials m JOIN tk_speaker_workspaces w ON w.talk=m.talk WHERE m.id=?",
          )
          .get(input.materialId);
        if (!r) fail("Material not found.", 404);
        if (!(r.published && r.may_share && r.approved && r.may_publish)) {
          workspace(ctx, { talkId: r.talk, token: input.token });
        }
        return {
          artifact: {
            name: ctx.open(r.name),
            mimeType: "application/pdf",
            bytes: Buffer.from(ctx.open(r.contents), "base64"),
          },
        };
      },
    ),
    operation(
      "speaker_programme",
      "Read approved speaker profiles, talk descriptions and released material IDs.",
      obj({}),
      {},
      anyone,
      (_, ctx) => ({
        sessions: ctx.db
          .prepare(
            "SELECT * FROM tk_speaker_workspaces WHERE approved IS NOT NULL AND may_publish=1 ORDER BY talk",
          )
          .all()
          .map((row) => ({
            talkId: row.talk,
            speakerId: row.speaker,
            ...decode(ctx, row.approved),
            materials: materials(ctx, row.talk, true),
          })),
      }),
    ),
  ],
};
