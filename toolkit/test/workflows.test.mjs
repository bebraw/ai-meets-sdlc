import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { createToolkit } from "../index.mjs";
import { directory } from "../blocks/organizer-directory.mjs";
import { d1OrganizerStore } from "../blocks/organizer-store.mjs";

const visitor = { actor: "visitor", role: "public" };
const owner = { actor: "owner", role: "organizer" };
const future = (days) => new Date(Date.now() + days * 86400000).toISOString();
const withStatus = (status) => (e) => e.status === status;
function instance(t, enabled, options = {}) {
  const kit = createToolkit({ enabled, ...options });
  t.after(() => kit.close());
  const ajv = addFormats(new Ajv());
  const validators = new Map(
    kit
      .catalog()
      .flatMap(({ operations }) =>
        operations.map((op) => [op.name, ajv.compile(op.outputSchema)]),
      ),
  );
  return {
    ...kit,
    async run(name, input, principal) {
      const result = await kit.run(name, input, principal);
      const structured = { ...result };
      if (result.artifact) {
        const { name, mimeType } = result.artifact;
        structured.artifact = {
          name,
          mimeType,
          uri: "event-toolkit://artifacts/example",
        };
      }
      const validate = validators.get(name);
      assert.ok(
        validate(structured),
        name + " result: " + ajv.errorsText(validate.errors),
      );
      return result;
    },
  };
}

test("directory persistence, public projection, optimistic edits and per-event store isolation", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "event-people-"));
  t.after(() => rm(base, { force: true, recursive: true }));
  const options = { directory: base, eventId: "sample-event" };
  const kit = instance(t, ["organizer-directory"], options);
  const member = await kit.run("organizers_create", {
    name: "Morgan",
    visible: true,
    badge: true,
  });
  await kit.run("organizers_create", { name: "Internal" });
  const pub = await kit.run("organizers_public", {}, visitor);
  assert.deepEqual(pub.people, [
    { id: member.id, name: "Morgan", company: "", photo: "" },
  ]);
  await assert.rejects(
    kit.run("organizers_list", {}, visitor),
    withStatus(403),
  );
  const restarted = instance(t, ["organizer-directory"], options);
  const input = {
    id: member.id,
    name: "Morgan Chen",
    visible: true,
    badge: true,
    position: 0,
    revision: 1,
  };
  await restarted.run("organizers_update", input);
  await assert.rejects(kit.run("organizers_update", input), withStatus(409));
  assert.equal(
    (await kit.run("organizers_public", {}, visitor)).people[0].name,
    "Morgan Chen",
  );
  assert.deepEqual(
    (
      await instance(t, ["organizer-directory"], {
        directory: base,
        eventId: "second-event",
      }).run("organizers_list")
    ).people,
    [],
  );
  await kit.run("organizers_delete", { id: member.id, revision: 2 });
  assert.equal((await kit.run("organizers_public")).people.length, 0);
});

test("D1 directory adapter shares ordering and conditional writes with SQLite", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  directory.migrate(db);
  const stmt = (query, params = []) => ({
    bind: (...values) => stmt(query, values),
    all: async () => ({ results: db.prepare(query).all(...params) }),
    run: async () => ({ meta: db.prepare(query).run(...params) }),
  });
  const directoryD1 = d1OrganizerStore({ prepare: stmt });
  const values = [
    "Lee",
    "Community",
    "",
    "1",
    "0",
    0,
    new Date().toISOString(),
  ];
  assert.equal(await directoryD1.create("lee", values), 1);
  assert.equal((await directoryD1.list(true))[0].revision, 1);
  assert.equal(await directoryD1.update("lee", 1, values), 1);
  assert.equal(await directoryD1.remove("lee", 1), 0);
  assert.equal(await directoryD1.remove("lee", 2), 1);
});

