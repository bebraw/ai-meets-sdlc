import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../site/scripts/badge-model.ts";
import { redeemRegistrationGrant } from "../worker/registration-auth.ts";
import {
  addManualAttendee,
  importAttendeeCsv,
  mergeAttendeeImport,
  detectAttendeeMapping,
  parseAttendeeRoster,
  prepareAttendeeCsv,
} from "../site/scripts/attendee-model.ts";

test("manual attendees have independent identities and survive provider imports", () => {
  const input = {
    name: "  Manual Zoë  ",
    email: "MANUAL@example.test",
    company: "Company",
    ticketCode: "",
    status: "active",
    badge: false,
    type: "sponsor",
    diet: "Vegan",
  };
  const roster = addManualAttendee([], input);
  assert.equal(roster[0].source, "manual");
  assert.equal(roster[0].name, "Manual Zoë");
  assert.equal(roster[0].email, "manual@example.test");
  assert.match(roster[0].id, /^[0-9a-f-]{36}$/u);
  assert.throws(() => addManualAttendee(roster, input), /already exists/);
  const imported = mergeAttendeeImport(roster, "tito", [
    { ...input, name: "Imported name", type: "attendee", diet: "Gluten free" },
  ]);
  assert.deepEqual(imported[0], roster[0]);
  assert.equal(imported.length, 2);
  assert.equal(roster.length, 1);
  const ticket = { ...input, email: "", ticketCode: "MANUAL-1" };
  const ticketRoster = addManualAttendee(roster, ticket);
  assert.throws(
    () =>
      addManualAttendee(ticketRoster, { ...ticket, ticketCode: "manual-1" }),
    /already exists/,
  );
  assert.throws(
    () => addManualAttendee([], { ...input, email: "" }),
    /ticket code or attendee email/,
  );
});

test("manual creation enforces the shared roster capacity without changing existing people", () => {
  const input = {
    name: "Guest",
    email: "guest@example.test",
    company: "",
    ticketCode: "",
    status: "active",
    badge: true,
  };
  const roster = Array.from({ length: 2000 }, (_, index) => ({
    ...input,
    email: `guest-${index}@example.test`,
    id: String(index),
    source: "manual",
    sourceKey: `email:guest-${index}@example.test`,
    type: "attendee",
  }));
  assert.throws(() => addManualAttendee(roster, input));
  assert.equal(roster.length, 2000);
});

const mapping = {
  name: 0,
  email: 1,
  ticketCode: 2,
  status: 3,
  company: -1,
  first: -1,
  last: -1,
};
test("sponsor Tito imports keep diets and ticket identities, and default refreshes preserve types", () => {
  const prepared = prepareAttendeeCsv(
    "Ticket Full Name,Ticket Email,Ticket Reference,Void Status,What kind of food restrictions do you have?\nSponsor Zoë,sponsor@example.test,SP-1,,Vegan and gluten free",
  );
  const detected = detectAttendeeMapping(prepared.records[0].cells);
  const rows = importAttendeeCsv(prepared.records, detected, "sponsor");
  assert.equal(rows[0].type, "sponsor");
  assert.equal(rows[0].diet, "Vegan and gluten free");
  const roster = mergeAttendeeImport([], "tito", rows);
  assert.equal(roster[0].source, "tito");
  assert.equal(roster[0].type, "sponsor");
  const refresh = importAttendeeCsv(prepared.records, detected);
  const refreshed = mergeAttendeeImport(roster, "tito", refresh);
  assert.equal(refreshed[0].id, roster[0].id);
  assert.equal(refreshed[0].type, "sponsor");
  assert.equal(mergeAttendeeImport([], "tito", refresh)[0].type, "attendee");
  assert.equal(
    mergeAttendeeImport(
      refreshed,
      "tito",
      importAttendeeCsv(prepared.records, detected, "attendee"),
    )[0].type,
    "attendee",
  );
  const { type, ...legacy } = roster[0];
  assert.equal(parseAttendeeRoster([legacy])[0].type, "attendee");
  assert.throws(() =>
    mergeAttendeeImport(roster, "tito", [{ ...rows[0], type: "unknown" }]),
  );
});

