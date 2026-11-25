import {
  badgeShapes,
  type BadgeShape,
} from "../../toolkit/blocks/badge-artwork.mts";
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