test("desk grants, atomic assignment, cancellation and duplicate arrival protection", async (t) => {
  const kit = instance(t, ["check-in"]);
  await kit.run("checkin_register", {
    people: [
      { id: "unassigned", name: "", ticketCode: "T-1" },
      { id: "cancelled", name: "Cancelled", status: "cancelled" },
    ],
    rosterRevision: 0,
  });
  const grant = await kit.run("checkin_issue_grant", { label: "Gate" });
  const { people } = await kit.run(
    "checkin_lookup",
    { query: "t-1", token: grant.token },
    visitor,
  );
  assert.equal(people.length, 1);
  const scan = { id: "unassigned", revision: 1, token: grant.token };
  await assert.rejects(
    kit.run("checkin_arrive", scan, visitor),
    withStatus(400),
  );
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      kit.run("checkin_arrive", { ...scan, assignName: "Alex" }, visitor),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.reason?.status === 409).length, 1);
  assert.equal(
    (await kit.run("checkin_history", { id: "unassigned" })).history.length,
    1,
  );
  await assert.rejects(
    kit.run("checkin_arrive", { id: "cancelled", revision: 1 }),
    withStatus(409),
  );
  await assert.rejects(
    kit.run("checkin_undo", { id: "unassigned", revision: 2 }, visitor),
    withStatus(403),
  );
  await kit.run("checkin_revoke_grant", { id: grant.id });
  await assert.rejects(
    kit.run("checkin_lookup", { query: "Alex", token: grant.token }, visitor),
    withStatus(403),
  );
  await kit.run("checkin_register", {
    people: [{ id: "unassigned", name: "", ticketCode: "T-1" }],
    rosterRevision: 2,
  });
  assert.equal(
    (await kit.run("checkin_lookup", { query: "t-1" })).people[0].name,
    "Alex",
  );
  await kit.run("checkin_undo", { id: "unassigned", revision: 2 });
  assert.deepEqual(
    (await kit.run("checkin_history", { id: "unassigned" })).history.map(
      (h) => h.action,
    ),
    ["arrive", "undo"],
  );
  await assert.rejects(
    kit.run("checkin_register", {
      people: [{ id: "x", name: "X" }],
      rosterRevision: 0,
    }),
    withStatus(409),
  );
});

test("poster review, consent snapshot, challenge, retry and presenter-to-ticket reconciliation", async (t) => {
  const kit = instance(t, ["poster-proposals", "check-in"], {
    services: { verifyChallenge: async ({ token }) => token === "accepted" },
  });
  const call = {
    deadline: future(7),
    consent: "We can contact you about this poster.",
    revision: 0,
    requireChallenge: true,
  };
  await kit.run("posters_configure_call", call);
  const item = {
    name: "Alex",
    email: "alex@example.test",
    title: "Design systems",
    abstract: "A case study.",
    requestId: "request-1",
    callRevision: 1,
    consentAccepted: true,
  };
  await assert.rejects(
    kit.run("posters_submit", item, visitor),
    withStatus(403),
  );
  const acceptedInput = { ...item, challengeToken: "accepted" };
  const { id } = await kit.run("posters_submit", acceptedInput, visitor);
  assert.equal(
    (await kit.run("posters_submit", acceptedInput, visitor)).id,
    id,
  );
  await assert.rejects(
    kit.run("posters_submit", { ...acceptedInput, title: "New" }, visitor),
    withStatus(409),
  );
  await kit.run("posters_configure_call", {
    ...call,
    revision: 1,
    consent: "Updated terms",
  });
  await assert.rejects(
    kit.run(
      "posters_submit",
      { ...acceptedInput, requestId: "request-2" },
      visitor,
    ),
    withStatus(409),
  );
  const record = (await kit.run("posters_review_queue")).proposals[0];
  assert.equal(record.consentText, call.consent);
  await kit.run("posters_decide", { id, status: "accepted", revision: 1 });
  await assert.rejects(
    kit.run("posters_decide", { id, status: "withdrawn", revision: 1 }),
    withStatus(409),
  );
  const { people } = await kit.run("posters_presenters");
  await kit.run("checkin_register", { people, rosterRevision: 0 });
  await kit.run("checkin_arrive", { id: people[0].id, revision: 1 });
  await kit.run("checkin_register", {
    people: [{ id: "ticket", name: "Alex", ticketCode: "T-2" }],
    rosterRevision: 2,
  });
  await kit.run("checkin_link", {
    ticketId: "ticket",
    sourceId: people[0].id,
    rosterRevision: 3,
  });
  await kit.run("checkin_register", { people, rosterRevision: 4 });
  const current = await kit.run("checkin_roster");
  assert.equal(current.people.length, 1);
  assert.ok(current.people[0].arrivedAt);
  assert.equal(
    (await kit.run("checkin_history", { id: "ticket" })).history[0].action,
    "arrive",
  );
  assert.match(
    Buffer.from((await kit.run("posters_export")).artifact.bytes).toString(),
    /Design systems/,
  );
});

