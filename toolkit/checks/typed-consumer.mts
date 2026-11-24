// Compiled from an independent project after installing the package tarball.
import {
  createToolkit,
  type OperationInput,
  type OperationResult,
  type StorageScope,
} from "@sdlcai/event-toolkit";
import { DatabaseSync } from "node:sqlite";

// A custom host can supply the Node driver directly, without its own row generics.
declare const crypto: Pick<StorageScope, "seal" | "open" | "fingerprint">;
const scope: StorageScope = { db: new DatabaseSync(":memory:"), ...crypto };
createToolkit({
  storage: () => ({ event: () => scope, shared: () => scope, close() {} }),
});

const kit = createToolkit();
const roster = await kit.run("checkin_roster");
const version: number = roster.rosterRevision;
const input: OperationInput<"checkin_register"> = {
  rosterRevision: version,
  people: [{ id: "badge-1", name: "Fictional speaker" }],
};
const imported: OperationResult<"checkin_register"> = await kit.run(
  "checkin_register",
  input,
);
const counts = await kit.run("lanyards_count", {
  people: [{ role: "speaker" }],
});
const total: number = counts.byColor.blue ?? counts.total;
await kit.run("feedback_respond", {
  version: 1,
  consent: true,
  answers: { recommend: 8 },
});

// @ts-expect-error A known operation checks the type of its fields.
await kit.run("organizers_create", { name: 12 });
// @ts-expect-error A required input cannot be omitted.
await kit.run("checkin_register");
// @ts-expect-error Empty input objects reject extra properties.
await kit.run("checkin_roster", { token: "unexpected" });
// @ts-expect-error Operation-specific results expose their actual fields.
imported.people;
// @ts-expect-error Unknown literal operation names are usually spelling mistakes.
await kit.run("lanjards_count", {});

// Names received through discovery are strings. The server validates that input.
declare const discovered: string, raw: unknown;
await kit.run(discovered, raw);
// Previously supported explicit result assertions remain available to embedding applications.
const legacy = await kit.run<{ total: number }>("lanyards_count", {
  people: [],
});
const typed: number = legacy.total;
void [typed, total];
