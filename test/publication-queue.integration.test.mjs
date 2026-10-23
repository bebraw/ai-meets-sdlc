import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import drafts from "../production/content-inventory/2026/distribution-drafts.json" with { type: "json" };
import { backupPublicationQueue } from "../worker/backups.ts";
import { createWorkerFixture } from "./helpers/worker-fixture.mjs";

const origin = "https://sdlcai.org";
const endpoint = `${origin}/api/admin/publication-queue`;
const authorization = `Basic ${Buffer.from("publication-admin:publication-test-password").toString("base64")}`;
const headers = {
  authorization,
  origin,
  "content-type": "application/json",
  "x-admin-action": "manage-publications",
};
const edit = ({
  id,
  revision,
  title,
  subtitle,
  summary,
  body,
  altText,
  notes,
  status,
  publicationDate,
  publicationUrl,
  graphicFormat,
}) => ({
  id,
  revision,
  title,
  subtitle,
  summary,
  body,
  altText,
  notes,
  status,
  publicationDate,
  publicationUrl,
  graphicFormat,
});

test("publication drafts stay protected, persist edits, isolate events and reject stale saves", async (t) => {
  const fixture = await createWorkerFixture({
    vars: {
      ADMIN_USERNAME: "publication-admin",
      ADMIN_PASSWORD: "publication-test-password",
      TURNSTILE_SITE_KEY: "",
    },
  });
  t.after(() => fixture.dispose());
  const { worker, runSql, env } = fixture;
  const list = async () => {
    const response = await worker.fetch(endpoint, { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    return (await response.json()).items;
  };
  const save = (data, requestHeaders = headers) =>
    worker.fetch(endpoint, {
      method: "PUT",
      headers: requestHeaders,
      body: JSON.stringify(data),
    });

  await t.test("auth, discovery and original five drafts", async () => {
    assert.equal((await worker.fetch(endpoint)).status, 401);
    for (const path of [
      "/admin/publication-queue/",
      "/admin/publication-queue/index.html",
      "/%61dmin/publication-queue/",
    ]) {
      let response = await worker.fetch(origin + path, {
        redirect: "manual",
      });
      if ([307, 308].includes(response.status)) {
        const location = new URL(response.headers.get("location"), origin);
        assert.ok(location.pathname.startsWith("/admin/"));
        response = await worker.fetch(location.href, { redirect: "manual" });
      }
      assert.ok(
        [303, 404].includes(response.status),
        `${path}: ${response.status}`,
      );
      assert.ok(
        !(await response.text()).includes(drafts.linkedinPosts[0].copy),
      );
    }
    const page = await worker.fetch(origin + "/admin/publication-queue/", {
      headers,
    });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("x-robots-tag"), /noindex/);
    assert.match(await page.text(), /data-publication-queue/);
    const items = await list();
    assert.equal(items.length, 5);
    assert.deepEqual(
      items.map((i) => i.channel),
      ["linkedin", "linkedin", "linkedin", "website", "newsletter"],
    );
    assert.ok(
      items.every(
        (i) => i.eventId === "2026" && i.status === "draft" && i.revision === 1,
      ),
    );
    for (const post of drafts.linkedinPosts) {
      const item = items.find((i) => i.id === post.id);
      assert.equal(item.body, post.copy);
      assert.equal(item.altText, post.altText);
      assert.equal(item.assets.length, 2);
      assert.ok(item.sources.some((s) => s.url === post.summaryUrl));
    }
    assert.equal(items[3].body, drafts.announcement.body);
    assert.equal(items[4].title, drafts.newsletter.subject);
    assert.equal(items[4].subtitle, drafts.newsletter.preheader);
    for (const file of await readdir("build/assets"))
      if (file.endsWith(".js"))
        assert.ok(
          !(await readFile(`build/assets/${file}`, "utf8")).includes(
            drafts.linkedinPosts[0].copy,
          ),
        );
    assert.ok(
      !(await readFile("build/sitemap.xml", "utf8")).includes(
        "/admin/publication-queue/",
      ),
    );
  });

  await t.test("validation and event isolation", async () => {
    const original = edit((await list())[0]);
    assert.equal((await save(original, {})).status, 401);
    assert.equal(
      (await save(original, { ...headers, origin: "https://attacker.example" }))
        .status,
      403,
    );
    assert.equal(
      (await save(original, { ...headers, "x-admin-action": "wrong" })).status,
      403,
    );
    assert.equal(
      (await worker.fetch(endpoint, { method: "POST", headers, body: "{}" }))
        .status,
      405,
    );
    assert.equal(
      (await worker.fetch(endpoint, { method: "PUT", headers, body: "{" }))
        .status,
      400,
    );
    assert.equal(
      (
        await worker.fetch(endpoint, {
          method: "PUT",
          headers,
          body: JSON.stringify({ body: "x".repeat(66000) }),
        })
      ).status,
      413,
    );
    for (const change of [
      { revision: 0 },
      { revision: 1.5 },
      { eventId: "2027" },
      { channel: "newsletter" },
      { status: "sent" },
      { title: " " },
      { body: "" },
      { graphicFormat: "square" },
      { publicationDate: "2026-02-30" },
      { publicationUrl: "javascript:alert(1)" },
      { publicationUrl: "http://example.org" },
      { publicationUrl: "https://user:password@example.org" },
      { status: "scheduled" },
      { status: "published", publicationDate: "2026-10-23" },
    ])
      assert.equal(
        (await save({ ...original, ...change })).status,
        400,
        JSON.stringify(change),
      );
    assert.equal(
      (await save({ ...original, id: "unknown-draft" })).status,
      404,
    );
    await runSql(
      "INSERT INTO publication_queue (event_id,id,channel,position,title,body) VALUES ('2027','delivery-01','linkedin',1,'Private 2027 draft','Future event copy')",
    );
    assert.equal((await list()).length, 5);
    assert.equal(
      (await worker.fetch(endpoint + "?event=2027", { headers })).status,
      404,
    );
    assert.equal(
      (
        await worker.fetch(endpoint + "?event=2027", {
          method: "PUT",
          headers,
          body: JSON.stringify(original),
        })
      ).status,
      404,
    );
    assert.equal((await list())[0].revision, 1);
  });

  await t.test(
    "saved copy, publication tracking and concurrent editors",
    async () => {
      let item = (await list())[0];
      const response = await save({
        ...edit(item),
        body: "Edited copy <script>window.injected=true</script>",
        altText: "Edited alt text",
        notes: "Editorial note",
        graphicFormat: "landscape",
        status: "ready",
      });
      assert.equal(response.status, 200);
      item = (await response.json()).item;
      assert.equal(item.revision, 2);
      assert.equal(item.graphicFormat, "landscape");
      assert.equal((await list())[0].body, item.body);
      const competing = await Promise.all([
        save({ ...edit(item), body: "Editor A" }),
        save({ ...edit(item), body: "Editor B" }),
      ]);
      assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
      const winner = (await competing.find((r) => r.status === 200).json())
        .item;
      const conflict = await competing.find((r) => r.status === 409).json();
      assert.equal(conflict.current.body, winner.body);
      assert.equal(winner.revision, 3);
      const published = await save({
        ...edit(winner),
        status: "published",
        publicationDate: "2026-10-23",
        publicationUrl: "https://www.linkedin.com/feed/update/test-publication",
      });
      assert.equal(published.status, 200);
      const saved = (await published.json()).item;
      assert.equal(saved.publicationDate, "2026-10-23");
      assert.equal((await list())[0].publicationUrl, saved.publicationUrl);
      const newsletter = (await list()).find((i) => i.channel === "newsletter");
      assert.equal(
        (
          await save({
            ...edit(newsletter),
            title: "Updated subject",
            subtitle: "Updated preheader",
            status: "published",
            publicationDate: "2026-10-23",
          })
        ).status,
        200,
      );
      const future = await runSql(
        "SELECT body FROM publication_queue WHERE event_id='2027' AND id='delivery-01'",
      );
      assert.equal(future[0].body, "Future event copy");
      const events = await runSql(
        "SELECT category FROM activity_events WHERE category='Publication queue'",
      );
      assert.equal(events.length, 4);
    },
  );

  await t.test("recovery snapshots preserve the edited drafts", async () => {
    await backupPublicationQueue(env);
    const manifest = await (
      await env.INTEREST_BACKUPS.get("publications/latest.json")
    ).json();
    const snapshot = await (
      await env.INTEREST_BACKUPS.get(manifest.key)
    ).json();
    assert.equal(snapshot.rows.length, 6);
    assert.equal(
      snapshot.rows.find((i) => i.event_id === "2026" && i.id === "delivery-01")
        .status,
      "published",
    );
    assert.equal(
      snapshot.rows.find(
        (i) => i.event_id === "2026" && i.id === "archive-newsletter",
      ).title,
      "Updated subject",
    );
    await backupPublicationQueue(env);
    assert.equal(
      (await env.INTEREST_BACKUPS.list({ prefix: "publications/" })).objects
        .length,
      2,
    );
  });
});