test("attendee imports retain Unicode, reject unknown status and require individual registration identities", () => {
  const rows = importAttendeeCsv(
    parseCsv(
      "Name,Email,Reference,Status\nZoë Åström,zoe@aalto.fi,ABC-123,valid\n李 小明,li@example.test,ABC-124,refunded",
      ",",
    ),
    mapping,
  );
  assert.equal(rows[0].name, "Zoë Åström");
  assert.equal(rows[0].company, "Aalto University");
  assert.equal(rows[1].status, "cancelled");
  assert.throws(
    () =>
      importAttendeeCsv(
        parseCsv(
          "Name,Email,Reference,Status\nPerson,p@example.test,CODE,pending",
          ",",
        ),
        mapping,
      ),
    /unknown ticket status/,
  );
  assert.throws(
    () =>
      importAttendeeCsv(
        parseCsv("Name,Email,Reference,Status\nPerson,,,valid", ","),
        mapping,
      ),
    /ticket code or attendee email/,
  );
  assert.throws(
    () =>
      mergeAttendeeImport([], "tito", [
        rows[0],
        { ...rows[0], ticketCode: "abc-123" },
      ]),
    /Duplicate ticket/,
  );
  assert.throws(
    () =>
      importAttendeeCsv(
        parseCsv(
          "Name,Email,Reference,Status\nPerson,p@example.test,CODE,valid,extra",
          ",",
        ),
        mapping,
      ),
    /expected 4 columns/,
  );
});

test("Tito semicolon exports detect the final diet column and interpret blank Void Status as active", () => {
  const prepared = prepareAttendeeCsv(
    '\uFEFFTicket Full Name;Ticket Email;Ticket Reference;Void Status;What kind of food restrictions do you have?\r\nZoë Åström;zoe@example.test;ABC-123;;"Vegan and gluten free\nplease"\r\nLee;lee@example.test;ABC-124;true;None',
  );
  assert.equal(prepared.delimiter, ";");
  assert.equal(prepared.ignoredRows, 0);
  const detected = detectAttendeeMapping(prepared.records[0].cells);
  assert.equal(detected.diet, 4);
  const rows = importAttendeeCsv(prepared.records, detected);
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].diet, "Vegan and gluten free\nplease");
  assert.equal(rows[1].status, "cancelled");
  assert.equal(prepared.records[2].row, 4);
});

test("Tito imports skip unassigned tickets without using the purchaser's details", () => {
  const prepared = prepareAttendeeCsv(
    [
      "Registration Name,Registration Email,Ticket Full Name,Ticket First Name,Ticket Last Name,Ticket Email,Ticket Company Name,Void Status,Ticket Reference,What kind of food restrictions do you have?",
      "Purchaser,purchaser@example.test,,,,,,,UNASSIGNED,",
      'Purchaser,purchaser@example.test,Zoë Åström,Zoë,Åström,zoe@example.test,"Example, Ltd",,ASSIGNED,"Vegan\nand gluten free"',
      "Purchaser,purchaser@example.test,Lee,Lee,,lee@example.test,,true,CANCELLED,Dairy free",
    ].join("\n"),
  );
  const detected = detectAttendeeMapping(prepared.records[0].cells);
  const rows = importAttendeeCsv(prepared.records, detected, "sponsor", "tito");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Zoë Åström");
  assert.equal(rows[0].email, "zoe@example.test");
  assert.equal(rows[0].ticketCode, "ASSIGNED");
  assert.equal(rows[0].company, "Example, Ltd");
  assert.equal(rows[0].diet, "Vegan\nand gluten free");
  assert.equal(rows[0].status, "active");
  assert.equal(rows[0].type, "sponsor");
  assert.equal(rows[1].ticketCode, "CANCELLED");
  assert.equal(rows[1].status, "cancelled");
  assert.equal(rows[1].diet, "Dairy free");
  const roster = mergeAttendeeImport([], "tito", rows);
  assert.equal(roster.length, 2);
  const assigned = prepared.records.map((record, index) =>
    index === 1
      ? {
          ...record,
          cells: [
            "Purchaser",
            "purchaser@example.test",
            "New Attendee",
            "New",
            "Attendee",
            "new@example.test",
            "",
            "",
            "UNASSIGNED",
            "Nut allergy",
          ],
        }
      : record,
  );
  const refreshed = mergeAttendeeImport(
    roster,
    "tito",
    importAttendeeCsv(assigned, detected, "sponsor", "tito"),
  );
  assert.equal(refreshed.length, 3);
  assert.equal(refreshed[0].id, roster[0].id);
  assert.equal(refreshed[1].id, roster[1].id);
  assert.equal(refreshed[2].ticketCode, "UNASSIGNED");
  assert.equal(refreshed[2].name, "New Attendee");
  assert.equal(refreshed[2].diet, "Nut allergy");
  assert.throws(
    () => importAttendeeCsv(prepared.records, detected, undefined, "webropol"),
    /Row 2: name is missing/,
  );
});

