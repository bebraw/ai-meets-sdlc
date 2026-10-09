import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("slide pages and production exports require organizers; speaker graphics require an active login even when cached", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql, env } = fixture;
  const admin = { authorization: receiptAdmin };
  const speaker = { cookie: cookies.get("mo-khazali") };
  const version = "f".repeat(64);
  const slideId = "talk-mo-khazali-industry-perspective";
  const jpg = `/assets/social/linkedin/sdlcai-2026-${slideId}-linkedin-1200x627.jpg`;
  const png = `/assets/social/video/sdlcai-2026-${slideId}-video-3840x2160.png`;
  const fetch = (route, headers = {}, method = "GET") =>
    worker.fetch(`${origin}${route}`, { headers, method, redirect: "manual" });
  const home = await (await fetch("/")).text();
  const header = home.match(/<header\b[^>]*>[\s\S]*?<\/header>/u)[0];
  assert.doesNotMatch(header, /href="\/(slides|for-sponsors)\//u);
  const schedule = await (await fetch("/schedule/")).text();
  assert.doesNotMatch(schedule, /href="\/slides\//u);
  const sponsors = await (await fetch("/for-sponsors/")).text();
  assert.match(sponsors, /Sponsorship recruitment for SDLCAI 2026 has closed/u);
  assert.doesNotMatch(
    sponsors,
    /Sponsor SDLCAI|>Remaining<|confirm availability/u,
  );
  const privateRoutes = [
    "/slides",
    "/slides/",
    "/slides/deck/?slide=4",
    "/slides/schedule/",
    "/assets/social/manifest.json",
    "/assets/social/video/manifest.json",
    png,
    `${png}?v=${version}&snapshot=1`,
  ];
  for (const route of privateRoutes) {
    for (const headers of [{}, speaker]) {
      const response = await fetch(route, headers);
      assert.equal(response.status, 303, route);
      assertPrivate(response);
      const login = new URL(response.headers.get("location"));
      assert.equal(login.pathname, "/admin/login/");
      assert.equal(login.searchParams.get("next"), route);
    }
  }
  for (const route of ["/slides/", "/slides/deck/", "/slides/schedule/"]) {
    const response = await fetch(route, admin);
    assert.equal(response.status, 200, route);
    assertPrivate(response);
    assert.match(await response.text(), /noindex,nofollow,noarchive/u);
  }
  for (const route of [
    jpg,
    `${jpg}?v=${version}`,
    "/assets/social/speakers.json",
  ]) {
    const response = await fetch(route);
    assert.equal(response.status, 401, route);
    assertPrivate(response);
  }
  for (const headers of [speaker, admin]) {
    const manifest = await fetch("/assets/social/speakers.json", headers);
    assert.equal(manifest.status, 200);
    assertPrivate(manifest);
    assert.ok(
      (await manifest.json()).speakers.some(({ id }) => id === "mo-khazali"),
    );
    const graphic = await fetch(jpg, headers);
    assert.equal(graphic.status, 307);
    assertPrivate(graphic);
  }

  // Seed existing R2 objects, then warm the Cache API through authorized requests.
  const bytes = Buffer.from("stored slide export fixture");
  for (const object of [
    `social/v2/${version}/${slideId}-linkedin.jpg`,
    `social/video/v1/${version}/${slideId}.png`,
  ]) {
    await env.SOCIAL_EXPORTS.put(object, bytes);
  }
  for (const [route, headers] of [
    [jpg, speaker],
    [png, admin],
  ]) {
    const versioned = `${route}?v=${version}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(versioned, headers);
      assert.equal(response.status, 200, versioned);
      assertPrivate(response);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
    const anonymous = await fetch(versioned);
    assert.equal(anonymous.status, route === jpg ? 401 : 303);
    assertPrivate(anonymous);
    const head = await fetch(versioned, {}, "HEAD");
    assert.equal(head.status, route === jpg ? 401 : 303);
  }
  await runSql(
    "UPDATE speaker_workspace_access SET revoked_at = '2026-10-05T00:00:00Z' WHERE speaker_id = 'mo-khazali'",
  );
  for (const route of [`${jpg}?v=${version}`, "/assets/social/speakers.json"]) {
    assert.equal((await fetch(route, speaker)).status, 401);
  }
  assert.equal((await fetch(`${jpg}?v=${version}`, admin)).status, 200);
  assert.equal((await fetch("/og.png")).status, 200);
});

function assertPrivate(response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.match(response.headers.get("vary"), /cookie/iu);
  assert.match(response.headers.get("vary"), /authorization/iu);
}
