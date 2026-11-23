import { writeFile } from "node:fs/promises";
import { createToolkit } from "@sdlcai/event-toolkit";

const toolkit = createToolkit({
  enabled: ["registration-import", "badges", "lanyards"],
});
try {
  const input = {
    source: "tito",
    csv: "Ticket Full Name,Ticket Reference\nZoë Marin,F-1\nAri Chen,F-2",
  };
  const { records } = await toolkit.run("registration_import_csv", input);
  const people = records.map(({ name, company }) => ({
    name,
    company,
    role: "speaker",
  }));
  const spares = [{ role: "attendee", count: 1 }];
  const run = await toolkit.run("badges_export_pdf", {
    people,
    spares,
    settings: { diameter: 100, bleed: 3 },
  });
  if (!run.ready) throw Error(JSON.stringify(run.issues));
  await writeFile("badges.pdf", run.artifact.bytes);
  const order = await toolkit.run("lanyards_count", {
    people: people.map(({ role }) => ({ role })),
    spares,
  });
  console.log("Wrote badges.pdf", order);
} finally {
  await toolkit.close();
}
