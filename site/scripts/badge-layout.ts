import {
  loadBadgeFont as loadFont,
  renderBadgeArtwork,
} from "../../toolkit/blocks/badge-artwork.mjs";
import type { BadgeFont } from "../../toolkit/blocks/badge-artwork.mjs";
import type { BadgePerson, BadgeSettings } from "./badge-model.ts";
import { badgeRoleAppearance } from "./badge-roles.ts";
import type { SpareBadgeRole } from "./badge-studio-model.ts";
export {
  fontCoverage,
  type BadgeFont,
} from "../../toolkit/blocks/badge-artwork.mjs";

export async function loadBadgeFont(bytes?: ArrayBuffer): Promise<BadgeFont> {
  if (!bytes) {
    const response = await fetch("/assets/badges/NotoSans.ttf");
    if (!response.ok) throw new Error("Badge font failed to load.");
    bytes = await response.arrayBuffer();
  }
  return loadFont(bytes);
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