test("dinner guest links scope responses and generate an identity-free catering handoff", async (t) => {
  const kit = instance(t, ["dinner-rsvps", "catering"]);
  const dates = { replyBy: future(5), retainUntil: future(10) };
  const alex = await kit.run("dinner_invite", { name: "Alex", ...dates });
  const pat = await kit.run("dinner_invite", { name: "Pat", ...dates });
  await assert.rejects(kit.run("dinner_list", {}, visitor), withStatus(403));
  const answer = {
    token: alex.token,
    revision: 1,
    attendance: "attending",
    meal: "vegan",
    diet: "Nuts",
    crossContamination: "yes",
  };
  await kit.run("dinner_respond", answer, visitor);
  await assert.rejects(
    kit.run("dinner_respond", answer, visitor),
    withStatus(409),
  );
  assert.equal(
    (await kit.run("dinner_read_invitation", { token: pat.token }, visitor))
      .response,
    null,
  );
  const totals = await kit.run("dinner_catering");
  assert.equal(totals.attending, 1);
  assert.equal(totals.pending, 1);
  assert.equal(totals.meals.vegan, 1);
  assert.equal(JSON.stringify(totals).includes("Alex"), false);
  const brief = await kit.run(
    "catering_prepare_brief",
    { eventName: "Test event", people: totals.people },
    owner,
  );
  assert.ok(brief.artifact.bytes.length);
  await kit.run("dinner_revoke", { id: alex.id, revision: 2 });
  await assert.rejects(
    kit.run("dinner_read_invitation", { token: alex.token }, visitor),
    withStatus(404),
  );
  assert.equal((await kit.run("dinner_catering")).attending, 0);
});

test("speaker grant, draft review, file release, withdrawal and private token boundaries", async (t) => {
  const kit = instance(t, ["speaker-workspace"]);
  const assign = (name, talkId) =>
    kit.run("speaker_assign", {
      name,
      email: "person@example.test",
      title: "Design",
      speakerId: name.toLowerCase(),
      talkId,
      expiresAt: future(15),
    });
  const a = await assign("Alex", "design"),
    b = await assign("Blair", "other");
  await assert.rejects(
    kit.run(
      "speaker_read_workspace",
      { token: a.token, talkId: "other" },
      visitor,
    ),
    withStatus(403),
  );
  const submission = {
    token: a.token,
    revision: 1,
    name: "Alex",
    bio: "Researcher",
    title: "Design",
    abstract: "Notes",
    mayPublish: true,
  };
  await kit.run("speaker_submit", submission, visitor);
  assert.deepEqual(
    (await kit.run("speaker_programme", {}, visitor)).sessions,
    [],
  );
  await kit.run("speaker_review", {
    talkId: "design",
    revision: 2,
    decision: "approve",
  });
  const file = await kit.run(
    "speaker_upload_material",
    {
      filename: "design.pdf",
      contentBase64: "JVBERi0xLjQKJSVFT0YK",
      token: a.token,
      mayShare: false,
    },
    visitor,
  );
  const reference = { materialId: file.id };
  await assert.rejects(
    kit.run("speaker_publish_material", {
      ...reference,
      publish: true,
      revision: 1,
    }),
    withStatus(409),
  );
  await assert.rejects(
    kit.run(
      "speaker_download_material",
      { ...reference, token: b.token },
      visitor,
    ),
    withStatus(403),
  );
  await assert.rejects(
    kit.run("speaker_download_material", reference, visitor),
    withStatus(403),
  );
  await kit.run(
    "speaker_material_permission",
    { ...reference, token: a.token, mayShare: true, revision: 1 },
    visitor,
  );
  await kit.run("speaker_publish_material", {
    ...reference,
    publish: true,
    revision: 2,
  });
  assert.equal(
    (await kit.run("speaker_programme", {}, visitor)).sessions[0].materials
      .length,
    1,
  );
  const publicPDF = await kit.run(
    "speaker_download_material",
    reference,
    visitor,
  );
  assert.match(publicPDF.artifact.bytes.toString(), /^%PDF-/);
  await kit.run(
    "speaker_material_permission",
    { ...reference, token: a.token, mayShare: false, revision: 3 },
    visitor,
  );
  await assert.rejects(
    kit.run("speaker_download_material", reference, visitor),
    withStatus(403),
  );
  await kit.run(
    "speaker_submit",
    { ...submission, mayPublish: false, revision: 3 },
    visitor,
  );
  assert.equal(
    (await kit.run("speaker_programme", {}, visitor)).sessions.length,
    0,
  );
  await kit.run("speaker_revoke", { talkId: "design", revision: 4 });
  await assert.rejects(
    kit.run("speaker_read_workspace", { token: a.token }, visitor),
    withStatus(403),
  );
});

