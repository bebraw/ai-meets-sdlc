import {
  loadBadgeFont as loadFont,
  renderBadgeArtwork,
} from "../../toolkit/blocks/badge-artwork.mts";
import type { BadgeFont } from "../../toolkit/blocks/badge-artwork.mts";
import {
  printFonts,
  printFontUrl,
  type PrintFontId,
} from "../../toolkit/blocks/print-fonts.mts";
import type { BadgePerson, BadgeSettings } from "./badge-model.ts";
import { badgeRoleAppearance } from "./badge-roles.ts";
import type { SpareBadgeRole } from "./badge-studio-model.ts";
export {
  fontCoverage,
  type BadgeFont,
} from "../../toolkit/blocks/badge-artwork.mts";

const bundledFonts = new Map<PrintFontId, Promise<BadgeFont>>();

export function loadBadgeFont(
  source: ArrayBuffer | PrintFontId = "noto-sans",
): Promise<BadgeFont> {
  if (typeof source !== "string") return loadFont(source);
  let pending = bundledFonts.get(source);
  if (!pending) {
    pending = fetch(printFontUrl(source))
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Could not load " + printFonts[source].label + ".");
        return loadFont(
          await response.arrayBuffer(),
          printFonts[source].weight,
        );
      })
      .catch((error) => {
        bundledFonts.delete(source);
        throw error;
      });
    bundledFonts.set(source, pending);
  }
  return pending;
}
export function renderBadge(
  person: BadgePerson,
  settings: BadgeSettings,
  font: BadgeFont,
  preview = true,
) {
  return renderBadgeArtwork(
    person,
    settings,
    font,
    preview,
    false,
    badgeRoleAppearance[person.role],
    "/assets/logo.svg",
  );
}
export function renderSpareBadge(
  role: SpareBadgeRole,
  settings: BadgeSettings,
  font: BadgeFont,
  preview = true,
) {
  return renderBadgeArtwork(
    { name: "", company: "", role },
    settings,
    font,
    preview,
    true,
    badgeRoleAppearance[role],
    "/assets/logo.svg",
  );
}
