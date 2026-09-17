import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  readCanonicalSpeaker,
  hashCanonicalContent,
} from "../worker/canonical-content.ts";
import {
  sendSpeakerReviewDigest,
  speakerReviewDigestDate,
  purgeSpeakerReviewDigests,
} from "../worker/speaker-review-digest.ts";
import { handleSpeakerEmailReview } from "../worker/speaker-email-review.ts";
import { speakerReviewDigestEmail } from "../worker/speaker-review-templates.ts";

const morning = new Date("2099-06-01T06:00:00.000Z");
const later = (hours) => new Date(morning.getTime() + hours * 60 * 60 * 1000);
const origin = "https://sdlcai.org";
const migrations = await Promise.all(
  (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFile(`migrations/${name}`, "utf8")),
);

test("digest follows 09:00 Helsinki across summer, winter and DST transitions", () => {
  for (const [before, due, date] of [
    ["2026-09-17T05:00Z", "2026-09-17T06:00Z", "2026-09-17"],
    ["2026-01-17T06:00Z", "2026-01-17T07:00Z", "2026-01-17"],
    ["2026-03-29T05:00Z", "2026-03-29T06:00Z", "2026-03-29"],
    ["2026-10-25T06:00Z", "2026-10-25T07:00Z", "2026-10-25"],
  ]) {
    assert.equal(speakerReviewDigestDate(new Date(before)), null);
    assert.equal(speakerReviewDigestDate(new Date(due)), date);
  }
});

test("empty days stay quiet; drafts, approved revisions and private test speakers are excluded", async (t) => {
  const f = await fixture(t);
  await f.submit({ state: "draft" });
  await f.submit({ speaker: "ohans-emmanuel", state: "approved" });
  await f.submit({ speaker: "juho-vepsalainen" });
  await sendSpeakerReviewDigest(f.env, later(-1));
  assert.equal(await f.count("speaker_review_digests"), 0);
  await sendSpeakerReviewDigest(f.env, morning);
  assert.equal(f.messages.length, 0);
  assert.equal(
    (await f.db.prepare("SELECT status FROM speaker_review_digests").first())
      .status,
    "empty",
  );
  await f.db
    .prepare(
      "UPDATE speaker_content_revisions SET state='submitted' WHERE speaker_id='mo-khazali'",
    )
    .run();
  await sendSpeakerReviewDigest(f.env, later(1));
  assert.equal(
    f.messages.length,
    0,
    "a completed daily slot is not reopened by later submissions",
  );
  await sendSpeakerReviewDigest(f.env, later(24));
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].subject, /1 speaker update/u);
  assert.doesNotMatch(f.messages[0].text, /Juho|Ohans/u);
});

test("digest shows changed text; GET and HEAD are inert, POST publishes exactly once without admin login", async (t) => {
  const f = await fixture(t);
  const revision = await f.submit();
  await sendSpeakerReviewDigest(f.env, morning);
  const message = f.messages[0];
  assert.equal(message.to, "info@sdlcai.org");
  assert.equal(message.from.email, "info@sdlcai.org");
  assert.match(message.text, /Current: Mystery talk/u);
  assert.match(message.text, /Proposed: A speaker's updated talk title/u);
  assert.match(message.html, /Review and approve/u);
  const url = reviewUrl(message);
  const ticket = await f.db
    .prepare("SELECT * FROM speaker_review_tokens")
    .first();
  assert.ok(
    !JSON.stringify(ticket).includes(url.split("/").at(-1)),
    "raw capability is not stored",
  );
  assert.equal(ticket.expires_at, later(24 * 7).toISOString());
  const page = await handleSpeakerEmailReview(new Request(url), f.env);
  assert.equal(page.status, 200);
  for (const [key, expected] of [
    ["cache-control", "no-store"],
    ["referrer-policy", "no-referrer"],
    ["x-robots-tag", "noindex, nofollow, noarchive"],
  ]) {
    assert.equal(page.headers.get(key), expected);
  }
  assert.match(
    page.headers.get("content-security-policy"),
    /form-action 'self'/u,
  );
  assert.equal(
    page.headers.get("set-cookie"),
    null,
    "email approval does not create an admin session",
  );
  const html = await page.text();
  assert.match(html, /Currently published/u);
  assert.match(html, /Approve and publish changes/u);
  const hash = html.match(/name="content_hash" value="([a-f0-9]+)"/u)[1];
  const head = await handleSpeakerEmailReview(
    new Request(url, { method: "HEAD" }),
    f.env,
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await f.canonical()).contentVersion, 1);
  assert.equal((await f.revision(revision)).state, "submitted");
  for (const requestOrigin of [null, "https://attacker.example"]) {
    assert.equal((await f.approve(url, hash, requestOrigin)).status, 403);
  }
  assert.equal((await f.approve(url, "wrong")).status, 409);
  assert.equal((await f.approve(url, hash)).status, 200);
  assert.equal((await f.canonical()).contentVersion, 2);
  assert.equal(
    (await f.canonical()).content.talks[0].title,
    "A speaker's updated talk title",
  );
  const reviewed = await f.revision(revision);
  assert.equal(reviewed.state, "approved");
  assert.equal(reviewed.reviewed_by, "email:info@sdlcai.org");
  assert.equal((await f.approve(url, hash)).status, 410);
  assert.equal(
    (await handleSpeakerEmailReview(new Request(url), f.env)).status,
    410,
  );
  await sendSpeakerReviewDigest(f.env, later(24));
  assert.equal(
    f.messages.length,
    1,
    "approved work is absent from subsequent digests",
  );
});

