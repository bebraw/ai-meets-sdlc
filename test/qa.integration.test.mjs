import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { unstable_dev } from "wrangler";

const execute = promisify(execFile);
const origin = "https://sdlcai.org";
const adminAuthorization = `Basic ${Buffer.from("qa-test-admin:qa-test-password").toString("base64")}`;
const firstRoom = "industry-perspectives-morning";
const secondRoom = "views-from-academia";

test("QA rooms, moderation, reusable role links, and revocation", async (t) => {
  const persistenceDirectory = await mkdtemp(path.join(tmpdir(), "sdlcai-qa-"));
  t.after(() => rm(persistenceDirectory, { force: true, recursive: true }));
  await execute(path.resolve("node_modules/.bin/wrangler"), [
    "d1",
    "migrations",
    "apply",
    "ai-meets-sdlc-interests",
    "--local",
    "--persist-to",
    persistenceDirectory,
  ]);
  let worker;
  const start = async () => {
    worker = await unstable_dev("worker/index.ts", {
      config: "wrangler.jsonc",
      local: true,
      logLevel: "error",
      persist: true,
      persistTo: persistenceDirectory,
      experimental: { disableExperimentalWarning: true, forceLocal: true },
      vars: {
        ADMIN_USERNAME: "qa-test-admin",
        ADMIN_PASSWORD: "qa-test-password",
        EMAIL_ENCRYPTION_KEY: "qa-test-encryption",
        TURNSTILE_SITE_KEY: "",
      },
    });
  };
  await start();
  t.after(() => worker.stop());
  const client = (admin = false) => {
    const cookies = new Map();
    return {
      cookies,
      async fetch(url, options = {}) {
        const headers = new Headers(options.headers);
        if (admin) headers.set("authorization", adminAuthorization);
        if (cookies.size)
          headers.set(
            "cookie",
            [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          );
        const response = await worker.fetch(`${origin}${url}`, {
          ...options,
          headers,
          redirect: "manual",
        });
        for (const entry of response.headers.getSetCookie()) {
          const [pair] = entry.split(";");
          const equals = pair.indexOf("=");
          cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
        }
        return response;
      },
      async post(url, body, headers = {}) {
        return this.fetch(url, {
          method: "POST",
          headers: {
            origin,
            accept: "application/json",
            "content-type": "application/json",
            ...headers,
          },
          body: JSON.stringify(body),
        });
      },
      async snapshot() {
        const response = await this.fetch("/api/qa/snapshot");
        assert.equal(response.status, 200);
        return response.json();
      },
    };
  };
  const admin = client(true),
    alice = client(),
    bob = client(),
    moderator = client(),
    mc = client(),
    secondMc = client();
  let questionId, moderatorGrant, mcGrant;
  const adminAction = async (body) => {
    const response = await admin.post("/api/admin/qa", body);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const selectRoom = async (roomId) => {
    const data = await (await admin.fetch("/api/admin/qa")).json();
    return adminAction({
      action: "active-room",
      roomId,
      settingsRevision: data.settings.revision,
    });
  };
  const createGrant = async (label, role) => {
    await adminAction({ action: "create-grant", label, role });
    const data = await (await admin.fetch("/api/admin/qa")).json();
    return data.grants.find((grant) => grant.label === label);
  };
  const redeem = async (browser, grant) => {
    const token = new URLSearchParams(new URL(grant.link).hash.slice(1)).get(
      "token",
    );
    const response = await browser.post("/qa/access/", { token });
    assert.equal(response.status, 303);
    // Wrangler's local transport is HTTP; production HTTPS cookie attributes
    // and the signed participant boundary are exercised in qa-auth.test.mjs.
    assert.match(
      response.headers.get("set-cookie"),
      /HttpOnly.*SameSite=Strict/,
    );
  };
  const ask = async (
    browser,
    text,
    roomId = firstRoom,
    requestId = crypto.randomUUID(),
  ) => {
    await browser.snapshot();
    return browser.post("/qa/", { action: "add", text, roomId, requestId });
  };

  await t.test("starts closed and protects admin and role views", async () => {
    assert.equal((await alice.snapshot()).room, null);
    assert.equal((await alice.fetch("/api/admin/qa")).status, 401);
    assert.equal((await alice.fetch("/qa/moderate/")).status, 303);
    assert.equal((await alice.fetch("/qa/mc/")).status, 303);
    assert.equal((await alice.fetch("/qa/screen/")).status, 200);
    assert.equal((await alice.fetch("/qa/unknown/")).status, 404);
    await selectRoom(firstRoom);
    await adminAction({ action: "status", roomId: firstRoom, status: "open" });
  });
  await t.test(
    "links are reusable, recovered for admins, and scoped to their roles",
    async () => {
      moderatorGrant = await createGrant("Desk team", "moderator");
      mcGrant = await createGrant("Stage team", "mc");
      assert.match(new URL(mcGrant.link).hash, /^#token=/);
      assert.equal(new URL(mcGrant.link).search, "");
      const before = await alice.fetch("/qa/access/");
      assert.equal(
        before.headers.get("set-cookie"),
        null,
        "GET does not sign staff in",
      );
      await redeem(moderator, moderatorGrant);
      await redeem(mc, mcGrant);
      await redeem(secondMc, mcGrant);
      const recovered = await (await admin.fetch("/api/admin/qa")).json();
      assert.equal(
        recovered.grants.find((grant) => grant.id === mcGrant.id).link,
        mcGrant.link,
      );
      assert.equal((await mc.fetch("/api/admin/qa")).status, 401);
      assert.equal((await moderator.fetch("/qa/mc/")).status, 303);
      assert.equal((await mc.fetch("/qa/moderate/")).status, 303);
    },
  );
  await t.test(
    "pending questions are private and repeated submissions are idempotent",
    async () => {
      const requestId = crypto.randomUUID();
      assert.equal(
        (
          await ask(
            alice,
            "How do we verify generated code?",
            firstRoom,
            requestId,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await ask(
            alice,
            "How do we verify generated code?",
            firstRoom,
            requestId,
          )
        ).status,
        200,
      );
      const own = await alice.snapshot();
      assert.equal(own.snapshot.questions.length, 1);
      questionId = own.snapshot.questions[0].id;
      assert.equal(own.snapshot.questions[0].status, "pending");
      assert.equal((await bob.snapshot()).snapshot.questions.length, 0);
      assert.equal(
        (
          await (
            await mc.fetch("/qa/mc/", { headers: { "x-qa-fragment": "1" } })
          ).text()
        ).includes("How do we verify"),
        false,
      );
      const html = await (await alice.fetch("/qa/")).text();
      assert.match(html, /Under consideration/);
      assert.match(html, /How do we verify generated code/);
      assert.doesNotMatch(
        JSON.stringify(own),
        /participant_key|token_hash|voter_key/,
      );
    },
  );
  await t.test("moderators approve; attendees and MCs cannot", async () => {
    const unauthorized = await alice.post("/qa/moderate/", {
      action: "approve",
      roomId: firstRoom,
      questionId,
      revision: 1,
      role: "admin",
    });
    assert.equal(unauthorized.status, 403);
    const wrongRole = await mc.post("/qa/moderate/", {
      action: "approve",
      roomId: firstRoom,
      questionId,
      revision: 1,
    });
    assert.equal(wrongRole.status, 403);
    const response = await moderator.post("/qa/moderate/", {
      action: "approve",
      roomId: firstRoom,
      questionId,
      revision: 1,
    });
    assert.equal(response.status, 200);
    assert.equal(
      (await bob.snapshot()).snapshot.questions[0].status,
      "approved",
    );
  });
  await t.test(
    "votes are per question, deduplicated, and reject self voting",
    async () => {
      const vote = { action: "vote", roomId: firstRoom, questionId };
      assert.equal((await alice.post("/qa/", vote)).status, 400);
      const results = await Promise.all([
        bob.post("/qa/", vote),
        bob.post("/qa/", vote),
      ]);
      assert.deepEqual(
        results.map((response) => response.status),
        [200, 200],
      );
      assert.equal((await bob.snapshot()).snapshot.questions[0].votes, 1);
      assert.equal((await bob.snapshot()).snapshot.questions[0].voted, true);
    },
  );
  await t.test(
    "MC selection is atomic and stale tabs cannot answer a different question",
    async () => {
      const select = {
        action: "select",
        roomId: firstRoom,
        questionId,
        expectedActiveId: "",
      };
      assert.equal((await moderator.post("/qa/mc/", select)).status, 403);
      assert.equal((await mc.post("/qa/mc/", select)).status, 200);
      assert.equal((await secondMc.post("/qa/mc/", select)).status, 409);
      assert.match(
        await (await alice.fetch("/qa/screen/")).text(),
        /How do we verify generated code/,
      );
      assert.equal(
        (
          await mc.post("/qa/mc/", {
            ...select,
            action: "done",
            expectedActiveId: questionId,
          })
        ).status,
        200,
      );
      assert.doesNotMatch(
        await (await alice.fetch("/qa/screen/")).text(),
        /How do we verify generated code/,
      );
      assert.equal((await bob.snapshot()).snapshot.questions.length, 0);
      const csv = await admin.fetch(`/api/admin/qa/export?room=${firstRoom}`);
      assert.match(await csv.text(), /answered/);
    },
  );
  await t.test(
    "room switching preserves history and rejects submissions for the old session",
    async () => {
      await selectRoom(secondRoom);
      await adminAction({
        action: "status",
        roomId: secondRoom,
        status: "open",
      });
      assert.equal((await bob.snapshot()).snapshot.questions.length, 0);
      const old = await ask(
        alice,
        "This draft belongs to the morning session.",
      );
      assert.equal(old.status, 409);
      assert.equal(
        (await ask(bob, "How should we measure AI adoption?", secondRoom))
          .status,
        200,
      );
      const original = await (
        await admin.fetch(`/api/admin/qa?room=${firstRoom}`)
      ).json();
      assert.equal(original.snapshot.questions.length, 1);
      assert.equal(original.snapshot.questions[0].status, "answered");
      const stale = await admin.post("/api/admin/qa", {
        action: "active-room",
        roomId: firstRoom,
        settingsRevision: 0,
      });
      assert.equal(stale.status, 409);
    },
  );
  await t.test(
    "origin checks, body limits, and escaped question text",
    async () => {
      const crossSite = await alice.post(
        "/qa/",
        { action: "vote", roomId: secondRoom, questionId },
        { origin: "https://attacker.example" },
      );
      assert.equal(crossSite.status, 403);
      const missingOrigin = await alice.fetch("/qa/", {
        method: "POST",
        body: "action=add",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      assert.equal(missingOrigin.status, 403);
      const oversize = await alice.post("/qa/", { text: "x".repeat(13000) });
      assert.equal(oversize.status, 413);
      const response = await moderator.post("/qa/moderate/", {
        action: "add",
        roomId: secondRoom,
        text: "Could <script>alert('test')</script> be unsafe?",
        requestId: crypto.randomUUID(),
      });
      assert.equal(response.status, 200);
      const html = await (await alice.fetch("/qa/")).text();
      assert.match(html, /&lt;script&gt;/);
      assert.doesNotMatch(html, /<script>alert/);
      assert.equal((await mc.post("/qa/screen/", {})).status, 405);
    },
  );
  await t.test(
    "moderation rejects stale edits and hiding removes an active screen question",
    async () => {
      const snapshot = (await alice.snapshot()).snapshot;
      const question = snapshot.questions.find(
        (item) => item.status === "approved",
      );
      assert.equal(
        (
          await mc.post("/qa/mc/", {
            action: "select",
            roomId: secondRoom,
            questionId: question.id,
            expectedActiveId: "",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await moderator.post("/qa/moderate/", {
            action: "edit",
            roomId: secondRoom,
            questionId: question.id,
            revision: question.revision,
            text: "Could scripts in audience questions be unsafe?",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await moderator.post("/qa/moderate/", {
            action: "hide",
            roomId: secondRoom,
            questionId: question.id,
            revision: question.revision,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await moderator.post("/qa/moderate/", {
            action: "hide",
            roomId: secondRoom,
            questionId: question.id,
            revision: question.revision + 1,
          })
        ).status,
        200,
      );
      assert.match(
        await (await alice.fetch("/qa/screen/")).text(),
        /Waiting for the next question/,
      );
    },
  );
  await t.test(
    "pause and archive preserve questions and stop attendee changes",
    async () => {
      await adminAction({
        action: "status",
        roomId: secondRoom,
        status: "paused",
      });
      assert.equal(
        (await ask(alice, "Can I submit while this is paused?", secondRoom))
          .status,
        409,
      );
      await adminAction({
        action: "status",
        roomId: secondRoom,
        status: "archived",
      });
      assert.equal(
        (
          await moderator.post("/qa/moderate/", {
            action: "status",
            roomId: secondRoom,
            status: "open",
          })
        ).status,
        403,
      );
      assert.equal(
        (await admin.fetch(`/api/admin/qa/export?room=${secondRoom}`)).status,
        200,
      );
    },
  );
  await t.test("state and access survive a Worker restart", async () => {
    await worker.stop();
    await start();
    const data = await (
      await admin.fetch(`/api/admin/qa?room=${firstRoom}`)
    ).json();
    assert.equal(data.snapshot.questions[0].status, "answered");
    assert.equal((await mc.fetch("/qa/mc/")).status, 200);
  });
  await t.test(
    "signing out does not consume the reusable link; revocation ends all its sessions",
    async () => {
      assert.equal((await mc.post("/qa/logout/", {})).status, 303);
      assert.equal((await mc.fetch("/qa/mc/")).status, 303);
      await redeem(mc, mcGrant);
      await adminAction({ action: "revoke-grant", grantId: mcGrant.id });
      assert.equal((await mc.fetch("/qa/mc/")).status, 303);
      assert.equal((await secondMc.fetch("/qa/mc/")).status, 303);
      assert.equal(
        (
          await mc.post("/qa/mc/", {
            action: "select",
            roomId: firstRoom,
            questionId,
            expectedActiveId: "",
          })
        ).status,
        403,
      );
      const token = new URLSearchParams(
        new URL(mcGrant.link).hash.slice(1),
      ).get("token");
      assert.equal((await secondMc.post("/qa/access/", { token })).status, 401);
      assert.equal((await moderator.fetch("/qa/moderate/")).status, 200);
    },
  );
  await t.test(
    "creating rooms is safe and reset requires admin confirmation",
    async () => {
      await adminAction({ action: "create-room", title: "Closing panel" });
      const data = await (await admin.fetch("/api/admin/qa")).json();
      assert.equal(
        data.rooms.find((room) => room.title === "Closing panel").snapshot
          .status,
        "paused",
      );
      assert.equal(
        (
          await moderator.post("/qa/moderate/", {
            action: "reset",
            roomId: firstRoom,
            confirmation: "CLEAR",
            revision: 0,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await admin.post("/api/admin/qa", {
            action: "reset",
            roomId: firstRoom,
            confirmation: "CLEAR",
            revision: 0,
          })
        ).status,
        409,
      );
      const original = await (
        await admin.fetch(`/api/admin/qa?room=${firstRoom}`)
      ).json();
      await adminAction({
        action: "reset",
        roomId: firstRoom,
        confirmation: "CLEAR",
        revision: original.snapshot.revision,
      });
      const cleared = await (
        await admin.fetch(`/api/admin/qa?room=${firstRoom}`)
      ).json();
      assert.equal(cleared.snapshot.questions.length, 0);
      assert.equal(cleared.snapshot.status, "paused");
      const history = await (
        await admin.fetch(`/api/admin/qa/history?room=${firstRoom}`)
      ).json();
      assert.equal(history.history[0].action, "cleared");
      assert.doesNotMatch(
        JSON.stringify(history),
        /How do we verify|qa-test-encryption/,
      );
    },
  );
  await t.test(
    "live events announce room changes without carrying private content",
    async () => {
      const response = await alice.fetch("/api/qa/events");
      assert.equal(
        response.headers.get("content-type"),
        "text/event-stream; charset=utf-8",
      );
      const reader = response.body.getReader();
      assert.match(
        new TextDecoder().decode((await reader.read()).value),
        /connected/,
      );
      await selectRoom(firstRoom);
      const event = new TextDecoder().decode((await reader.read()).value);
      assert.match(event, /event: qa-change/);
      assert.doesNotMatch(event, /token|question|participant|Desk team/);
      await reader.cancel();
    },
  );
});
