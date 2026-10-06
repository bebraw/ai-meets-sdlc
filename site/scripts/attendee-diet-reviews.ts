import * as v from "valibot";
import { dietCategories, type DietClassification } from "./attendee-diets.ts";

export interface DietReview {
  personId: string;
  sourceSignature: string;
  status: "reviewed" | "clarify" | "none" | "missing";
  categories: DietClassification["categories"];
  note: string;
}

/** A source signature records source IDs and their unchanged original answers. */
export function reviewUsesDinnerData(review: DietReview): boolean {
  try {
    const sources: unknown = JSON.parse(review.sourceSignature);
    return (
      !Array.isArray(sources) ||
      sources.some(
        (source: unknown) =>
          !Array.isArray(source) ||
          typeof source[0] !== "string" ||
          (!source[0].startsWith("attendee:") && Boolean(source[1])),
      )
    );
  } catch {
    return true;
  }
}

export function parseDietReviews(value: unknown): DietReview[] {
  const reviews = v.parse(
    v.pipe(
      v.array(
        v.object({
          personId: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
          sourceSignature: v.pipe(
            v.string(),
            v.minLength(1),
            v.maxLength(20000),
          ),
          status: v.picklist(["reviewed", "clarify", "none", "missing"]),
          categories: v.pipe(
            v.array(v.picklist(dietCategories.map(({ id }) => id))),
            v.maxLength(dietCategories.length),
          ),
          note: v.pipe(v.string(), v.maxLength(2000)),
        }),
      ),
      v.maxLength(2000),
    ),
    value,
  );
  if (new Set(reviews.map(({ personId }) => personId)).size !== reviews.length)
    throw new Error("Each person can only have one dietary review.");
  for (const review of reviews) {
    if (new Set(review.categories).size !== review.categories.length)
      throw new Error("Choose each category once.");
    if (
      ["none", "missing"].includes(review.status) &&
      (review.categories.length || review.note.trim())
    )
      throw new Error(
        "No restrictions and missing information cannot have requirements or catering instructions.",
      );
    if (
      review.status === "reviewed" &&
      !review.categories.length &&
      !review.note.trim()
    )
      throw new Error(
        "Choose a category or enter catering instructions for reviewed requirements.",
      );
  }
  return reviews;
}
