import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import {
  htmlSlideBytes,
  pdfSlideBytes,
  powerpointSlideBytes,
} from "./helpers/slide-files.mjs";

test("slide uploads accept a 28 MB PowerPoint and the 50 MB boundary, and reject larger streams", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const headers = { cookie: cookies.get("mo-khazali"), origin };
  const workspace = await (
    await worker.fetch(`${origin}/api/speaker/workspace`, { headers })
  ).json();
  const talkId = workspace.content.talks[0].id;
  const maximum = 50 * 1024 * 1024;
  const upload = (body, filename, extra = {}) =>
    worker.fetch(
      `${origin}/api/speaker/slides?${new URLSearchParams({ talk_id: talkId, filename })}`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/octet-stream" },
        body,
        ...extra,
      },
    );
  const largePowerPoint = powerpointSlideBytes(28 * 1024 * 1024);
  const pptxResponse = await upload(largePowerPoint, "28-MB.pptx");
  assert.equal(pptxResponse.status, 201, await pptxResponse.clone().text());
  const pptx = (await pptxResponse.json()).slide;
  assert.equal(pptx.byte_size, largePowerPoint.length);
  const stored = await runSql(
    "SELECT byte_size, content_hash FROM speaker_slides WHERE format = 'powerpoint'",
  );
  assert.equal(stored[0].byte_size, largePowerPoint.length);
  assert.equal(
    stored[0].content_hash,
    createHash("sha256").update(largePowerPoint).digest("hex"),
  );
  const downloaded = await worker.fetch(`${origin}${pptx.download_url}`, {
    headers,
  });
  assert.equal(downloaded.status, 200);
  const downloadHash = createHash("sha256");
  for await (const chunk of downloaded.body) downloadHash.update(chunk);
  assert.equal(downloadHash.digest("hex"), stored[0].content_hash);

  // Pad with PDF whitespace while keeping the header and EOF intact.
  const pdf = Buffer.alloc(maximum, " ");
  pdfSlideBytes().copy(pdf);
  pdf.write("\n%%EOF\n", maximum - 7);
  const boundary = await upload(pdf, "50-MB.pdf");
  assert.equal(boundary.status, 201, await boundary.clone().text());
  const boundarySlide = (await boundary.json()).slide;
  assert.equal(boundarySlide.byte_size, maximum);
  const head = await worker.fetch(`${origin}${boundarySlide.download_url}`, {
    method: "HEAD",
    headers,
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(maximum));

  // A chunked upload has no Content-Length: enforce the limit while reading too.
  let sent = 0;
  const oversized = new ReadableStream({
    pull(controller) {
      const count = Math.min(64 * 1024, maximum + 1 - sent);
      if (count === 0) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(count));
      sent += count;
    },
  });
  const rejected = await upload(oversized, "oversized.pdf", { duplex: "half" });
  assert.equal(rejected.status, 413);
  assert.equal(
    (await rejected.json()).error,
    "Slides must be 50 MB or smaller.",
  );
  assert.equal(
    (await runSql("SELECT COUNT(*) AS count FROM speaker_slides"))[0].count,
    2,
  );
});