test("skipping unassigned Tito tickets keeps malformed rows and unknown statuses visible", () => {
  const header = "Ticket Full Name,Ticket Email,Ticket Reference,Void Status";
  const importRow = (row, selected = {}) => {
    const prepared = prepareAttendeeCsv(`${header}\n${row}`);
    return importAttendeeCsv(
      prepared.records,
      { ...detectAttendeeMapping(prepared.records[0].cells), ...selected },
      undefined,
      "tito",
    );
  };
  assert.throws(() => importRow(",,UNASSIGNED,"), /No assigned attendees/);
  assert.throws(() => importRow(",,UNASSIGNED"), /expected 4 columns/);
  assert.throws(
    () => importRow(",,UNASSIGNED,pending"),
    /unknown ticket status/,
  );
  assert.throws(() => importRow(",,CANCELLED,true"), /name is missing/);
  assert.throws(
    () => importRow(",person@example.test,TICKET,"),
    /name is missing/,
  );
  assert.throws(
    () => importRow("Person,,TICKET,", { name: -1 }),
    /Map a full name/,
  );
  assert.throws(() => importRow(",,TICKET,", { email: -1 }), /name is missing/);
  assert.throws(() => importRow(",,,false"), /name is missing/);
  const invalidAfterUnassigned = prepareAttendeeCsv(
    `${header}\n,,UNASSIGNED,\nPerson,person@example.test,ASSIGNED,pending`,
  );
  assert.throws(
    () =>
      importAttendeeCsv(
        invalidAfterUnassigned.records,
        detectAttendeeMapping(invalidAfterUnassigned.records[0].cells),
        undefined,
        "tito",
      ),
    /Row 3: unknown ticket status/,
  );
  const rows = importRow("Person,,TICKET,");
  assert.equal(rows[0].ticketCode, "TICKET");
  assert.equal(rows[0].email, "");
});

