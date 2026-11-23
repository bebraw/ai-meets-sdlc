export interface BadgeFont {
  family: string;
  has(code: number): boolean;
}
export interface BadgeGeometry {
  diameter: number;
  bleed: number;
  safe: number;
  top: number;
  minName: number;
  maxName: number;
  companySize: number;
  guides: boolean;
}
export function fontCoverage(bytes: ArrayBuffer): BadgeFont["has"];
export function loadBadgeFont(bytes: ArrayBuffer): Promise<BadgeFont>;
export function verifyBadgeLogo(logo: string | null): Promise<void>;
export function renderBadgeArtwork(
  person: { name: string; company: string; role: string },
  settings: BadgeGeometry,
  font: BadgeFont,
  preview: boolean,
  spare: boolean,
  appearance: { foreground: string; background: string },
  logo: string | null,
): { svg: SVGSVGElement; issues: string[] };
type BadgePerson = { name: string; company?: string; role: string };
type BadgeAppearance = { foreground: string; background: string };
export function prepareBadgeRun(input: {
  people: BadgePerson[];
  spares?: { role: string; count: number }[];
  colors?: (BadgeAppearance & { role: string })[];
  settings?: Partial<BadgeGeometry & { doubleSided: boolean }>;
}): {
  rows: {
    person: Required<BadgePerson>;
    quantity: number;
    source: "people" | "spares";
    row: number;
    appearance: BadgeAppearance;
  }[];
  settings: BadgeGeometry & { doubleSided: boolean };
  badges: number;
  widthMm: number;
  pageCount: number;
};
