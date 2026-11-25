import { append, button, el, field, input, panel, select } from "./controls.ts";
import { importRegistrations } from "../../../toolkit/blocks/registration-csv.mts";
import { lanyardsCount } from "../../../toolkit/blocks/lanyard-count.mts";
import {
  prepareBadgeRun,
  renderBadgeArtwork,
} from "../../../toolkit/blocks/badge-artwork.mts";
import { loadBadgeFont, type BadgeFont } from "../badge-layout.ts";
import {
  renderVenueSheets,
  venueSheetCss,
  type VenuePrintEntry,
} from "../../../toolkit/blocks/venue-sheet.mts";

function controls(...items: Node[]) {
  const group = el("div");
  group.className = "demo-controls";
  append(group, ...items);
  return group;
}

function status(message = "") {
  const text = el("p", message);
  text.setAttribute("role", "status");
  return text;
}

function registrationImport(root: HTMLElement) {
  const csv = el("textarea");
  csv.rows = 4;
  csv.maxLength = 6000;
  csv.spellcheck = false;
  csv.value =
    "Ticket Full Name,Ticket Reference,Ticket Status\nZoë Marin,FN-1,paid\nAlex Li,FN-2,refunded";
  const result = panel("Imported roster");
  const summary = status();
  const rows = el("tbody");
  const table = el("table");
  const heading = table.createTHead().insertRow();
  for (const title of ["Name", "Ticket", "Status"]) {
    const cell = el("th", title);
    cell.scope = "col";
    heading.appendChild(cell);
  }
  table.appendChild(rows);
  table.style.overflowWrap = "anywhere";
  append(result.body, summary, table);

  function run() {
    rows.replaceChildren();
    try {
      const roster = importRegistrations({ csv: csv.value, source: "tito" });
      for (const record of roster.records) {
        const row = rows.insertRow();
        for (const value of [
          record.name || "Unassigned",
          record.ticketCode || "—",
          record.status,
        ]) {
          row.insertCell().textContent = String(value);
        }
      }
      summary.textContent = `${roster.imported} ${roster.imported === 1 ? "registration" : "registrations"} imported.`;
      table.hidden = false;
    } catch (error) {
      summary.textContent =
        error instanceof Error
          ? error.message
          : "Check the CSV header and rows.";
      table.hidden = true;
    }
  }
  append(
    root,
    field("Tito ticket CSV", csv),
    button("Import rows", run),
    result.panel,
  );
  run();
}

function checkIn(root: HTMLElement) {
  const desk = select(["Desk staff", "Organizer"]);
  const query = input("F-101", "search");
  const result = panel("Guest record");
  const detail = el("p");
  const activity = status();
  let arrived = false;
  const action = button("Record arrival", () => {
    arrived = !arrived;
    activity.textContent = arrived
      ? "Arrival recorded for Alex Li."
      : "The organizer undid Alex’s check-in.";
    update();
  });
  function update() {
    const term = query.value.toLowerCase().trim();
    const found =
      Boolean(term) &&
      ("alex li".includes(term) ||
        term === "f-101" ||
        term === "alex@example.test");
    detail.textContent = found
      ? `Alex Li · Example Studio · ${arrived ? "Checked in" : "Awaiting arrival"}`
      : term
        ? "No matching guest. Try Alex or F-101."
        : "Enter a name or ticket code.";
    action.textContent =
      arrived && desk.value === "Organizer"
        ? "Undo check-in"
        : "Record arrival";
    action.disabled = !found || (arrived && desk.value === "Desk staff");
  }
  desk.addEventListener("change", update);
  query.addEventListener("input", () => {
    activity.textContent = "";
    update();
  });
  append(result.body, detail, action, activity);
  append(
    root,
    controls(field("Act as", desk), field("Name or ticket code", query)),
    result.panel,
  );
  update();
}

let printFont: Promise<BadgeFont> | undefined;
function getPrintFont() {
  printFont ??= loadBadgeFont().catch((error: unknown) => {
    printFont = undefined;
    throw error;
  });
  return printFont;
}

function badges(root: HTMLElement) {
  const name = input("Zoë Marin");
  name.maxLength = 300;
  const role = select(["speaker", "attendee", "organizer", "sponsor"]);
  const result = panel("Badge proof");
  const drawing = el("div");
  const finding = status("Loading the print font…");
  append(result.body, drawing, finding);
  append(
    root,
    controls(field("Display name", name), field("Badge role", role)),
    result.panel,
  );
  void getPrintFont()
    .then((font) => {
      function draw() {
        const run = prepareBadgeRun({
          people: [
            { name: name.value, company: "Field Notes", role: role.value },
          ],
        });
        const row = run.rows[0]!;
        const { svg, issues } = renderBadgeArtwork(
          row.person,
          run.settings,
          font,
          true,
          false,
          row.appearance,
          null,
        );
        svg.style.cssText =
          "display:block;width:100%;max-width:16rem;height:auto;margin:auto";
        drawing.replaceChildren(svg);
        finding.textContent = issues.length
          ? issues.join(" ")
          : "Name and affiliation fit within the safe area.";
      }
      name.addEventListener("input", draw);
      role.addEventListener("change", draw);
      draw();
    })
    .catch(() => {
      finding.textContent =
        "The print font could not load. Reset the example to try again.";
    });
}

