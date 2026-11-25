import {
  badgeShapes,
  badgeAttachments,
  type BadgeShape,
} from "../../toolkit/blocks/badge-artwork.mts";
import {
  badgePaperLabels,
  badgePaperSizes,
  type BadgePaper,
  type planBadgeSheets,
} from "../../toolkit/blocks/badge-sheets.mts";
import {
  printFontIds,
  printFonts,
  type PrintFontId,
} from "../../toolkit/blocks/print-fonts.mts";

export function fontSelect(selected: PrintFontId = "noto-sans") {
  const control = document.createElement("select");
  for (const id of printFontIds)
    control.add(new Option(printFonts[id].label, id));
  control.value = selected;
  return control;
}

export function badgeShapeSelect(selected: BadgeShape = "circle") {
  const labels: Record<BadgeShape, string> = {
    circle: "Circle",
    square: "Square",
    "rounded-square": "Rounded square",
  };
  const control = document.createElement("select");
  for (const shape of badgeShapes)
    control.add(new Option(labels[shape], shape));
  control.value = selected;
  return control;
}

export function attachmentSelect(
  selected: (typeof badgeAttachments)[number] = "lanyard",
) {
  const control = document.createElement("select");
  control.add(new Option("Lanyard with punched hole", "lanyard"));
  control.add(new Option("Holder insert", "holder"));
  control.value = selected;
  return control;
}

export function paperSelect(selected: BadgePaper = "single") {
  const control = document.createElement("select");
  for (const id of badgePaperSizes)
    control.add(new Option(badgePaperLabels[id], id));
  control.value = selected;
  return control;
}

export function sheetDescription(plan: ReturnType<typeof planBadgeSheets>) {
  const sheets = plan.sheetCount === 1 ? "sheet" : "sheets";
  const pages = plan.pageCount === 1 ? "page" : "pages";
  return `${plan.perSheet} per sheet · ${plan.sheetCount} ${sheets} · ${plan.pageCount} PDF ${pages} at ${plan.widthMm} × ${plan.heightMm} mm.`;
}
