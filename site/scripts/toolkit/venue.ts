import {
  append,
  button,
  copySetup,
  el,
  field,
  input,
  panel,
  select,
} from "./controls.ts";
import {
  importRegistrations,
  prepareRegistrationHandoffs,
  registrationExample,
} from "../../../toolkit/blocks/registration-csv.mts";
import { lanyardsCount } from "../../../toolkit/blocks/lanyard-count.mts";
import {
  badgeShapes,
  badgeAttachments,
  prepareBadgeRun,
  renderBadgeArtwork,
} from "../../../toolkit/blocks/badge-artwork.mts";
import { loadBadgeFont } from "../badge-layout.ts";
import {
  planBadgeSheets,
  renderBadgeSheet,
  badgePaperSizes,
} from "../../../toolkit/blocks/badge-sheets.mts";
import { fieldNotesLogo } from "../../../toolkit/blocks/print-examples.mts";
import {
  attachmentSelect,
  paperSelect,
  sheetDescription,
  fontSelect,
  badgeShapeSelect,
} from "../print-options.ts";
import { printFontIds } from "../../../toolkit/blocks/print-fonts.mts";
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
  csv.value = registrationExample.csv;
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
  const destinations = el("ul");
  append(result.body, summary, table, destinations);
  csv.addEventListener("input", () => {
    summary.textContent =
      "Import the edited rows to update the roster and counts.";
    table.hidden = true;
    destinations.replaceChildren();
  });

  function run() {
    rows.replaceChildren();
    destinations.replaceChildren();
    try {
      const roster = importRegistrations({ csv: csv.value, source: "tito" });
      const { badges, desk, meals } = prepareRegistrationHandoffs(
        roster.records,
      );
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
      for (const [id, label] of [
        ["badges", `Name badge guide · ${badges.length} eligible`],
        [
          "check-in",
          `Check-in guide · ${desk.length} ${desk.length === 1 ? "ticket" : "tickets"}, ${meals.length} active`,
        ],
        [
          "catering",
          `Catering guide · ${meals.length} ${meals.length === 1 ? "meal" : "meals"}`,
        ],
      ] as const) {
        const link = el("a", label);
        link.href = "/toolkit/" + id + "/";
        link.className = "underline underline-offset-4";
        const item = el("li");
        item.appendChild(link);
        destinations.appendChild(item);
      }
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

function badges(root: HTMLElement) {
  const name = input("Zoë Marin");
  name.maxLength = 300;
  const role = select(["speaker", "attendee", "organizer", "sponsor"]);
  const shape = badgeShapeSelect();
  const typeface = fontSelect();
  const attachment = attachmentSelect();
  const logo = select(["No logo", "Field Notes logo"]);
  const paper = paperSelect();
  function numberField(value: number, min: number, max: number, step: number) {
    const control = input(String(value), "number");
    Object.assign(control, {
      min: String(min),
      max: String(max),
      step: String(step),
      required: true,
    });
    return control;
  }
  const trim = numberField(100, 70, 150, 0.5);
  const bleed = numberField(0, 0, 10, 0.5);
  const margin = numberField(5, 0, 50, 0.5);
  const spares = numberField(0, 0, 2000, 1);
  const marks = select(["Show cut marks", "Omit cut marks"]);
  const sides = select(["Front only", "Matching back"]);
  const sheetControls = controls(
    field("Printer margin (mm)", margin),
    field("Cut marks", marks),
  );
  const printSettings = el("details");
  const advanced = el("div");
  advanced.className = "mt-3 grid gap-3";
  append(
    advanced,
    controls(
      field("Trim width (mm)", trim),
      field("Bleed per edge (mm)", bleed),
    ),
    controls(
      field("Spare attendee badges", spares),
      field("Printed sides", sides),
    ),
    sheetControls,
  );
  append(printSettings, el("summary", "Print settings"), advanced);
  const result = panel("Badge proof");
  const drawing = el("div");
  const finding = status("Loading the print font…");
  const sheet = el("figure");
  sheet.className = "demo-sheet";
  const counts = status();
  function setup() {
    if (!name.value.trim()) throw Error("Enter a display name.");
    for (const control of [
      trim,
      bleed,
      spares,
      ...(paper.value === "single" ? [] : [margin]),
    ]) {
      if (!control.validity.valid)
        throw Error("Check " + control.labels?.[0]?.textContent + ".");
    }
    const sheetPaper = badgePaperSizes[paper.selectedIndex] ?? "single";
    const settings = {
      shape: badgeShapes[shape.selectedIndex] ?? "circle",
      font: printFontIds[typeface.selectedIndex] ?? "noto-sans",
      attachment: badgeAttachments[attachment.selectedIndex] ?? "lanyard",
      paper: sheetPaper,
      diameter: trim.valueAsNumber,
      bleed: bleed.valueAsNumber,
      doubleSided: sides.selectedIndex === 1,
      ...(sheetPaper === "single"
        ? {}
        : {
            sheetMargin: margin.valueAsNumber,
            cutMarks: marks.selectedIndex === 0,
          }),
    };
    return {
      people: [{ name: name.value, company: "Field Notes", role: role.value }],
      ...(spares.valueAsNumber
        ? { spares: [{ role: "attendee", count: spares.valueAsNumber }] }
        : {}),
      ...(logo.selectedIndex === 1 ? { logo: fieldNotesLogo } : {}),
      settings,
    };
  }
  append(result.body, drawing, finding, sheet, counts);
  append(
    root,
    controls(field("Display name", name), field("Badge role", role)),
    controls(field("Badge shape", shape), field("Print font", typeface)),
    controls(field("Attachment", attachment), field("Event logo", logo)),
    field("Print paper", paper),
    printSettings,
    result.panel,
    copySetup(root, "Print name badges and select Preflight", () => {
      const input = setup();
      planBadgeSheets(input.settings, 1 + spares.valueAsNumber);
      return input;
    }),
  );
  let revision = 0;
  async function draw() {
    const current = ++revision;
    sheetControls.hidden = paper.value === "single";
    try {
      const input = setup();
      const run = prepareBadgeRun(input);
      const plan = run.plan;
      const font = await loadBadgeFont(input.settings.font);
      if (current !== revision) return;
      const render = (row: (typeof run.rows)[number], preview: boolean) =>
        renderBadgeArtwork(
          row.person,
          preview ? run.settings : { ...run.settings, guides: true },
          font,
          preview,
          row.source === "spares",
          row.appearance,
          input.logo ?? null,
        );
      const { svg, issues } = render(run.rows[0]!, true);
      svg.style.cssText =
        "display:block;width:100%;max-width:16rem;height:auto;margin:auto";
      drawing.replaceChildren(svg);
      finding.textContent = issues.length
        ? issues.join(" ")
        : "Name and affiliation fit within the safe area.";
      sheet.replaceChildren();
      if (plan.paper !== "single") {
        const copies = run.rows.map((row) => render(row, false).svg);
        const front = renderBadgeSheet(
          plan,
          plan.pages[0]!,
          (index) => copies[index ? 1 : 0]!,
        );
        append(
          sheet,
          front,
          el("figcaption", "First sheet · outlines show badge placement"),
        );
      }
      counts.textContent = sheetDescription(plan);
    } catch (error) {
      if (current !== revision) return;
      drawing.replaceChildren();
      sheet.replaceChildren();
      counts.textContent = "";
      finding.textContent =
        error instanceof Error
          ? error.message
          : "The badge proof could not load.";
    }
  }
  root.addEventListener("input", draw);
  void draw();
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
  const typeface = fontSelect();
  const fontStatus = status();
  let revision = 0;
  async function changeFont() {
    const current = ++revision;
    paper.style.visibility = "hidden";
    try {
      const font = await loadBadgeFont(printFontIds[typeface.selectedIndex]);
      if (current !== revision) return;
      paper.style.fontFamily = font.family;
      paper.style.visibility = "";
      fontStatus.textContent = "";
    } catch (error) {
      if (current !== revision) return;
      fontStatus.textContent =
        error instanceof Error
          ? error.message
          : "The print font could not load.";
    }
  }
  typeface.addEventListener("change", changeFont);
  void changeFont();
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
  return {
    holder,
    draw,
    font: () => printFontIds[typeface.selectedIndex] ?? "noto-sans",
    fontField: field("Print font", typeface),
    fontStatus,
  };
}

function venueSigns(root: HTMLElement) {
  const destination = input("Registration");
  destination.maxLength = 100;
  const direction = select(["Left", "Right", "Ahead"]);
  const result = panel("A4 venue sign");
  const proof = paperProof();
  function entry() {
    return {
      title: destination.value,
      direction:
        direction.value === "Left"
          ? ("left" as const)
          : direction.value === "Right"
            ? ("right" as const)
            : ("ahead" as const),
    };
  }
  function draw() {
    const row = entry();
    proof.draw(
      row,
      `A4 sign for ${row.title || "an unnamed destination"}, pointing ${row.direction}.`,
    );
  }
  destination.addEventListener("input", draw);
  direction.addEventListener("change", draw);
  append(result.body, proof.holder, proof.fontStatus);
  append(
    root,
    controls(
      field("Destination", destination),
      field("Direction", direction),
      proof.fontField,
    ),
    result.panel,
    copySetup(root, "Print venue signs", () => {
      if (!destination.value.trim()) throw Error("Enter a destination.");
      return {
        eventName: "Field Notes Forum",
        font: proof.font(),
        signs: [entry()],
      };
    }),
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
  function entry() {
    return {
      label: "Table 3",
      topic: topic.value,
      ...(question.value.trim() ? { question: question.value } : {}),
    };
  }
  function draw() {
    proof.draw(
      entry(),
      `Two faces for Table 3. ${topic.value}. ${question.value}`,
    );
  }
  topic.addEventListener("input", draw);
  question.addEventListener("input", draw);
  append(result.body, proof.holder, proof.fontStatus);
  append(
    root,
    controls(
      field("Discussion topic", topic),
      field("Starter question", question),
      proof.fontField,
    ),
    result.panel,
    copySetup(root, "Print discussion table tents", () => {
      if (!topic.value.trim()) throw Error("Enter a discussion topic.");
      return {
        eventName: "Field Notes Forum",
        font: proof.font(),
        tables: [entry()],
      };
    }),
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
