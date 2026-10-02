import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../site/scripts/badge-model.ts";
import { redeemRegistrationGrant } from "../worker/registration-auth.ts";
import {
  importAttendeeCsv,
  mergeAttendeeImport,
} from "../site/scripts/attendee-model.ts";

const mapping = {
  name: 0,
  email: 1,
  ticketCode: 2,
  status: 3,
  company: -1,
  first: -1,
  last: -1,
};
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
