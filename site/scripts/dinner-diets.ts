import {
  classifyDiet,
  dietRequirementsText,
  summarizeAttendeeDiets,
  type CateringSummary,
} from "./attendee-diets.ts";

export interface DinnerDiet {
  meal_preference: "" | "omnivore" | "vegetarian" | "vegan" | "other";
  food_requirements: string;
  cross_contamination: "" | "yes" | "no" | "unsure";
}

/** Preserve dinner food notes for both dinner and daytime catering. */
export function dinnerDiet(response: DinnerDiet | null): string | undefined {
  if (!response) return undefined;
  const parts: string[] = [];
  if (["vegan", "vegetarian"].includes(response.meal_preference))
    parts.push(response.meal_preference);
  const requirements = response.food_requirements.trim();
  if (requirements && classifyDiet(requirements).response === "requirements")
    parts.push(requirements);
  if (response.cross_contamination === "yes")
    parts.push("Cross-contamination is a concern.");
  if (response.cross_contamination === "unsure")
    parts.push("Cross-contamination: unsure.");
  if (parts.length) return parts.join("; ");
  if (response.meal_preference === "other")
    return requirements || "Other meal preference; details not supplied.";
  if (
    response.meal_preference === "omnivore" &&
    response.cross_contamination === "no"
  )
    return classifyDiet(requirements).response === "none"
      ? requirements
      : "No restrictions";
  return requirements || undefined;
}

export interface DinnerCateringResponse {
  response: (DinnerDiet & { attendance: "attending" | "not_attending" }) | null;
}
export interface DinnerCateringSummary extends CateringSummary {
  notAttending: number;
  pending: number;
  crossContaminationConcern: number;
  crossContaminationUnsure: number;
  meals: { id: DinnerDiet["meal_preference"]; label: string; count: number }[];
}

export function summarizeDinnerDiets(
  guests: readonly DinnerCateringResponse[],
): DinnerCateringSummary {
  const attending = guests.flatMap((guest) =>
    guest.response?.attendance === "attending" ? [guest.response] : [],
  );
  return {
    ...summarizeAttendeeDiets(
      attending.map((response) => ({
        status: "active",
        diet: dinnerDiet(response),
      })),
    ),
    notAttending: guests.filter(
      (guest) => guest.response?.attendance === "not_attending",
    ).length,
    pending: guests.filter((guest) => !guest.response).length,
    crossContaminationConcern: attending.filter(
      (response) => response.cross_contamination === "yes",
    ).length,
    crossContaminationUnsure: attending.filter(
      (response) => response.cross_contamination === "unsure",
    ).length,
    meals: (
      [
        ["omnivore", "Omnivore"],
        ["vegetarian", "Vegetarian"],
        ["vegan", "Vegan"],
        ["other", "Other"],
        ["", "Not provided"],
      ] as const
    ).map(([id, label]) => ({
      id,
      label,
      count: attending.filter((response) => response.meal_preference === id)
        .length,
    })),
  };
}

export function dinnerCateringSummaryText(
  summary: DinnerCateringSummary,
  generatedAt: string,
): string {
  return [
    "SDLCAI 2026 - Dinner catering summary",
    "12 October 2026 / Speakers and guests",
    `Prepared: ${generatedAt}`,
    "",
    `Dinner headcount: ${summary.active}`,
    `Not attending (excluded): ${summary.notAttending}`,
    `Awaiting attendance reply (excluded): ${summary.pending}`,
    `Dietary requirements reported: ${summary.requirements}`,
    `Explicitly no restrictions: ${summary.noRestrictions}`,
    `No answer / placeholder: ${summary.missing}`,
    `Responses needing review: ${summary.needsReview}`,
    `Cross-contamination concern: ${summary.crossContaminationConcern}`,
    `Cross-contamination unsure: ${summary.crossContaminationUnsure}`,
    "",
    "Counts include all attending speaker and guest responses, including attendance recorded by organizers, regardless of list filters. Headcount matches the Caterer CSV. Guest names and other identity fields are omitted from this summary.",
    "Blank dietary answers do not confirm no restrictions. Keep original allergy and cross-contamination notes with the meal requirements.",
    "",
    "MEAL PREFERENCES",
    ...summary.meals.map((meal) => `${meal.label}: ${meal.count}`),
    "",
    ...dietRequirementsText(summary),
  ].join("\n");
}
