export const printFontIds = ["noto-sans", "lora", "fira-code"] as const;
export type PrintFontId = (typeof printFontIds)[number];

export const printFonts = {
  "noto-sans": { label: "Noto Sans", file: "NotoSans.ttf", weight: "100 900" },
  lora: { label: "Lora", file: "Lora.ttf", weight: "400 700" },
  "fira-code": { label: "Fira Code", file: "FiraCode.ttf", weight: "300 700" },
} satisfies Record<
  PrintFontId,
  { label: string; file: string; weight: string }
>;

export function printFontUrl(id: PrintFontId = "noto-sans") {
  return "/assets/print-fonts/" + printFonts[id].file;
}

/** Layout documents use one selected face under the same CSS family name. */
export function printFontCss(id: PrintFontId = "noto-sans") {
  return `@font-face{font-family:Print;src:url("${printFontUrl(id)}") format("truetype");font-weight:${printFonts[id].weight}}`;
}
