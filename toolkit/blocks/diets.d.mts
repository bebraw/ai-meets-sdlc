interface DietReview {
  status: "reviewed" | "clarify" | "none" | "missing";
  categories: DietCategory[];
  note: string;
}
export declare const dietCategories: readonly [
  {
    readonly id: "vegan";
    readonly label: "Vegan";
  },
  {
    readonly id: "vegetarian";
    readonly label: "Vegetarian";
  },
  {
    readonly id: "pescatarian";
    readonly label: "Pescatarian";
  },
  {
    readonly id: "halal";
    readonly label: "Halal";
  },
  {
    readonly id: "gluten-free";
    readonly label: "Gluten free";
  },
  {
    readonly id: "lactose-free";
    readonly label: "Lactose free";
  },
  {
    readonly id: "low-lactose";
    readonly label: "Low lactose";
  },
  {
    readonly id: "dairy-free";
    readonly label: "Dairy free";
  },
  {
    readonly id: "no-pork";
    readonly label: "No pork";
  },
  {
    readonly id: "no-red-meat";
    readonly label: "No red meat";
  },
  {
    readonly id: "no-fish";
    readonly label: "No fish";
  },
  {
    readonly id: "no-seafood";
    readonly label: "No seafood";
  },
  {
    readonly id: "allergy";
    readonly label: "Allergy declared";
  },
];
export type DietCategory = (typeof dietCategories)[number]["id"];
export interface DietClassification {
  response: "missing" | "none" | "requirements";
  categories: DietCategory[];
  needsReview: boolean;
}
export declare function classifyDiet(
  raw: string | undefined,
): DietClassification;
interface DietPerson {
  status: "active" | "cancelled";
  diet?: string | undefined;
  review?: DietReview | undefined;
  staleReview?: DietReview | undefined;
}
export interface CateringGroup {
  label: string;
  count: number;
  needsReview: boolean;
  responses: {
    text: string;
    count: number;
  }[];
  notes?: {
    text: string;
    count: number;
  }[];
  reviewed?: boolean;
}
export interface CateringSummary {
  active: number;
  cancelled: number;
  missing: number;
  noRestrictions: number;
  requirements: number;
  needsReview: number;
  counts: {
    id: DietCategory;
    label: string;
    count: number;
  }[];
  groups: CateringGroup[];
}
export declare function summarizeAttendeeDiets(
  people: readonly DietPerson[],
): CateringSummary;
export declare function dietRequirementsText(
  summary: CateringSummary,
): string[];
export {};