test("forged, expired, changed and stale approvals cannot publish", async (t) => {
  const f = await fixture(t);
  const id = await f.submit();
  await sendSpeakerReviewDigest(f.env, morning);
  const url = reviewUrl(f.messages[0]);
  const ticket = await f.db
    .prepare("SELECT * FROM speaker_review_tokens")
    .first();
  assert.equal(
    (
      await handleSpeakerEmailReview(
        new Request(`${origin}/speaker-review/${"a".repeat(43)}`),
        f.env,
      )
    ).status,
    410,
  );
  await f.db
    .prepare(
      "UPDATE speaker_review_tokens SET expires_at='2000-01-01T00:00:00Z'",
    )
    .run();
  assert.equal((await f.approve(url, ticket.content_hash)).status, 410);
  await f.db
    .prepare("UPDATE speaker_review_tokens SET expires_at=?1")
    .bind(ticket.expires_at)
    .run();
  await f.db
    .prepare(
      "UPDATE canonical_speaker_content SET content_version=2 WHERE speaker_id='mo-khazali'",
    )
    .run();
  assert.equal((await f.approve(url, ticket.content_hash)).status, 409);
  await f.db
    .prepare(
      "UPDATE canonical_speaker_content SET content_version=1 WHERE speaker_id='mo-khazali'",
    )
    .run();
  await f.db
    .prepare(
      "UPDATE speaker_content_revisions SET content_json=replace(content_json, 'updated talk', 'different talk') WHERE revision_id=?1",
    )
    .bind(id)
    .run();
  assert.equal((await f.approve(url, ticket.content_hash)).status, 410);
  assert.equal((await f.canonical()).contentVersion, 1);
  assert.equal((await f.revision(id)).state, "submitted");
});

test("overlapping digests and repeated cron events deliver once per day", async (t) => {
  const f = await fixture(t);
  await f.submit();
  await Promise.all([
    sendSpeakerReviewDigest(f.env, morning),
    sendSpeakerReviewDigest(f.env, morning),
  ]);
  await sendSpeakerReviewDigest(f.env, later(1));
  assert.equal(f.messages.length, 1);
  await sendSpeakerReviewDigest(f.env, later(24));
  assert.equal(
    f.messages.length,
    2,
    "pending work is included as a daily reminder",
  );
  const firstUrl = reviewUrl(f.messages[0]);
  const hash = (
    await f.db
      .prepare("SELECT content_hash FROM speaker_review_tokens LIMIT 1")
      .first()
  ).content_hash;
  const responses = await Promise.all([
    f.approve(firstUrl, hash),
    f.approve(reviewUrl(f.messages[1]), hash),
  ]);
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    1,
  );
  assert.ok(responses.some((response) => [409, 410].includes(response.status)));
  assert.equal((await f.canonical()).contentVersion, 2);
});

test("delivery failures retry after the lease and never resend a completed digest", async (t) => {
  const f = await fixture(t);
  await f.submit();
  const send = f.env.EMAIL.send;
  f.env.EMAIL.send = async () => {
    throw new Error("simulated provider failure");
  };
  await assert.rejects(
    sendSpeakerReviewDigest(f.env, morning),
    /later hourly trigger/u,
  );
  assert.equal(
    (await f.db.prepare("SELECT status FROM speaker_review_digests").first())
      .status,
    "failed",
  );
  f.env.EMAIL.send = send;
  await sendSpeakerReviewDigest(f.env, morning);
  assert.equal(f.messages.length, 0, "same-event retry respects the lease");
  await sendSpeakerReviewDigest(f.env, later(1));
  await sendSpeakerReviewDigest(f.env, later(2));
  assert.equal(f.messages.length, 1);
  const row = await f.db
    .prepare("SELECT * FROM speaker_review_digests")
    .first();
  assert.equal(row.attempts, 2);
  assert.equal(row.message_id, "local-test-message");
});

test("snapshot and token guards remain effective inside the approval transaction", async (t) => {
  const f = await fixture(t);
  const id = await f.submit();
  await sendSpeakerReviewDigest(f.env, morning);
  const ticket = await f.db
    .prepare("SELECT * FROM speaker_review_tokens")
    .first();
  const guardedEnv = {
    ...f.env,
    INTERESTS: {
      prepare: (...args) => f.db.prepare(...args),
      batch: async (statements) => {
        await f.db
          .prepare(
            "UPDATE speaker_content_revisions SET content_json=replace(content_json, 'updated talk', 'changed talk') WHERE revision_id=?1",
          )
          .bind(id)
          .run();
        await f.db.prepare("DELETE FROM speaker_review_tokens").run();
        return f.db.batch(statements);
      },
    },
  };
  assert.equal(
    (
      await f.approve(
        reviewUrl(f.messages[0]),
        ticket.content_hash,
        origin,
        guardedEnv,
      )
    ).status,
    409,
  );
  assert.equal((await f.canonical()).contentVersion, 1);
  assert.equal((await f.revision(id)).state, "submitted");
});

