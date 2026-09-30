import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  parseCsv,
  importCsv,
  duplicateIds,
  defaultSettings,
  parseWorkspace,
} from "../site/scripts/badge-model.ts";
import { fontCoverage } from "../site/scripts/badge-layout.ts";
const mapping = { name: 0, company: 1, email: 2, first: -1, last: -1 };
test("CSV preserves quoted Unicode names, multiline fields, BOM, delimiters, and source rows", () => {
  const records = parseCsv(
    '\uFEFFTicket Full Name,Ticket Company Name,Ticket Email\r\n"Määttä, Zoë","Research\r\nLab",zoe@example.test\r\n',
    ",",
  );
  const [person] = importCsv(records, mapping, "tito.csv");
  assert.equal(person.name, "Määttä, Zoë");
  assert.equal(person.company, "Research\nLab");
  assert.equal(person.source, "tito.csv / row 2");
  assert.equal(
    importCsv(
      parseCsv("Name;Company;Email\nŁukasz Żółć;Aalto;test@example.test", ";"),
      mapping,
      "webropol.csv",
    )[0].name,
    "Łukasz Żółć",
  );
  assert.throws(() => parseCsv('name\n"unclosed', ","), /Unclosed/);
  assert.throws(() => parseCsv('name\n"a"junk', ","), /Malformed/);
  assert.throws(
    () => importCsv(parseCsv("name,company,email\nA,B", ","), mapping, "x"),
    /columns/,
  );
  assert.throws(
    () =>
      importCsv(
        parseCsv("name,company,email\n,B,a@example.test", ","),
        mapping,
        "x",
      ),
    /missing/,
  );
  assert.throws(
    () =>
      importCsv(
        parseCsv("name,company,email\nA,B,not-email", ","),
        mapping,
        "x",
      ),
    /invalid/,
  );
});
test("duplicate emails require explicit decisions and names alone never merge", () => {
  const people = importCsv(
    parseCsv(
      "name,company,email\nSame,,A@example.test\nDifferent,,a@example.test\nSame,,b@example.test",
      ",",
    ),
    mapping,
    "x",
  );
  assert.equal(duplicateIds(people).size, 2);
  people[1].included = false;
  assert.equal(duplicateIds(people).size, 0);
  people[1].included = true;
  people[0].duplicateReviewed = true;
  people[1].duplicateReviewed = true;
  assert.equal(duplicateIds(people).size, 0);
  assert.throws(
    () =>
      parseWorkspace({
        people: [people[0], people[0]],
        settings: defaultSettings,
      }),
    /unique/,
  );
  assert.throws(() =>
    parseWorkspace({ people, settings: { ...defaultSettings, diameter: 0 } }),
  );
});
test("bundled font covers extended Latin and combining accents, and detects absent glyphs", async () => {
  const bytes = await readFile("assets/badges/NotoSans.ttf");
  const has = fontCoverage(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  for (const char of "Juho VepsäläinenŁukaszŻółćZoëNguyễnΑλέξανδροςЖуков\u0301")
    assert.ok(has(char.codePointAt(0)), char);
  assert.equal(has(0x10ffff), false);
});