test("admins upload, replace and remove PDF, PowerPoint and standalone HTML for a speaker", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql, env } = fixture;
  const adminHeaders = {
    authorization: receiptAdmin,
    origin,
    "x-admin-action": "upload-speaker-slides",
  };
  const getSpeaker = async () => {
    const response = await worker.fetch(`${origin}/api/admin/speakers`, {
      headers: adminHeaders,
    });
    return (await response.json()).speakers.find(
      ({ speaker_id }) => speaker_id === "mo-khazali",
    );
  };
  const talkId = (await getSpeaker()).canonical.talks[0].id;
  const upload = (overrides = {}, headers = adminHeaders) => {
    const {
      bytes = pdfSlideBytes(),
      contentType = "application/pdf",
      ...params
    } = overrides;
    return worker.fetch(
      `${origin}/api/admin/speakers/slides/upload?${new URLSearchParams({ speaker_id: "mo-khazali", talk_id: talkId, filename: "slides.pdf", may_publish: "0", ...params })}`,
      {
        method: "POST",
        headers: { ...headers, "content-type": contentType },
        body: bytes,
      },
    );
  };
  const publish = (slideId) =>
    worker.fetch(`${origin}/api/admin/speakers/slides/publication`, {
      method: "POST",
      headers: {
        ...adminHeaders,
        "content-type": "application/json",
        "x-admin-action": "publish-speaker-slides",
      },
      body: JSON.stringify({ slide_id: slideId, published: true }),
    });
  assert.equal((await upload({}, {})).status, 401);
  assert.equal(
    (await upload({}, { cookie: cookies.get("mo-khazali"), origin })).status,
    401,
  );
  assert.equal(
    (await upload({}, { ...adminHeaders, origin: "https://attacker.example" }))
      .status,
    403,
  );
  assert.equal(
    (await upload({}, { ...adminHeaders, "x-admin-action": "wrong" })).status,
    403,
  );
  assert.equal((await upload({ speaker_id: "unknown-speaker" })).status, 400);
  assert.equal((await upload({ talk_id: "unknown-talk" })).status, 400);
  assert.equal((await upload({ speaker_id: "ohans-emmanuel" })).status, 400);
  assert.equal((await upload({ filename: "../slides.html" })).status, 400);
  assert.equal(
    (
      await upload({
        filename: "slides.html",
        contentType: "application/pdf",
        bytes: htmlSlideBytes(),
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await upload({
        filename: "slides.html",
        contentType: "text/html",
        bytes: Buffer.from("not an HTML document"),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await upload({
        filename: "slides.html",
        contentType: "text/html",
        bytes: Buffer.from([0xff, 0xfe]),
      })
    ).status,
    400,
  );
  assert.equal(
    (await upload({ bytes: new Uint8Array(50 * 1024 * 1024 + 1) })).status,
    413,
  );

  const pdfResponse = await upload({ may_publish: "1" });
  assert.equal(pdfResponse.status, 201, await pdfResponse.clone().text());
  const pdf = (await pdfResponse.json()).slide;
  assert.ok(pdf.download_url.startsWith("/api/admin/speakers/slides/"));
  assert.equal(pdf.published_at, null);
  assert.equal((await publish(pdf.slide_id)).status, 200);
  const publicPdf = (await getSpeaker()).slides.find(
    ({ format }) => format === "pdf",
  ).public_url;
  assert.equal((await worker.fetch(`${origin}${publicPdf}`)).status, 200);
  // Stale admin forms and speaker forms cannot overwrite a newer revision.
  assert.equal((await upload()).status, 409);
  const speakerHeaders = { cookie: cookies.get("mo-khazali"), origin };
  const speakerUploadUrl = `${origin}/api/speaker/slides?${new URLSearchParams({ talk_id: talkId, filename: "stale.pdf" })}`;
  assert.equal(
    (
      await worker.fetch(speakerUploadUrl, {
        method: "POST",
        headers: { ...speakerHeaders, "content-type": "application/pdf" },
        body: pdfSlideBytes(),
      })
    ).status,
    409,
  );
  const replaced = await upload({ replaces_slide_id: pdf.slide_id });
  assert.equal(replaced.status, 201);
  const replacement = (await replaced.json()).slide;
  assert.equal(replacement.may_publish, false);
  assert.equal(replacement.published_at, null);
  assert.equal((await worker.fetch(`${origin}${publicPdf}`)).status, 404);
  assert.equal((await upload({ replaces_slide_id: pdf.slide_id })).status, 409);

  const expectedFiles = [
    {
      format: "powerpoint",
      filename: "venue.PPTX",
      contentType: "application/octet-stream",
      bytes: powerpointSlideBytes(),
    },
    {
      format: "html",
      filename: "deck.HTML",
      contentType: "text/html; charset=utf-8",
      bytes: htmlSlideBytes(),
    },
  ];
  for (const { format, ...file } of expectedFiles) {
    const response = await upload({ ...file, may_publish: "1" });
    assert.equal(response.status, 201, await response.clone().text());
    const slide = (await response.json()).slide;
    assert.equal(slide.format, format);
    assert.equal(slide.may_publish, false);
    assert.equal(slide.public_url, null);
    assert.equal((await publish(slide.slide_id)).status, 400);
    const download = await worker.fetch(`${origin}${slide.download_url}`, {
      headers: adminHeaders,
    });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /^attachment;/u);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-security-policy"), /sandbox/u);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), file.bytes);
    const head = await worker.fetch(`${origin}${slide.download_url}`, {
      method: "HEAD",
      headers: adminHeaders,
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(file.bytes.length));
    assert.equal(await head.text(), "");
    assert.equal(
      (await worker.fetch(`${origin}${slide.download_url}`)).status,
      401,
    );
    const speakerDownload = `/api/speaker/slides/${slide.slide_id}`;
    assert.equal(
      (
        await worker.fetch(`${origin}${speakerDownload}`, {
          headers: { cookie: cookies.get("ohans-emmanuel") },
        })
      ).status,
      404,
    );
    const ownDownload = await worker.fetch(`${origin}${speakerDownload}`, {
      headers: speakerHeaders,
    });
    assert.equal(ownDownload.status, 200);
    assert.deepEqual(Buffer.from(await ownDownload.arrayBuffer()), file.bytes);
  }
  let slides = (await getSpeaker()).slides;
  assert.equal(slides.length, 3);
  const firstHtml = slides.find(({ format }) => format === "html");
  const htmlReplacement = await upload({
    filename: "updated.htm",
    bytes: htmlSlideBytes("Updated HTML"),
    contentType: "text/html",
    replaces_slide_id: firstHtml.slide_id,
  });
  assert.equal(htmlReplacement.status, 201);
  assert.equal(
    (
      await worker.fetch(`${origin}${firstHtml.download_url}`, {
        headers: adminHeaders,
      })
    ).status,
    404,
  );
  const noPermission = await publish(replacement.slide_id);
  assert.equal(noPermission.status, 403);
  slides = (await getSpeaker()).slides;
  for (const file of slides) {
    const url = `${origin}${file.download_url}?speaker_id=mo-khazali`;
    assert.equal(
      (
        await worker.fetch(url, {
          method: "DELETE",
          headers: { ...adminHeaders, "x-admin-action": "wrong" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await worker.fetch(url, {
          method: "DELETE",
          headers: {
            ...adminHeaders,
            "x-admin-action": "remove-speaker-slides",
            origin: "https://attacker.example",
          },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await worker.fetch(url, {
          method: "DELETE",
          headers: {
            ...adminHeaders,
            "x-admin-action": "remove-speaker-slides",
          },
        })
      ).status,
      200,
    );
    assert.equal(
      (await worker.fetch(url, { headers: adminHeaders })).status,
      404,
    );
  }
  assert.deepEqual((await getSpeaker()).slides, []);
  assert.equal(
    (await env.SPEAKER_UPLOADS.list({ prefix: "speaker-slides/" })).objects
      .length,
    0,
  );
  assert.deepEqual(await runSql("SELECT * FROM speaker_slide_garbage"), []);
  const events = await runSql(
    "SELECT actor_type, subject_speaker_id, action FROM activity_events WHERE category = 'Presentation files'",
  );
  assert.ok(
    events.some(
      ({ actor_type, subject_speaker_id, action }) =>
        actor_type === "admin" &&
        subject_speaker_id === "mo-khazali" &&
        action === "uploaded",
    ),
  );
  assert.ok(
    events.some(
      ({ actor_type, subject_speaker_id, action }) =>
        actor_type === "admin" &&
        subject_speaker_id === "mo-khazali" &&
        action === "removed",
    ),
  );
});

test("organizers can publish, update and remove external slide links per public talk", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const adminHeaders = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "publish-speaker-slides",
  };
  const endpoint = `${origin}/api/admin/speakers/slides/links`;
  const getSpeaker = async () => {
    const response = await worker.fetch(`${origin}/api/admin/speakers`, {
      headers: adminHeaders,
    });
    return (await response.json()).speakers.find(
      ({ speaker_id }) => speaker_id === "mo-khazali",
    );
  };
  const speaker = await getSpeaker();
  const talkId = speaker.canonical.talks[0].id;
  const slideUrl = 'https://slides.example.org/deck?view=public&title="Slides"';
  const save = (overrides = {}, headers = adminHeaders) =>
    worker.fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        speaker_id: speaker.speaker_id,
        talk_id: talkId,
        url: slideUrl,
        previous_url: null,
        ...overrides,
      }),
    });
  const scheduleHtml = async () => {
    const response = await worker.fetch(`${origin}/2026/schedule/`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.text();
  };
  assert.deepEqual(speaker.slide_links, []);
  assert.equal((await save({}, {})).status, 401);
  assert.equal(
    (await save({}, { cookie: cookies.get("mo-khazali"), origin })).status,
    401,
  );
  assert.equal(
    (await save({}, { ...adminHeaders, origin: "https://attacker.example" }))
      .status,
    403,
  );
  assert.equal(
    (await save({}, { ...adminHeaders, "x-admin-action": "wrong" })).status,
    403,
  );
  assert.equal(
    (await worker.fetch(endpoint, { headers: adminHeaders })).status,
    405,
  );
  assert.equal((await save({ previous_url: undefined })).status, 400);
  assert.equal((await save({ talk_id: "someone-elses-talk" })).status, 400);
  assert.equal((await save({ speaker_id: "missing-speaker" })).status, 400);
  assert.equal(
    (
      await save({
        speaker_id: "juho-vepsalainen",
        talk_id: "juho-vepsalainen-test-session",
      })
    ).status,
    400,
  );
  for (const url of [
    "javascript:alert(1)",
    "http://slides.example.org/deck",
    "/relative",
    "not a URL",
    "https://user:secret@slides.example.org",
    "https://slides.example.org/\npath",
    `https://slides.example.org/${"x".repeat(2048)}`,
  ])
    assert.equal((await save({ url })).status, 400, url);
  assert.equal((await save({ url: `  ${slideUrl}  ` })).status, 200);
  const normalizedUrl = new URL(slideUrl).toString();
  assert.deepEqual((await getSpeaker()).slide_links, [
    { talk_id: talkId, url: normalizedUrl, kind: "presentation" },
  ]);
  const html = await scheduleHtml();
  assert.ok(html.includes(`href="${normalizedUrl.replaceAll("&", "&amp;")}"`));
  assert.match(html, />Presentation<\/a>/u);
  assert.equal((await save()).status, 409);
  assert.equal(
    (await save({ previous_url: "https://stale.example.org/", url: "" }))
      .status,
    409,
  );
  const updatedUrl = "https://slides.example.org/updated";
  assert.equal(
    (await save({ previous_url: normalizedUrl, url: updatedUrl })).status,
    200,
  );
  assert.ok((await scheduleHtml()).includes(updatedUrl));
  assert.ok(!(await scheduleHtml()).includes(normalizedUrl));
  assert.equal(
    (await save({ previous_url: normalizedUrl, url: "" })).status,
    409,
  );
  await runSql(
    "UPDATE speaker_workspace_sessions SET expires_at = '2000-01-01T00:00:00Z'",
  );
  assert.ok((await scheduleHtml()).includes(updatedUrl));
  assert.equal((await save({ previous_url: updatedUrl, url: "" })).status, 200);
  assert.deepEqual((await getSpeaker()).slide_links, []);
  assert.doesNotMatch(await scheduleHtml(), />Presentation<\/a>/u);
  assert.equal((await save({ previous_url: updatedUrl })).status, 409);
  assert.equal((await save()).status, 200);
  const events = await runSql(
    "SELECT action FROM activity_events WHERE category = 'Presentation files'",
  );
  assert.ok(events.some(({ action }) => action === "link saved"));
  assert.ok(events.some(({ action }) => action === "link removed"));
  const changes = await runSql(
    "SELECT operation FROM organizer_data_changes WHERE table_name = 'speaker_slide_links'",
  );
  assert.ok(changes.some(({ operation }) => operation === "added"));
  assert.ok(changes.some(({ operation }) => operation === "updated"));
  assert.ok(changes.some(({ operation }) => operation === "deleted"));
});

test("organizers can record later permission while publishing the exact existing PDF", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const speakerHeaders = { cookie: cookies.get("mo-khazali"), origin };
  const workspace = await (
    await worker.fetch(`${origin}/api/speaker/workspace`, {
      headers: speakerHeaders,
    })
  ).json();
  const talkId = workspace.content.talks[0].id;
  const upload = async (replaces = "") => {
    const response = await worker.fetch(
      `${origin}/api/speaker/slides?${new URLSearchParams({ talk_id: talkId, filename: "later-permission.pdf", replaces_slide_id: replaces })}`,
      {
        method: "POST",
        headers: { ...speakerHeaders, "content-type": "application/pdf" },
        body: pdfSlideBytes(),
      },
    );
    assert.equal(response.status, 201);
    return (await response.json()).slide;
  };
  const original = await upload();
  const [before] = await runSql("SELECT * FROM speaker_slides");
  const adminHeaders = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "publish-speaker-slides",
  };
  const publish = (body = {}, headers = adminHeaders) =>
    worker.fetch(`${origin}/api/admin/speakers/slides/publication`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        slide_id: original.slide_id,
        published: true,
        ...body,
      }),
    });
  assert.equal((await publish()).status, 403);
  assert.equal((await publish({ permission_confirmed: false })).status, 403);
  for (const value of ["true", 1, null])
    assert.equal((await publish({ permission_confirmed: value })).status, 400);
  assert.equal(
    (await publish({ permission_confirmed: true }, speakerHeaders)).status,
    401,
  );
  assert.equal(
    (
      await publish(
        { permission_confirmed: true },
        { ...adminHeaders, origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await publish(
        { permission_confirmed: true },
        { ...adminHeaders, "x-admin-action": "wrong" },
      )
    ).status,
    403,
  );
  const response = await publish({ permission_confirmed: true });
  assert.equal(response.status, 200, await response.clone().text());
  const published = (await response.json()).slide;
  assert.equal(published.slide_id, original.slide_id);
  assert.equal(published.may_publish, true);
  assert.ok(published.published_at);
  const [after] = await runSql("SELECT * FROM speaker_slides");
  assert.deepEqual(after, {
    ...before,
    may_publish: 1,
    published_at: published.published_at,
  });
  const downloaded = await worker.fetch(`${origin}${published.public_url}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(
    Buffer.from(await downloaded.arrayBuffer()),
    pdfSlideBytes(),
  );
  assert.equal((await publish({ published: false })).status, 200);
  assert.equal((await publish()).status, 200);
  const replacement = await upload(original.slide_id);
  assert.equal(replacement.may_publish, false);
  assert.equal(replacement.published_at, null);
  assert.equal((await publish({ permission_confirmed: true })).status, 409);
  assert.equal((await publish({ slide_id: replacement.slide_id })).status, 403);
  assert.equal(
    (await worker.fetch(`${origin}${published.public_url}`)).status,
    404,
  );
});

test("speaker slides stay private until publication, and replacement withdraws public files", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, cookies, runSql } = fixture;
  const cookie = cookies.get("mo-khazali");
  const headers = { cookie, origin };
  const adminHeaders = {
    authorization: receiptAdmin,
    origin,
    "content-type": "application/json",
    "x-admin-action": "publish-speaker-slides",
  };
  const workspace = await (
    await worker.fetch(`${origin}/api/speaker/workspace`, { headers })
  ).json();
  const talkId = workspace.content.talks[0].id;
  const pdf = pdfSlideBytes();
  const pptx = powerpointSlideBytes();
  const upload = (options = {}, uploadHeaders = headers) => {
    const { bytes = pdf, contentType = "application/pdf", ...params } = options;
    return worker.fetch(
      `${origin}/api/speaker/slides?${new URLSearchParams({
        talk_id: talkId,
        filename: "Slides – Helsinki.pdf",
        may_publish: "0",
        ...params,
      })}`,
      {
        method: "POST",
        headers: { ...uploadHeaders, "content-type": contentType },
        body: bytes,
      },
    );
  };
  const publish = (slideId, published = true, requestHeaders = adminHeaders) =>
    worker.fetch(`${origin}/api/admin/speakers/slides/publication`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ slide_id: slideId, published }),
    });
  const publicUrl = (file) => `/media/talks/${talkId}/${file.slide_id}.pdf`;
  for (const route of ["/api/speaker/slides", "/api/admin/speakers"]) {
    assert.equal((await worker.fetch(`${origin}${route}`)).status, 401);
  }
  assert.equal(
    (await upload({}, { cookie, origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal((await upload({ talk_id: "someone-elses-talk" })).status, 400);
  assert.equal((await upload({ filename: "../slides.pdf" })).status, 400);
  assert.equal((await upload({ filename: "slides.key" })).status, 400);
  assert.equal(
    (await upload({ filename: "slides.pdf\r\nInjected: yes" })).status,
    400,
  );
  assert.equal((await upload({ contentType: "text/html" })).status, 415);
  assert.equal((await upload({ bytes: Buffer.from("not a PDF") })).status, 400);
  assert.equal(
    (await upload({ bytes: Buffer.from("%PDF-1.7\ntruncated") })).status,
    400,
  );
  assert.equal(
    (await upload({ bytes: new Uint8Array(50 * 1024 * 1024 + 1) })).status,
    413,
  );
  assert.equal(
    (
      await upload({
        filename: "slides.pptx",
        bytes: Buffer.from("PK not a presentation"),
        contentType: "application/octet-stream",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await upload({
        filename: "slides.pptx",
        bytes: zipSync({ "hello.txt": strToU8("not a deck") }),
        contentType: "application/octet-stream",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await upload({
        filename: "slides.pptx",
        bytes: zipSync({
          "[Content_Types].xml": new Uint8Array(600 * 1024),
          "ppt/presentation.xml": strToU8("presentation"),
        }),
        contentType: "application/octet-stream",
      })
    ).status,
    400,
  );

  const firstResponse = await upload();
  assert.equal(firstResponse.status, 201, await firstResponse.clone().text());
  const first = (await firstResponse.json()).slide;
  assert.equal(first.may_publish, false);
  assert.equal(first.published_at, null);
  assert.equal(first.public_url, null);
  assert.equal(first.byte_size, pdf.length);
  assert.doesNotMatch(
    JSON.stringify(first),
    /r2_key|content_hash|speaker-slides\//u,
  );
  assert.equal(
    (await worker.fetch(`${origin}${publicUrl(first)}`)).status,
    404,
  );
  assert.equal((await publish(first.slide_id)).status, 403);
  const download = await worker.fetch(`${origin}${first.download_url}`, {
    headers,
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    download.headers.get("content-disposition"),
    /filename\*=UTF-8''Slides%20/u,
  );
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  assert.equal(
    (await worker.fetch(`${origin}${first.download_url}`)).status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${first.download_url}`, {
        headers: { cookie: cookies.get("ohans-emmanuel") },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${first.download_url}`, {
        method: "DELETE",
        headers: { cookie: cookies.get("ohans-emmanuel"), origin },
      })
    ).status,
    404,
  );
  assert.equal((await upload({ may_publish: "1" })).status, 409);
  const allowedResponse = await upload({
    may_publish: "1",
    replaces_slide_id: first.slide_id,
  });
  assert.equal(
    allowedResponse.status,
    201,
    await allowedResponse.clone().text(),
  );
  const allowed = (await allowedResponse.json()).slide;
  assert.equal(allowed.may_publish, true);
  assert.equal(
    (await worker.fetch(`${origin}${first.download_url}`, { headers })).status,
    404,
  );
  const adminSpeakers = await (
    await worker.fetch(`${origin}/api/admin/speakers`, {
      headers: adminHeaders,
    })
  ).json();
  const adminFile = adminSpeakers.speakers.find(
    (speaker) => speaker.speaker_id === "mo-khazali",
  ).slides[0];
  assert.equal(adminFile.slide_id, allowed.slide_id);
  const adminDownload = await worker.fetch(
    `${origin}${adminFile.download_url}`,
    { headers: adminHeaders },
  );
  assert.deepEqual(Buffer.from(await adminDownload.arrayBuffer()), pdf);
  assert.equal(
    (await worker.fetch(`${origin}${adminFile.download_url}`)).status,
    401,
  );
  assert.equal(
    (
      await publish(allowed.slide_id, true, {
        ...adminHeaders,
        "x-admin-action": "wrong",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await publish(allowed.slide_id, true, {
        ...adminHeaders,
        origin: "https://attacker.example",
      })
    ).status,
    403,
  );
  const published = await publish(allowed.slide_id);
  assert.equal(published.status, 200, await published.clone().text());
  const publishedSlide = (await published.json()).slide;
  assert.equal(publishedSlide.public_url, publicUrl(allowed));
  const schedule = await worker.fetch(`${origin}/2026/schedule/`);
  assert.equal(schedule.headers.get("cache-control"), "no-store");
  assert.match(
    await schedule.text(),
    new RegExp(`href="${publicUrl(allowed)}"[^>]*>Slides \\(PDF\\)</a>`, "u"),
  );
  const publicDownload = await worker.fetch(`${origin}${publicUrl(allowed)}`);
  assert.equal(publicDownload.status, 200);
  assert.equal(publicDownload.headers.get("cache-control"), "no-store");
  assert.equal(publicDownload.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await publicDownload.arrayBuffer()), pdf);
  const head = await worker.fetch(`${origin}${publicUrl(allowed)}`, {
    method: "HEAD",
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(pdf.length));
  assert.equal(await head.text(), "");
  assert.equal(
    (
      await worker.fetch(
        `${origin}/media/talks/wrong-talk/${allowed.slide_id}.pdf`,
      )
    ).status,
    404,
  );
  assert.equal(
    (await worker.fetch(`${origin}${publicUrl(allowed)}`, { method: "POST" }))
      .status,
    405,
  );
  assert.equal((await publish(allowed.slide_id, false)).status, 200);
  assert.equal(
    (await worker.fetch(`${origin}${publicUrl(allowed)}`)).status,
    404,
  );
  assert.doesNotMatch(
    await (await worker.fetch(`${origin}/2026/schedule/`)).text(),
    /Slides \(PDF\)/u,
  );
  assert.equal((await publish(allowed.slide_id)).status, 200);

  const pptxResponse = await upload({
    filename: "Slides.pptx",
    bytes: pptx,
    contentType: "application/octet-stream",
    may_publish: "1",
  });
  assert.equal(pptxResponse.status, 201, await pptxResponse.clone().text());
  const powerpoint = (await pptxResponse.json()).slide;
  assert.equal(powerpoint.may_publish, false);
  assert.equal((await publish(powerpoint.slide_id)).status, 400);
  const powerpointDownload = await worker.fetch(
    `${origin}${powerpoint.download_url}`,
    { headers },
  );
  assert.deepEqual(Buffer.from(await powerpointDownload.arrayBuffer()), pptx);
  assert.equal(
    (
      await worker.fetch(
        `${origin}/media/talks/${talkId}/${powerpoint.slide_id}.pdf`,
      )
    ).status,
    404,
  );
  const replacementResponse = await upload({
    bytes: pdfSlideBytes("Updated slides"),
    replaces_slide_id: allowed.slide_id,
    may_publish: "1",
  });
  assert.equal(replacementResponse.status, 201);
  const replacement = (await replacementResponse.json()).slide;
  assert.equal(replacement.published_at, null);
  assert.equal(
    (await worker.fetch(`${origin}${publicUrl(allowed)}`)).status,
    404,
  );
  assert.equal((await publish(allowed.slide_id)).status, 409);
  assert.equal(
    (await upload({ replaces_slide_id: allowed.slide_id })).status,
    409,
  );
  assert.equal((await publish(replacement.slide_id)).status, 200);
  const listing = await (
    await worker.fetch(`${origin}/api/speaker/slides`, { headers })
  ).json();
  assert.equal(listing.slides.length, 2);
  assert.equal(
    listing.slides.find((file) => file.format === "pdf").slide_id,
    replacement.slide_id,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${replacement.download_url}`, {
        method: "DELETE",
        headers: { ...headers, origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(`${origin}${replacement.download_url}`, {
        method: "DELETE",
        headers,
      })
    ).status,
    200,
  );
  assert.equal(
    (await worker.fetch(`${origin}${publicUrl(replacement)}`)).status,
    404,
  );
  assert.equal((await publish(replacement.slide_id)).status, 409);
  assert.equal((await runSql("SELECT * FROM speaker_slide_garbage")).length, 0);
  const events = await runSql(
    "SELECT category, action FROM activity_events WHERE category = 'Presentation files'",
  );
  assert.ok(events.some(({ action }) => action === "published PDF"));
  assert.ok(events.some(({ action }) => action === "unpublished PDF"));
  assert.ok(events.some(({ action }) => action === "removed"));

  const archiveResponse = await upload({ may_publish: "1" });
  assert.equal(archiveResponse.status, 201);
  const archived = (await archiveResponse.json()).slide;
  assert.equal((await publish(archived.slide_id)).status, 200);
  await runSql(
    "UPDATE speaker_workspace_sessions SET expires_at = '2000-01-01T00:00:00Z' WHERE speaker_id = 'mo-khazali'",
  );
  assert.equal(
    (await worker.fetch(`${origin}/api/speaker/slides`, { headers })).status,
    401,
  );
  assert.equal(
    (await worker.fetch(`${origin}${publicUrl(archived)}`)).status,
    200,
  );
  const archivedAdmin = `/api/admin/speakers/slides/${archived.slide_id}`;
  assert.equal(
    (await worker.fetch(`${origin}${archivedAdmin}`, { headers: adminHeaders }))
      .status,
    200,
  );
});