test("stale submissions still notify the organizer but cannot offer an email approval", async (t) => {
  const f = await fixture(t);
  await f.submit();
  await f.db
    .prepare(
      "UPDATE canonical_speaker_content SET content_version=2 WHERE speaker_id='mo-khazali'",
    )
    .run();
  await sendSpeakerReviewDigest(f.env, morning);
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].text, /Review in admin/u);
  assert.doesNotMatch(f.messages[0].text, /\/speaker-review\//u);
  assert.equal(await f.count("speaker_review_tokens"), 0);
});

test("disabled digests do nothing and cleanup removes old links and delivery records", async (t) => {
  const f = await fixture(t);
  await f.submit();
  await sendSpeakerReviewDigest(
    { ...f.env, SPEAKER_REVIEW_DIGEST_ENABLED: "false" },
    morning,
  );
  assert.equal(await f.count("speaker_review_digests"), 0);
  await sendSpeakerReviewDigest(f.env, morning);
  const url = reviewUrl(f.messages[0]);
  assert.equal(
    (
      await handleSpeakerEmailReview(new Request(url), {
        ...f.env,
        SPEAKER_REVIEW_DIGEST_ENABLED: "false",
      })
    ).status,
    503,
  );
  await purgeSpeakerReviewDigests(f.env, later(24 * 8));
  assert.equal(await f.count("speaker_review_tokens"), 0);
  assert.equal(await f.count("speaker_review_digests"), 1);
  await purgeSpeakerReviewDigests(f.env, later(24 * 31));
  assert.equal(await f.count("speaker_review_digests"), 0);
});

test("email escapes untrusted text and marks truncated description excerpts", () => {
  const message = speakerReviewDigestEmail(
    [
      {
        name: '<script>alert("speaker")</script>',
        reviewUrl: `${origin}/speaker-review/example`,
        conflict: false,
        changes: [
          {
            field: "talks.example.abstract",
            before: "Previous text",
            value: '<img src=x onerror="alert(1)">' + "Long text ".repeat(100),
          },
        ],
      },
    ],
    "2026-09-17",
    `${origin}/admin/speakers/`,
  );
  assert.doesNotMatch(message.html, /<script>|<img src=x/u);
  assert.match(message.html, /&lt;img/u);
  assert.match(message.text, /Full text in review/u);
  assert.match(message.html, /Talk description/u);
});

function reviewUrl(message) {
  return message.text.match(
    /https:\/\/sdlcai\.org\/speaker-review\/[A-Za-z0-9_-]{43}/u,
  )[0];
}

async function fixture(t) {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-04-30",
    d1Databases: ["INTERESTS"],
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS");
  for (const migration of migrations) {
    for (const sql of migration
      .split(/;\s*\n/u)
      .map((part) => part.trim())
      .filter(Boolean)) {
      await db.prepare(sql).run();
    }
  }
  const messages = [];
  const env = {
    INTERESTS: db,
    EMAIL_ENCRYPTION_KEY: "local-review-digest-test-key",
    PUBLIC_SITE_ORIGIN: origin,
    SPEAKER_REVIEW_DIGEST_ENABLED: "true",
    EMAIL: {
      send: async (message) => {
        messages.push(message);
        return { messageId: "local-test-message" };
      },
    },
  };
  async function submit({ speaker = "mo-khazali", state = "submitted" } = {}) {
    const canonical = await readCanonicalSpeaker(env, speaker);
    const content = structuredClone(canonical.content);
    content.talks[0].title = "A speaker's updated talk title";
    content.talks[0].abstract =
      "An updated description explaining what attendees will learn from this talk.";
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO speaker_content_revisions (revision_id,speaker_id,base_content_hash,base_content_version,content_json,state,submitted_at,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?7,?7)`,
      )
      .bind(
        id,
        speaker,
        await hashCanonicalContent(canonical.content),
        canonical.contentVersion,
        JSON.stringify(content),
        state,
        morning.toISOString(),
      )
      .run();
    return id;
  }
  async function approve(url, hash, requestOrigin = origin, targetEnv = env) {
    const headers = requestOrigin ? { origin: requestOrigin } : {};
    return handleSpeakerEmailReview(
      new Request(url, {
        method: "POST",
        headers,
        body: new URLSearchParams({ decision: "approve", content_hash: hash }),
      }),
      targetEnv,
    );
  }
  return {
    db,
    env,
    messages,
    submit,
    approve,
    count: async (table) =>
      (await db.prepare(`SELECT count(*) AS count FROM ${table}`).first())
        .count,
    canonical: () => readCanonicalSpeaker(env, "mo-khazali"),
    revision: (id) =>
      db
        .prepare("SELECT * FROM speaker_content_revisions WHERE revision_id=?1")
        .bind(id)
        .first(),
  };
}