function lanyards(root: HTMLElement) {
  const spares = input("2", "number");
  spares.min = "0";
  spares.max = "2000";
  spares.required = true;
  const speakerColor = select(["Red", "Blue"]);
  const result = panel("Supplier order");
  const count = status();
  const breakdown = el("ul");
  const people = [
    ...Array.from({ length: 8 }, () => ({ role: "attendee" })),
    { role: "speaker" },
    { role: "speaker" },
  ];
  function total() {
    breakdown.replaceChildren();
    if (!spares.validity.valid) {
      count.textContent = "Enter a whole number of spares between 0 and 2,000.";
      return;
    }
    const order = lanyardsCount({
      people,
      spares: [{ role: "attendee", count: spares.valueAsNumber }],
      colors: [
        { role: "attendee", color: "Blue" },
        { role: "speaker", color: speakerColor.value },
      ],
    });
    for (const [color, quantity] of Object.entries(order.byColor)) {
      const line = el("li");
      line.className = "flex items-center gap-2 py-1";
      const swatch = el("span");
      swatch.setAttribute("aria-hidden", "true");
      swatch.className = "h-4 w-4 border border-ink/25";
      swatch.style.backgroundColor = color === "Blue" ? "#4086d1" : "#d44b41";
      line.replaceChildren(
        swatch,
        `${quantity} ${color.toLowerCase()} lanyards`,
      );
      breakdown.appendChild(line);
    }
    count.textContent = `${order.total} lanyards in total.`;
  }
  spares.addEventListener("input", total);
  speakerColor.addEventListener("change", total);
  append(result.body, breakdown, count);
  append(
    root,
    controls(
      field("Spare attendee lanyards", spares),
      field("Speaker color", speakerColor),
    ),
    result.panel,
  );
  total();
}

function paperProof() {
  const holder = el("div");
  holder.style.cssText =
    "display:block;container-type:inline-size;width:100%;max-width:18rem;margin:auto;background:white;color:#192027;box-shadow:0 1px 6px #0003";
  holder.setAttribute("role", "img");
  // Isolate the print sheet's type, margins and rotated faces from the site's styles.
  const shadow = holder.attachShadow({ mode: "open" });
  const style = el("style");
  // One container width represents the 210 mm edge of the A4 original.
  style.textContent = venueSheetCss.replace(
    /(-?[\d.]+)(mm|pt)/gu,
    (_, value: string, unit: string) => {
      const mm = Number(value) * (unit === "pt" ? 25.4 / 72 : 1);
      return `${(mm / 210) * 100}cqw`;
    },
  );
  const paper = el("div");
  paper.style.fontFamily = "sans-serif";
  void getPrintFont()
    .then((font) => {
      paper.style.fontFamily = font.family;
    })
    .catch(() => {});
  append(shadow, style, paper);
  function draw(row: VenuePrintEntry, label: string) {
    holder.setAttribute("aria-label", label);
    paper.replaceChildren();
    renderVenueSheets({
      target: paper,
      eventName: "Field Notes Forum",
      entries: [row],
    });
  }
  return { holder, draw };
}

function venueSigns(root: HTMLElement) {
  const destination = input("Registration");
  destination.maxLength = 100;
  const direction = select(["Left", "Right", "Ahead"]);
  const result = panel("A4 venue sign");
  const proof = paperProof();
  function draw() {
    const arrow =
      direction.value === "Left"
        ? "left"
        : direction.value === "Right"
          ? "right"
          : "ahead";
    proof.draw(
      { title: destination.value, direction: arrow },
      `A4 sign for ${destination.value || "an unnamed destination"}, pointing ${arrow}.`,
    );
  }
  destination.addEventListener("input", draw);
  direction.addEventListener("change", draw);
  result.body.appendChild(proof.holder);
  append(
    root,
    controls(field("Destination", destination), field("Direction", direction)),
    result.panel,
  );
  draw();
}

function tableTents(root: HTMLElement) {
  const topic = input("Local knowledge");
  topic.maxLength = 100;
  const question = input("What could we learn from our neighbors?");
  question.maxLength = 280;
  const result = panel("A4 fold layout");
  const proof = paperProof();
  function draw() {
    proof.draw(
      { label: "Table 3", topic: topic.value, question: question.value },
      `Two faces for Table 3. ${topic.value}. ${question.value}`,
    );
  }
  topic.addEventListener("input", draw);
  question.addEventListener("input", draw);
  result.body.appendChild(proof.holder);
  append(
    root,
    controls(
      field("Discussion topic", topic),
      field("Starter question", question),
    ),
    result.panel,
  );
  draw();
}

export const venueDemos: Record<string, (root: HTMLElement) => void> = {
  "registration-import": registrationImport,
  "check-in": checkIn,
  badges,
  lanyards,
  "venue-signs": venueSigns,
  "table-tents": tableTents,
};
