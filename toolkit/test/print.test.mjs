import assert from "node:assert/strict";
import test from "node:test";
import { blocks } from "../blocks/print.mjs";

const operations = new Map(
  blocks.flatMap((block) => block.operations.map((op) => [op.name, op])),
);
const run = (name, input) =>
  operations.get(name).run(input ?? operations.get(name).example);
function verifyPdf(result, pages, width, height) {
  assert.equal(result.artifact.mimeType, "application/pdf");
  const text = Buffer.from(result.artifact.bytes).toString("latin1");
  assert.equal([...text.matchAll(/\/Type \/Page\b/gu)].length, pages);
  const match = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/u.exec(text);
  assert.ok(match, "a physical page box is present");
  assert.ok(Math.abs((Number(match[1]) * 25.4) / 72 - width) < 0.5);
  assert.ok(Math.abs((Number(match[2]) * 25.4) / 72 - height) < 0.5);
}

test("badge proof and PDF share geometry, repeated backs and font preflight", async () => {
  const example = structuredClone(operations.get("badges_preflight").example);
  example.logo =
    "data:image/svg+xml;base64," +
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#762974"/></svg>',
    ).toString("base64");
  const proof = await run("badges_preflight", example);
  assert.deepEqual(proof.issues, []);
  assert.equal(proof.widthMm, 106);
  assert.equal(proof.pageCount, 3);
  assert.equal(proof.artifact.mimeType, "image/png");
  assert.equal(Buffer.from(proof.artifact.bytes).readUInt32BE(), 0x89504e47);
  verifyPdf(await run("badges_export_pdf", example), 3, 106, 106);
  example.settings.doubleSided = true;
  verifyPdf(await run("badges_export_pdf", example), 6, 106, 106);
  example.people[1].name = "Uncovered \u{10ffff}";
  const invalid = await run("badges_export_pdf", example);
  assert.equal(invalid.ready, false);
  assert.equal(invalid.issues[0].row, 2);
  assert.match(invalid.issues[0].messages.join(" "), /font lacks/iu);
  assert.equal(invalid.artifact, undefined);
});

test("venue signs and opposing-face table tents have physical A4 pages", async () => {
  verifyPdf(await run("venue_signs_export_pdf"), 2, 210, 297);
  verifyPdf(await run("table_tents_export_pdf"), 1, 210, 297);
});

test("lanyard ordering reconciles shared colors, excluded badges and spares", () => {
  const summary = run("lanyards_count", {
    people: [
      { role: "crew" },
      { role: "staff" },
      { role: "guest", included: false },
    ],
    colors: [
      { role: "crew", color: "blue" },
      { role: "staff", color: "blue" },
    ],
    spares: [{ role: "staff", count: 2 }],
  });
  assert.deepEqual(summary.byColor, { blue: 4 });
  assert.equal(summary.total, 4);
});

test("CSV imports preserve source identities, desk assignments, company and row diagnostics", () => {
  const csv =
    "Ticket Full Name;Ticket Email;Ticket Reference;Void Status\nZoë Marin;zoe@aalto.fi;FN-1;false\n;;FN-2;true";
  const imported = run("registration_import_csv", {
    csv,
    source: "tito",
  }).records;
  assert.equal(imported[0].company, "");
  assert.equal(imported[1].unassigned, true);
  assert.equal(imported[1].status, "cancelled");
  Object.assign(imported[1], {
    name: "Assigned",
    unassigned: false,
    assignedAtDesk: true,
    badge: true,
  });
  const reimport = run("registration_import_csv", {
    csv,
    source: "tito",
    previous: imported,
  }).records;
  assert.deepEqual(
    reimport.map((p) => p.id),
    imported.map((p) => p.id),
  );
  assert.equal(reimport[1].name, "Assigned");
  assert.throws(
    () =>
      run("registration_import_csv", {
        csv: csv + "\nBad;broken-address;T-3;false",
        source: "tito",
      }),
    /row 4.*invalid attendee email/iu,
  );
  const finnish = run("registration_import_csv", {
    source: "webropol",
    csv: "Webropol report\nNimi;Sähköposti;Tila\nAri;ari@example.test;peruttu",
  }).records;
  assert.equal(finnish[0].status, "cancelled");
});