test("organizers prepare copy and private slides while only the assigned speaker can authorize a new release", async (t) => {
  const kit = instance(t, ["speaker-workspace"]);
  const talkId = "scoped",
    speaker = { role: "speaker", actor: "river" };
  await kit.run("speaker_assign", {
    talkId,
    speakerId: speaker.actor,
    name: "River",
    email: "river@example.test",
    title: "Public gardens",
    expiresAt: future(10),
  });
  const copy = {
    talkId,
    name: "River",
    bio: "Designer",
    title: "Public gardens",
    abstract: "Open design notes",
  };
  const draft = await kit.run("speaker_edit_draft", { ...copy, revision: 1 });
  assert.equal(draft.status, "awaiting_speaker");
  await assert.rejects(
    kit.run("speaker_submit", { ...copy, revision: 2, mayPublish: true }),
    withStatus(403),
  );
  await assert.rejects(
    kit.run("speaker_review", { talkId, revision: 2, decision: "approve" }),
    withStatus(409),
  );
  assert.equal(
    (await kit.run("speaker_read_workspace", { talkId }, speaker))
      .canSetSharing,
    true,
  );
  assert.equal(
    (await kit.run("speaker_read_workspace", { talkId })).canSetSharing,
    false,
  );
  await kit.run(
    "speaker_submit",
    { ...copy, revision: 2, mayPublish: true },
    speaker,
  );
  await kit.run("speaker_review", { talkId, revision: 3, decision: "approve" });
  await kit.run("speaker_edit_draft", {
    ...copy,
    title: "Unconfirmed draft",
    revision: 4,
  });
  await assert.rejects(
    kit.run("speaker_review", { talkId, revision: 5, decision: "approve" }),
    withStatus(409),
  );
  assert.equal(
    (await kit.run("speaker_programme", {}, visitor)).sessions[0].title,
    copy.title,
  );
  const upload = {
    talkId,
    filename: "slides.pdf",
    contentBase64: "JVBERi0xLjQKJSVFT0YK",
    mayShare: false,
  };
  await assert.rejects(
    kit.run("speaker_upload_material", { ...upload, mayShare: true }),
    withStatus(403),
  );
  const file = await kit.run("speaker_upload_material", upload);
  await assert.rejects(
    kit.run("speaker_material_permission", {
      talkId,
      materialId: file.id,
      revision: 1,
      mayShare: true,
    }),
    withStatus(403),
  );
  await kit.run(
    "speaker_material_permission",
    { talkId, materialId: file.id, revision: 1, mayShare: true },
    speaker,
  );
  await kit.run("speaker_publish_material", {
    materialId: file.id,
    revision: 2,
    publish: true,
  });
  assert.equal(
    (await kit.run("speaker_programme", {}, visitor)).sessions[0].materials[0]
      .id,
    file.id,
  );
});
