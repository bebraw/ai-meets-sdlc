import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import seed from "../site/data/event-photos.json" with { type: "json" };
import initial from "../production/media-bank/initial-curation.json" with { type: "json" };
import {
  createReceiptFixture,
  receiptAdmin,
  receiptOrigin as origin,
} from "./helpers/receipt-fixture.mjs";

test("photo bank publishes licensed derivatives and enforces original access, review privacy and concurrent edits", async (t) => {
  const fixture = await createReceiptFixture();
  t.after(() => fixture.dispose());
  const { worker, env, cookies, runSql } = fixture;
  const admin = { authorization: receiptAdmin };
  const mo = { cookie: cookies.get("mo-khazali") };
  const other = { cookie: cookies.get("ohans-emmanuel") };
  const fetch = (route, headers = {}, options = {}) =>
    worker.fetch(origin + route, { headers, ...options });
  const readCatalog = async (headers = {}, route = "/api/photos/catalog") =>
    (await fetch(route, headers)).json();
  const originalPath = (photo) =>
    `/media/event-photos/${photo.id}/original.jpg`;
  const [fuji, insta] = ["fujifilm", "insta360"].map((sourceId) =>
    seed.photos.find((photo) => photo.sourceId === sourceId),
  );
  for (const photo of [fuji, insta]) {
    for (const variant of ["thumbnail", "share", "original"]) {
      await env.SPEAKER_UPLOADS.put(
        `event-photos/${seed.eventId}/${photo.id}/${variant}.jpg`,
        new TextEncoder().encode(`${photo.id}:${variant}`),
      );
    }
  }
  const publicResponse = await fetch("/api/photos/catalog");
  assert.match(
    publicResponse.headers.get("cache-control"),
    /private, no-store/,
  );
  assert.match(publicResponse.headers.get("vary"), /Cookie, Authorization/);
  const catalog = await publicResponse.json();
  assert.equal(catalog.photos.length, 188);
  assert.equal(
    catalog.photos.filter((photo) => photo.selection === "selected").length,
    42,
  );
  assert.equal(
    catalog.photos.filter(
      (photo) =>
        photo.sourceId === "insta360" &&
        photo.clockShiftSeconds === 0 &&
        photo.calibrationStatus === "recording-verified",
    ).length,
    65,
  );
  assert.ok(
    catalog.photos.every(
      (photo) =>
        !photo.originalAvailable && !photo.notes && !photo.associationEvidence,
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(catalog),
    /\/Users\/|localFilename|source\.json/,
  );
  assert.equal(catalog.license, "CC BY 4.0");
  assert.equal(
    catalog.photos.find(
      (photo) => photo.filename === "IMG_20261013_141709_015.jpg",
    ).eventContext.segmentId,
    "sini-talk",
  );
  assert.ok(catalog.photos.every((photo) => photo.eventContext));
  assert.deepEqual(
    catalog.photos.find(
      (photo) => photo.filename === "IMG_20261013_141709_015.jpg",
    ).eventContext.programmeSpeakerIds,
    ["sini-tistelgren"],
  );
  assert.equal((await fetch("/api/admin/photos/catalog")).status, 401);
  assert.equal((await fetch("/api/speaker/photo-bank")).status, 401);
  assert.equal((await fetch(originalPath(fuji))).status, 403);
  const thumbnail = await fetch(`/media/event-photos/${fuji.id}/thumbnail.jpg`);
  assert.equal(thumbnail.status, 200);
  assert.match(
    thumbnail.headers.get("link"),
    /creativecommons.org\/licenses\/by\/4.0/,
  );
  const etag = thumbnail.headers.get("etag");
  await thumbnail.arrayBuffer();
  assert.equal(
    (
      await fetch(`/media/event-photos/${fuji.id}/thumbnail.jpg`, {
        "if-none-match": etag,
      })
    ).status,
    304,
  );
  assert.equal(
    (
      await fetch(
        `/media/event-photos/${fuji.id}/thumbnail.jpg`,
        {},
        { method: "HEAD" },
      )
    ).status,
    200,
  );

  const save = (photo, review, headers = {}) =>
    fetch(
      `/api/admin/photos/${photo.id}`,
      {
        ...admin,
        origin,
        "content-type": "application/json",
        "x-admin-action": "save-event-photo",
        ...headers,
      },
      { method: "POST", body: JSON.stringify(review) },
    );
  const revisionOne = {
    ...initial.photos[fuji.id],
    relatedTalkIds: ["mo-khazali-industry-perspective"],
    notes: "Organizer-only note",
    associationEvidence: "Visible slide title",
  };
  assert.equal(
    (await save(fuji, revisionOne, { origin: "https://untrusted.test" }))
      .status,
    403,
  );
  assert.equal(
    (
      await save(fuji, {
        ...revisionOne,
        depictedSpeakerIds: ["mo-khazali"],
        associationEvidence: "",
      })
    ).status,
    400,
  );
  const contenders = await Promise.all([
    save(fuji, {
      ...revisionOne,
      caption: "Reviewed caption",
      capturedLocal: "wrong",
      photographer: "wrong",
    }),
    save(fuji, { ...revisionOne, caption: "Second organizer caption" }),
  ]);
  assert.deepEqual(
    contenders.map((response) => response.status).sort(),
    [200, 409],
  );
  const saved = await contenders
    .find((response) => response.status === 200)
    .json();
  assert.equal(saved.revision, 2);
  assert.equal(saved.capturedLocal, fuji.capturedLocal);
  assert.equal(saved.photographer, "Juho Vepsäläinen");
  assert.equal((await save(fuji, revisionOne)).status, 409);
  const refreshed = (await readCatalog()).photos.find(
    (photo) => photo.id === fuji.id,
  );
  assert.equal(refreshed.notes, "");
  assert.equal(refreshed.associationEvidence, "");
  assert.equal(refreshed.caption, saved.caption);
  const organizerPhoto = (
    await readCatalog(admin, "/api/admin/photos/catalog")
  ).photos.find((photo) => photo.id === fuji.id);
  assert.equal(organizerPhoto.notes, revisionOne.notes);
  const mine = await readCatalog(mo, "/api/speaker/photo-bank");
  const timingOnly = (await readCatalog(mo)).photos.find(
    (photo) => photo.filename === "DSCF6589.jpeg",
  );
  assert.equal(timingOnly.eventContext.association, "timing-only");
  assert.equal(timingOnly.originalAvailable, false);
  assert.equal((await fetch(originalPath(timingOnly), mo)).status, 403);
  assert.ok(
    mine.photos.some(
      (photo) => photo.id === fuji.id && photo.originalAvailable,
    ),
  );
  assert.ok(mine.photos.every((photo) => photo.originalAvailable));
  assert.equal((await fetch(originalPath(fuji), other)).status, 403);
  const original = await fetch(originalPath(fuji), mo);
  assert.equal(original.status, 200);
  assert.match(original.headers.get("cache-control"), /private, no-store/);
  assert.equal(await original.text(), `${fuji.id}:original`);

  const zip = (ids, variant = "share", headers = {}) =>
    fetch(
      "/api/photos/download",
      { origin, "content-type": "application/json", ...headers },
      { method: "POST", body: JSON.stringify({ ids, variant }) },
    );
  assert.equal((await zip([fuji.id], "original")).status, 403);
  assert.equal((await zip([fuji.id, insta.id], "original", mo)).status, 403);
  assert.equal(
    (await zip([fuji.id], "share", { origin: "https://untrusted.test" }))
      .status,
    403,
  );
  const download = await zip([fuji.id, insta.id, fuji.id]);
  assert.equal(download.status, 200);
  const entries = unzipSync(new Uint8Array(await download.arrayBuffer()));
  assert.equal(Object.keys(entries).length, 4);
  const credits = strFromU8(entries["CREDITS.txt"]);
  assert.match(credits, /Juho Vepsäläinen/);
  assert.match(credits, /Bulent Sahin/);
  assert.match(credits, /CC BY 4.0/);
  assert.doesNotMatch(
    strFromU8(entries["catalog.json"]),
    /Organizer-only note|associationEvidence/,
  );
  const originals = unzipSync(
    new Uint8Array(await (await zip([fuji.id], "original", mo)).arrayBuffer()),
  );
  assert.equal(
    strFromU8(originals[fuji.filename.replace(/\.jpe?g$/i, ".jpg")]),
    `${fuji.id}:original`,
  );

  const hidden = await save(fuji, { ...saved, selection: "rejected" });
  assert.equal(hidden.status, 200);
  const hiddenPhoto = await hidden.json();
  assert.ok(
    !(await readCatalog()).photos.some((photo) => photo.id === fuji.id),
  );
  assert.equal(
    (await fetch(`/media/event-photos/${fuji.id}/thumbnail.jpg`)).status,
    403,
  );
  assert.equal((await fetch(originalPath(fuji), mo)).status, 403);
  assert.equal((await fetch(originalPath(fuji), admin)).status, 200);
  assert.equal((await zip([fuji.id])).status, 403);
  const restored = await save(fuji, { ...hiddenPhoto, selection: "alternate" });
  assert.equal(restored.status, 200);
  assert.equal(
    (
      await save(insta, {
        ...initial.photos[insta.id],
        relatedTalkIds: [],
        depictedSpeakerIds: ["ohans-emmanuel"],
        associationEvidence: "Organizer confirmation in this isolated test",
      })
    ).status,
    200,
  );
  assert.equal((await fetch(originalPath(insta), other)).status, 200);
  assert.equal((await fetch(originalPath(insta), mo)).status, 403);
  await runSql(
    "UPDATE speaker_workspace_access SET revoked_at = '2026-10-15T00:00:00Z' WHERE speaker_id = 'mo-khazali'",
  );
  assert.equal((await fetch(originalPath(fuji), mo)).status, 403);
  assert.equal((await fetch("/api/speaker/photo-bank", mo)).status, 401);
});
