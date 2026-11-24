export * from "../../toolkit/blocks/diets.mts";
import {
  dietRequirementsText,
  type CateringSummary,
} from "../../toolkit/blocks/diets.mts";

export function cateringSummaryText(
  summary: CateringSummary,
  generatedAt: string,
  coverage: {
    registrations: number;
    additional: number;
    pending: number;
    reservedMeals?: number;
  } = { registrations: summary.active, additional: 0, pending: 0 },
): string {
  return [
    "SDLCAI 2026 - Event catering summary",
    "13 October 2026 / Marsio",
    `Prepared: ${generatedAt}`,
    "",
    `Catering headcount: ${summary.active}`,
    `Active registrations: ${coverage.registrations}`,
    `Additional speakers, organizers, and guests: ${coverage.additional}`,
    `Reserved meals for unassigned tickets and other guests: ${coverage.reservedMeals ?? 0}`,
    `Dinner responses awaiting mapping (not counted): ${coverage.pending}`,
    `Cancelled registrations excluded: ${summary.cancelled}`,
    `Dietary requirements reported: ${summary.requirements}`,
    `Explicitly no restrictions: ${summary.noRestrictions}`,
    `No answer / placeholder: ${summary.missing}`,
    `Responses needing review: ${summary.needsReview}`,
    "",
    "Counts include active registrations, speakers, mapped dinner guests, and reserved meals, regardless of arrivals or dinner attendance. Reserved meals have no dietary answers. Blank answers and placeholders are not confirmation of no restrictions.",
    "Speaker dinner diets and mapped organizer/guest responses are included. Exact email or unique name matches count once. Volunteers and other guests without a mapped response must be added separately.",
    "",
    ...dietRequirementsText(summary),
  ].join("\n");
}
