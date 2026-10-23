import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "parse5";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("the programme lists each talk once with recordings and resources above closed details", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const talkId = "mo-khazali-industry-perspective";
  const headers = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "publish-speaker-slides",
  };
  const save = (type, data = {}, requestHeaders = headers) =>
    worker.fetch(`${origin}/api/admin/speakers/slides/${type}`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        speaker_id: "mo-khazali",
        talk_id: talkId,
        url: "https://video.example.org/talk",
        previous_url: null,
        ...data,
      }),
    });
  assert.equal((await save("recordings", {}, {})).status, 401);
  assert.equal(
    (
      await save(
        "recordings",
        {},
        { cookie: cookies.get("mo-khazali"), origin },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await save(
        "recordings",
        {},
        { ...headers, origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await save("recordings", {}, { ...headers, "x-admin-action": "wrong" }))
      .status,
    403,
  );
  for (const data of [
    { url: "javascript:alert(1)" },
    { url: "http://video.example.org/talk" },
    { url: "https://user:secret@video.example.org" },
    { talk_id: "missing-talk" },
    {
      speaker_id: "juho-vepsalainen",
      talk_id: "juho-vepsalainen-test-session",
    },
  ])
    assert.equal((await save("recordings", data)).status, 400);
  assert.equal((await save("links", { kind: "invalid" })).status, 400);
  assert.equal((await save("links", { kind: {} })).status, 400);
  assert.equal((await save("recordings")).status, 200);
  assert.equal((await save("recordings")).status, 409);
  const resourceUrl = "https://research.example.org/paper?a=1&b=2";
  assert.equal(
    (await save("links", { url: resourceUrl, kind: "resource" })).status,
    200,
  );
  assert.equal(
    (
      await save("links", {
        url: resourceUrl,
        previous_url: resourceUrl,
        kind: "presentation",
      })
    ).status,
    409,
  );

  const response = await worker.fetch(`${origin}/2026/schedule/`);
  assert.equal(response.headers.get("x-sdlcai-content-source"), "d1");
  const elements = walk(parse(await response.text()));
  const talk = elements.find((el) => attr(el, "data-schedule-talk") === talkId);
  assert.ok(talk);
  const titles = elements.filter(
    (el) => attr(el, "data-canonical-talk-title") !== undefined,
  );
  const talkIds = titles.map((el) => attr(el, "data-canonical-talk-id"));
  assert.equal(talkIds.length, new Set(talkIds).size);
  const links = walk(talk).filter((el) => el.tagName === "a");
  for (const [url, label] of [
    ["https://video.example.org/talk", "Watch talk"],
    [resourceUrl, "Related resource"],
  ]) {
    assert.equal(
      elements.filter((el) => attr(el, "href") === url && content(el) === label)
        .length,
      1,
    );
    assert.ok(links.some((el) => attr(el, "href") === url));
  }
  assert.ok(
    !walk(talk).some(
      (el) => attr(el, "data-talk-materials-pending") !== undefined,
    ),
  );
  const details = walk(talk).find((el) => el.tagName === "details");
  assert.ok(details);
  assert.equal(attr(details, "open"), undefined);
  assert.ok(
    !walk(details).some((el) => attr(el, "data-talk-materials") !== undefined),
  );
  assert.ok(
    elements.some(
      (el) => attr(el, "data-talk-materials-pending") !== undefined,
    ),
  );
  const previewUrl = `${origin}/admin/talk-previews/${talkId}/`;
  const preview = await worker.fetch(previewUrl, { headers });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("x-sdlcai-content-source"), "d1");
  assert.match(preview.headers.get("cache-control"), /no-store/);
  const previewElements = walk(parse(await preview.text()));
  const previewMaterials = previewElements.find(
    (el) => attr(el, "data-talk-materials") !== undefined,
  );
  assert.ok(previewMaterials);
  assert.equal(attr(previewMaterials, "hidden"), undefined);
  assert.deepEqual(
    walk(previewMaterials)
      .filter((el) => el.tagName === "a")
      .map((el) => [attr(el, "href"), content(el)]),
    [
      [resourceUrl, "Related resource"],
      ["https://video.example.org/talk", "Watch talk"],
    ],
  );
  assert.equal(
    content(previewElements.find((el) => el.tagName === "h1")),
    "1978: The Last Good Year",
  );
  assert.ok(
    !previewElements.some(
      (el) => attr(el, "data-talk-materials-pending") !== undefined,
    ),
  );
  const admin = await (
    await worker.fetch(`${origin}/api/admin/speakers`, { headers })
  ).json();
  assert.deepEqual(
    admin.speakers.find((s) => s.speaker_id === "mo-khazali").recording_links,
    [{ talk_id: talkId, url: "https://video.example.org/talk" }],
  );

  const updated = "https://video.example.org/edited";
  assert.equal(
    (
      await save("recordings", {
        previous_url: "https://stale.example.org",
        url: updated,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await save("recordings", {
        previous_url: "https://video.example.org/talk",
        url: updated,
      })
    ).status,
    200,
  );
  const refreshedPreview = await (
    await worker.fetch(previewUrl, { headers })
  ).text();
  assert.ok(refreshedPreview.includes(updated));
  assert.ok(!refreshedPreview.includes("https://video.example.org/talk"));
  assert.equal(
    (
      await save("recordings", {
        previous_url: "https://video.example.org/talk",
        url: "",
      })
    ).status,
    409,
  );
  assert.equal(
    (await save("recordings", { previous_url: updated, url: "" })).status,
    200,
  );
  assert.doesNotMatch(
    await (await worker.fetch(`${origin}/2026/schedule/`)).text(),
    />Watch talk<\/a>/u,
  );
  assert.equal(
    (
      await save("links", {
        previous_url: resourceUrl,
        previous_kind: "resource",
        kind: "presentation",
        url: resourceUrl,
      })
    ).status,
    200,
  );
  assert.match(
    await (await worker.fetch(`${origin}/2026/schedule/`)).text(),
    />Presentation<\/a>/u,
  );
  const changes = await runSql(
    "SELECT operation FROM organizer_data_changes WHERE table_name = 'speaker_recording_links'",
  );
  assert.deepEqual(
    changes.map((row) => row.operation),
    ["added", "updated", "deleted"],
  );
  const events = await runSql(
    "SELECT action FROM activity_events WHERE category = 'Talk recordings'",
  );
  assert.ok(events.some((row) => row.action === "link saved"));
  assert.ok(events.some((row) => row.action === "link removed"));
});

function walk(node) {
  return [node, ...(node.childNodes ?? []).flatMap(walk)];
}
function attr(node, name) {
  return node.attrs?.find((item) => item.name === name)?.value;
}
function content(node) {
  return node.nodeName === "#text"
    ? node.value
    : (node.childNodes ?? []).map(content).join("");
}
