export const badgePaperSizes = ["single", "a4", "letter"] as const;
export type BadgePaper = (typeof badgePaperSizes)[number];
export const badgePaperLabels: Record<BadgePaper, string> = {
  single: "One badge per page",
  a4: "A4",
  letter: "US Letter",
};
const sheetSizes = { a4: [210, 297], letter: [215.9, 279.4] } as const;
const markGap = 1;
const markLength = 3;
const markRoom = markGap + markLength;

export interface BadgeSheetSettings {
  paper?: BadgePaper;
  sheetMargin?: number;
  cutMarks?: boolean;
  doubleSided?: boolean;
  diameter: number;
  bleed: number;
}

export interface BadgeSheetPage {
  sheetNumber: number;
  side: "front" | "back";
  slots: { badgeIndex: number; xMm: number; yMm: number }[];
}

/** The grid is centered on the physical sheet. A partly occupied sheet uses
 * the same grid so the long-edge duplex flip stays registered to its front. */
export function planBadgeSheets(
  settings: BadgeSheetSettings,
  badgeCount: number,
) {
  const { diameter, bleed, paper = "single", sheetMargin = 5 } = settings;
  if (!Number.isSafeInteger(badgeCount) || badgeCount < 0)
    throw Error("The badge count must be a nonnegative whole number.");
  if (
    !Number.isFinite(diameter) ||
    diameter <= 0 ||
    !Number.isFinite(bleed) ||
    bleed < 0
  )
    throw Error("Set a positive badge trim size and a nonnegative bleed.");
  if (!badgePaperSizes.includes(paper))
    throw Error("Choose an available badge paper size.");
  if (!Number.isFinite(sheetMargin) || sheetMargin < 0 || sheetMargin > 50)
    throw Error("Set the printer margin between 0 and 50 mm.");
  const badgeSizeMm = diameter + 2 * bleed;
  const cutMarks = paper !== "single" && (settings.cutMarks ?? true);
  const clearance = cutMarks ? markRoom : 0;
  const pitch = badgeSizeMm + 2 * clearance;
  const [widthMm, heightMm] =
    paper === "single" ? [badgeSizeMm, badgeSizeMm] : sheetSizes[paper];
  const margin = paper === "single" ? 0 : sheetMargin;
  const columns = Math.floor((widthMm - 2 * margin + 1e-8) / pitch);
  const rows = Math.floor((heightMm - 2 * margin + 1e-8) / pitch);
  if (columns < 1 || rows < 1)
    throw Error(
      "The badge does not fit on this sheet. Reduce its trim size, bleed or printer margin, or turn off cut marks.",
    );
  const perSheet = columns * rows;
  const sheetCount = Math.ceil(badgeCount / perSheet);
  const left = (widthMm - columns * pitch) / 2 + clearance;
  const top = (heightMm - rows * pitch) / 2 + clearance;
  const pages: BadgeSheetPage[] = [];
  for (let first = 0; first < badgeCount; first += perSheet) {
    const sheetNumber = Math.floor(first / perSheet) + 1;
    const slots: BadgeSheetPage["slots"] = [];
    const count = Math.min(perSheet, badgeCount - first);
    for (let i = 0; i < count; i++) {
      slots.push({
        badgeIndex: first + i,
        xMm: left + (i % columns) * pitch,
        yMm: top + Math.floor(i / columns) * pitch,
      });
    }
    pages.push({ sheetNumber, side: "front", slots });
    if (settings.doubleSided) {
      pages.push({
        sheetNumber,
        side: "back",
        slots: slots.map((slot) => ({
          ...slot,
          xMm: widthMm - slot.xMm - badgeSizeMm,
        })),
      });
    }
  }
  return {
    paper,
    widthMm,
    heightMm,
    badgeSizeMm,
    bleed,
    cutMarks,
    columns,
    rows,
    perSheet,
    sheetCount,
    pageCount: pages.length,
    pages,
  };
}

export type BadgeSheetPlan = ReturnType<typeof planBadgeSheets>;
const ns = "http://www.w3.org/2000/svg";

/** Source SVGs may be reused between slots. Their text stays upright on backs. */
export function renderBadgeSheet(
  plan: BadgeSheetPlan,
  page: BadgeSheetPage,
  artwork: (badgeIndex: number) => SVGSVGElement,
) {
  if (plan.paper === "single")
    return artwork(page.slots[0]!.badgeIndex).cloneNode(true) as SVGSVGElement;
  const sheet = document.createElementNS(ns, "svg");
  sheet.setAttribute("viewBox", `0 0 ${plan.widthMm} ${plan.heightMm}`);
  sheet.setAttribute("width", plan.widthMm + "mm");
  sheet.setAttribute("height", plan.heightMm + "mm");
  sheet.setAttribute("role", "img");
  sheet.setAttribute(
    "aria-label",
    `${badgePaperLabels[plan.paper]} sheet ${page.sheetNumber}, ${page.side}, ${page.slots.length} ${page.slots.length === 1 ? "badge" : "badges"}`,
  );
  sheet.dataset.sheetSide = page.side;
  for (const { badgeIndex, xMm, yMm } of page.slots) {
    const badge = artwork(badgeIndex).cloneNode(true) as SVGSVGElement;
    badge.dataset.badgeIndex = String(badgeIndex);
    badge.setAttribute("x", String(xMm));
    badge.setAttribute("y", String(yMm));
    badge.setAttribute("width", String(plan.badgeSizeMm));
    badge.setAttribute("height", String(plan.badgeSizeMm));
    // Show a source proof at its original trim size even if its standalone
    // preview had inline CSS that scaled it to fit a narrow container.
    badge.style.removeProperty("width");
    badge.style.removeProperty("height");
    badge.style.removeProperty("max-width");
    sheet.appendChild(badge);
    if (plan.cutMarks) {
      const right = xMm + plan.badgeSizeMm,
        bottom = yMm + plan.badgeSizeMm;
      const strokes = [];
      for (const y of [yMm + plan.bleed, bottom - plan.bleed]) {
        strokes.push(
          `M${xMm - markRoom} ${y}h${markLength}`,
          `M${right + markGap} ${y}h${markLength}`,
        );
      }
      for (const x of [xMm + plan.bleed, right - plan.bleed]) {
        strokes.push(
          `M${x} ${yMm - markRoom}v${markLength}`,
          `M${x} ${bottom + markGap}v${markLength}`,
        );
      }
      const marks = document.createElementNS(ns, "path");
      marks.dataset.cutMarks = "";
      marks.setAttribute("d", strokes.join(" "));
      marks.setAttribute("fill", "none");
      marks.setAttribute("stroke", "#111");
      marks.setAttribute("stroke-width", "0.18");
      sheet.appendChild(marks);
    }
  }
  return sheet;
}
