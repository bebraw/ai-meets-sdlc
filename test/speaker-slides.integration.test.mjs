import assert from "node:assert/strict";
import test from "node:test";
import { zipSync, strToU8 } from "fflate";
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";
import { pdfSlideBytes, powerpointSlideBytes } from "./helpers/slide-files.mjs";

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
    (await upload({ bytes: new Uint8Array(25 * 1024 * 1024 + 1) })).status,
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
  const schedule = await worker.fetch(`${origin}/schedule/`);
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
    await (await worker.fetch(`${origin}/schedule/`)).text(),
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