test("Webropol metadata and split headers use the attendee identity and original CSV line numbers", () => {
  const csv = [
    ";Tapahtuman nimi;SDLCAI 2026;;;;;;;;;",
    ";Paikka;Marsio;;;;;;;;;",
    "#;Ilm.aika;Etunimi;Sukunimi;Sähköposti;Matkapuhelin;;Tila;-;;;",
    "-;-;-;-;-;-;-;-;Etunimi;Sukunimi;Sähköposti;Ruokarajoitteet",
    "1;;Booker;Surname;booker@example.test;;;Ilmoittautunut;Actual;Attendee;actual@example.test;Laktoositon",
    "2;;Booker;Surname;booker@example.test;;;Peruutettu;Other;Attendee;other@example.test;Ei sianlihaa",
  ].join("\n");
  const prepared = prepareAttendeeCsv(csv);
  assert.equal(prepared.delimiter, ";");
  assert.equal(prepared.ignoredRows, 3);
  const detected = detectAttendeeMapping(prepared.records[0].cells);
  assert.equal(detected.first, 8);
  assert.equal(detected.last, 9);
  assert.equal(detected.email, 10);
  assert.equal(detected.diet, 11);
  assert.equal(detected.status, 7);
  const rows = importAttendeeCsv(prepared.records, detected);
  assert.equal(rows[0].name, "Actual Attendee");
  assert.equal(rows[0].email, "actual@example.test");
  assert.equal(rows[0].diet, "Laktoositon");
  assert.equal(rows[1].status, "cancelled");
  assert.equal(prepared.records[1].row, 5);
  assert.throws(
    () =>
      importAttendeeCsv(
        prepared.records.map((row, index) =>
          index === 1
            ? {
                ...row,
                cells: [
                  ...row.cells.slice(0, 7),
                  "Unknown",
                  ...row.cells.slice(8),
                ],
              }
            : row,
        ),
        detected,
      ),
    /Row 5: unknown ticket status/,
  );
});

test("unmapped refreshes preserve diets, mapped blanks clear them, and legacy rosters remain readable", () => {
  const csv = prepareAttendeeCsv(
    "Name,Email,Reference,Status,Diet\nPerson,p@example.test,CODE,valid,vegan",
  );
  const detected = detectAttendeeMapping(csv.records[0].cells);
  const mapped = importAttendeeCsv(csv.records, detected);
  const roster = mergeAttendeeImport([], "tito", mapped);
  const unmapped = importAttendeeCsv(csv.records, { ...detected, diet: -1 });
  assert.equal(Object.hasOwn(unmapped[0], "diet"), false);
  assert.equal(mergeAttendeeImport(roster, "tito", unmapped)[0].diet, "vegan");
  assert.equal(
    mergeAttendeeImport(roster, "tito", [{ ...mapped[0], diet: "" }])[0].diet,
    "",
  );
  const { diet, ...legacy } = roster[0];
  assert.equal(parseAttendeeRoster([legacy])[0].diet, undefined);
  assert.throws(() =>
    mergeAttendeeImport(roster, "tito", [
      { ...mapped[0], diet: "x".repeat(2001) },
    ]),
  );
});
test("source refresh preserves identities and badge decisions and does not remove omitted registrations", () => {
  const input = {
    name: "First",
    email: "one@example.test",
    company: "",
    ticketCode: "A-1",
    status: "active",
    badge: true,
  };
  const roster = mergeAttendeeImport([], "tito", [
    input,
    { ...input, ticketCode: "A-2" },
  ]);
  roster[0].badge = false;
  const refreshed = mergeAttendeeImport(roster, "tito", [
    { ...input, name: "Updated", status: "cancelled" },
  ]);
  assert.equal(refreshed.length, 2);
  assert.equal(refreshed[0].id, roster[0].id);
  assert.equal(refreshed[0].name, "Updated");
  assert.equal(refreshed[0].badge, false);
  assert.equal(refreshed[0].status, "cancelled");
  assert.equal(mergeAttendeeImport(refreshed, "webropol", [input]).length, 3);
});

test("registration sessions use a fresh HttpOnly secure cookie on HTTPS", async () => {
  const env = {
    EMAIL_ENCRYPTION_KEY: "registration-cookie-unit-secret",
    INTERESTS: {
      prepare() {
        return {
          bind() {
            return this;
          },
          async run() {
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
  const token = "a".repeat(43);
  const cookie = await redeemRegistrationGrant(
    new Request("https://sdlcai.org/api/registration/session"),
    env,
    token,
  );
  assert.match(
    cookie,
    /; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1209600; Secure$/,
  );
  assert.ok(
    !cookie.includes(token),
    "Session credentials differ from the reusable staff link",
  );
  assert.equal(
    await redeemRegistrationGrant(
      new Request("https://sdlcai.org/api/registration/session"),
      env,
      "invalid",
    ),
    null,
  );
});
