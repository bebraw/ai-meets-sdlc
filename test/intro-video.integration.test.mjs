import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerFixture } from "./helpers/worker-fixture.mjs";

const origin = "https://sdlcai.org";
const prefix = "/api/admin/intro/draft-01/";
const prototypePrefix = "/api/admin/intro/prototypes-02/";
const authorization = `Basic ${Buffer.from("intro-admin:local-test-password").toString("base64")}`;

test("intro review requires admin access and streams seekable R2 assets", async (t) => {
  const fixture = await createWorkerFixture({
    vars: {
      ADMIN_USERNAME: "intro-admin",
      ADMIN_PASSWORD: "local-test-password",
      EMAIL_ENCRYPTION_KEY: "local-test-encryption-key",
      TURNSTILE_SITE_KEY: "",
    },
  });
  t.after(() => fixture.dispose());
  const { worker, env } = fixture;
  const content = "0123456789abcdefghijklmnopqrstuvwxyz";
  await env.SOCIAL_EXPORTS.put("intro/draft-01-20261010/preview.mp4", content);
  await env.SOCIAL_EXPORTS.put("intro/draft-01-20261010/4k.mp4", "4K draft");
  await env.SOCIAL_EXPORTS.put("intro/draft-01-20261010/poster.jpg", "poster");
  await env.SOCIAL_EXPORTS.put(
    "intro/draft-01-20261010/music-credit.txt",
    "music credit",
  );
  const prototypeAssets = new Map([
    ["a.mp4", `a:${content}`],
    ["b.mp4", `b:${content}`],
    ["c.mp4", `c:${content}`],
    ["a-poster.jpg", "poster A"],
    ["b-poster.jpg", "poster B"],
    ["c-poster.jpg", "poster C"],
    ["music-credit.txt", "prototype music credit"],
  ]);
  for (const [name, body] of prototypeAssets) {
    await env.SOCIAL_EXPORTS.put(`intro/prototypes-02-20261010/${name}`, body);
  }

  const protectedPage = await worker.fetch(`${origin}/admin/intro/`, {
    redirect: "manual",
  });
  assert.equal(protectedPage.status, 303);
  assert.match(
    protectedPage.headers.get("location"),
    /\/admin\/login\/\?next=/,
  );
  for (const name of [
    "preview.mp4",
    "4k.mp4",
    "poster.jpg",
    "music-credit.txt",
  ]) {
    const response = await worker.fetch(`${origin}${prefix}${name}`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const name of prototypeAssets.keys()) {
    for (const method of ["GET", "HEAD"]) {
      const response = await worker.fetch(
        `${origin}${prototypePrefix}${name}?download=1`,
        { method, headers: { range: "bytes=0-1" } },
      );
      assert.equal(response.status, 401, `${method} ${name}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  const page = await worker.fetch(`${origin}/admin/intro/`, {
    headers: { authorization },
  });
  assert.equal(page.status, 200);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const html = await page.text();
  assert.match(html, /data-intro-player/);
  assert.match(html, /Download 4K/);
  assert.match(html, /A Foolish Game/);
  assert.match(html, /The changing loop/);
  assert.match(html, /The SDLC machine/);
  assert.match(html, /Demoscene/);
  assert.match(html, /<details[^>]*data-intro-review[^>]*>/);
  assert.equal((html.match(/data-intro-player/g) || []).length, 5);
  assert.match(html, /Demoscene\. Continuous motion\./);
  assert.match(html, /<details data-intro-collapse>/);
  assert.ok(
    html.indexOf("/api/admin/intro/draft-03/preview.mp4") <
      html.indexOf("/api/admin/intro/prototypes-02/a.mp4"),
    "the full draft is featured before the comparison prototypes",
  );
  const fetchAsset = (name = "preview.mp4", options = {}) =>
    worker.fetch(`${origin}${prefix}${name}`, {
      ...options,
      headers: { cookie, ...options.headers },
    });

  const full = await fetchAsset();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "video/mp4");
  assert.equal(full.headers.get("content-length"), String(content.length));
  assert.equal(full.headers.get("accept-ranges"), "bytes");
  assert.equal(full.headers.get("cache-control"), "no-store");
  assert.match(full.headers.get("vary"), /Cookie/);
  assert.match(full.headers.get("x-robots-tag"), /noindex/);
  assert.equal(await full.text(), content);
  const etag = full.headers.get("etag");

  for (const [range, expected, bounds] of [
    ["bytes=4-9", "456789", "4-9"],
    ["bytes=30-", "uvwxyz", "30-35"],
    ["bytes=-3", "xyz", "33-35"],
    ["bytes=34-999", "yz", "34-35"],
    ["bytes=-999", content, "0-35"],
  ]) {
    const response = await fetchAsset("preview.mp4", { headers: { range } });
    assert.equal(response.status, 206, range);
    assert.equal(response.headers.get("content-range"), `bytes ${bounds}/36`);
    assert.equal(
      response.headers.get("content-length"),
      String(expected.length),
    );
    assert.equal(await response.text(), expected);
  }
  for (const range of ["bytes=36-", "bytes=10-9", "bytes=-0"]) {
    const response = await fetchAsset("preview.mp4", { headers: { range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers.get("content-range"), "bytes */36");
    assert.equal(await response.text(), "");
  }
  for (const headers of [
    { range: "invalid" },
    { range: "bytes=0-1,4-5" },
    { range: "bytes=4-9", "if-range": '"outdated"' },
    { range: "bytes=4-9", "if-range": "Thu, 01 Jan 1970 00:00:00 GMT" },
  ]) {
    const response = await fetchAsset("preview.mp4", { headers });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), content);
  }
  const matched = await fetchAsset("preview.mp4", {
    headers: { range: "bytes=0-1", "if-range": etag },
  });
  assert.equal(matched.status, 206);
  assert.equal(await matched.text(), "01");
  const head = await fetchAsset("preview.mp4", {
    method: "HEAD",
    headers: { range: "bytes=4-9" },
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "36");
  assert.equal(head.headers.get("content-range"), null);
  assert.equal(await head.text(), "");

  const download = await fetchAsset("4k.mp4?download=1");
  assert.equal(download.status, 200);
  assert.match(
    download.headers.get("content-disposition"),
    /^attachment; filename="sdlcai-intro-draft-01-4k.mp4"$/,
  );
  assert.equal(await download.text(), "4K draft");
  const credit = await fetchAsset("music-credit.txt");
  assert.equal(credit.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await credit.text(), "music credit");
  for (const name of [
    "unknown.mp4",
    "other-file.txt",
    "../draft-02/preview.mp4",
  ]) {
    assert.equal((await fetchAsset(name)).status, 404);
  }
  const post = await fetchAsset("preview.mp4", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  await env.SOCIAL_EXPORTS.delete("intro/draft-01-20261010/preview.mp4");
  assert.equal((await fetchAsset()).status, 404);

  const fetchPrototype = (name, options = {}) =>
    worker.fetch(`${origin}${prototypePrefix}${name}`, {
      ...options,
      // Request the stored bytes so transport compression cannot change length.
      headers: { cookie, "accept-encoding": "identity", ...options.headers },
    });
  for (const [name, body] of prototypeAssets) {
    const response = await fetchPrototype(name);
    assert.equal(response.status, 200, name);
    assert.equal(await response.text(), body, name);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("vary"), /Cookie/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.equal(
      response.headers.get("content-type"),
      name.endsWith(".mp4")
        ? "video/mp4"
        : name.endsWith(".jpg")
          ? "image/jpeg"
          : "text/plain; charset=utf-8",
    );
  }
  for (const code of ["a", "b", "c"]) {
    const name = `${code}.mp4`;
    const body = prototypeAssets.get(name);
    const ranged = await fetchPrototype(name, {
      headers: { range: "bytes=2-7" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), "bytes 2-7/38");
    assert.equal(await ranged.text(), body.slice(2, 8));
    const head = await fetchPrototype(name, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "38");
    assert.equal(await head.text(), "");
    const invalidRange = await fetchPrototype(name, {
      headers: { range: "bytes=38-" },
    });
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers.get("content-range"), "bytes */38");
    const download = await fetchPrototype(`${name}?download=1`);
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-disposition"),
      `attachment; filename="sdlcai-intro-prototype-${code}-1080p.mp4"`,
    );
    assert.equal(await download.text(), body);
  }
  // A stored object remains private unless its exact route is allowlisted.
  await env.SOCIAL_EXPORTS.put(
    "intro/prototypes-02-20261010/private-notes.txt",
    "not a review asset",
  );
  for (const name of [
    "private-notes.txt",
    "unknown.mp4",
    "a.mp4/extra",
    "A.mp4",
    "%61.mp4",
    "../prototypes-03/a.mp4",
  ]) {
    assert.equal((await fetchPrototype(name)).status, 404, name);
  }
  const prototypePost = await fetchPrototype("a.mp4", { method: "POST" });
  assert.equal(prototypePost.status, 405);
  assert.equal(prototypePost.headers.get("allow"), "GET, HEAD");
  await env.SOCIAL_EXPORTS.delete("intro/prototypes-02-20261010/c.mp4");
  assert.equal((await fetchPrototype("c.mp4")).status, 404);
});

test("full intro draft stays private and exposes only seekable review assets", async (t) => {
  const fixture = await createWorkerFixture({
    vars: {
      ADMIN_USERNAME: "intro-admin",
      ADMIN_PASSWORD: "local-test-password",
      EMAIL_ENCRYPTION_KEY: "local-test-encryption-key",
      TURNSTILE_SITE_KEY: "",
    },
  });
  t.after(() => fixture.dispose());
  const { worker, env } = fixture;
  const route = "/api/admin/intro/draft-03/";
  const key = "intro/draft-03-20261010/";
  const draftAssets = new Map([
    ["preview.mp4", "draft-03:1080p:0123456789abcdefghijklmnopqrstuvwxyz"],
    ["4k.mp4", "draft-03:4k:0123456789abcdefghijklmnopqrstuvwxyz"],
    ["poster.jpg", "draft 03 poster"],
    ["music-credit.txt", "Cipher by Kevin MacLeod / CC BY 4.0"],
  ]);
  for (const [name, body] of draftAssets) {
    await env.SOCIAL_EXPORTS.put(`${key}${name}`, body);
    for (const method of ["GET", "HEAD"]) {
      const response = await worker.fetch(
        `${origin}${route}${name}?download=1`,
        {
          method,
          headers: { range: "bytes=0-1" },
        },
      );
      assert.equal(response.status, 401, `${method} ${name}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  const page = await worker.fetch(`${origin}/admin/intro/`, {
    headers: { authorization },
  });
  assert.equal(page.status, 200);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const fetchDraft = (name, options = {}) =>
    worker.fetch(`${origin}${route}${name}`, {
      ...options,
      headers: { cookie, "accept-encoding": "identity", ...options.headers },
    });
  for (const [name, body] of draftAssets) {
    const response = await fetchDraft(name);
    assert.equal(response.status, 200, name);
    assert.equal(await response.text(), body, name);
    assert.equal(response.headers.get("content-length"), String(body.length));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("vary"), /Cookie/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.equal(
      response.headers.get("content-type"),
      name.endsWith(".mp4")
        ? "video/mp4"
        : name.endsWith(".jpg")
          ? "image/jpeg"
          : "text/plain; charset=utf-8",
    );
  }
  for (const [name, resolution] of [
    ["preview.mp4", "1080p"],
    ["4k.mp4", "4k"],
  ]) {
    const body = draftAssets.get(name);
    const ranged = await fetchDraft(name, { headers: { range: "bytes=2-7" } });
    assert.equal(ranged.status, 206);
    assert.equal(
      ranged.headers.get("content-range"),
      `bytes 2-7/${body.length}`,
    );
    assert.equal(ranged.headers.get("content-length"), "6");
    assert.equal(await ranged.text(), body.slice(2, 8));
    const head = await fetchDraft(name, {
      method: "HEAD",
      headers: { range: "bytes=2-7" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(body.length));
    assert.equal(head.headers.get("content-range"), null);
    assert.equal(await head.text(), "");
    const invalidRange = await fetchDraft(name, {
      headers: { range: `bytes=${body.length}-` },
    });
    assert.equal(invalidRange.status, 416);
    assert.equal(
      invalidRange.headers.get("content-range"),
      `bytes */${body.length}`,
    );
    const download = await fetchDraft(`${name}?download=1`);
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-disposition"),
      `attachment; filename="sdlcai-intro-draft-03-${resolution}.mp4"`,
    );
    assert.equal(await download.text(), body);
  }
  await env.SOCIAL_EXPORTS.put(
    `${key}private-notes.txt`,
    "private production notes",
  );
  for (const name of [
    "private-notes.txt",
    "music.wav",
    "preview.mp4/extra",
    "Preview.mp4",
    "%70review.mp4",
    "../draft-04/preview.mp4",
  ]) {
    assert.equal((await fetchDraft(name)).status, 404, name);
  }
  const post = await fetchDraft("preview.mp4", { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET, HEAD");
  await env.SOCIAL_EXPORTS.delete(`${key}preview.mp4`);
  assert.equal((await fetchDraft("preview.mp4")).status, 404);
});
