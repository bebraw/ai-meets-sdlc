export const dietCategories = [
  { id: "vegan", label: "Vegan" },
  { id: "vegetarian", label: "Vegetarian" },
  { id: "pescatarian", label: "Pescatarian" },
  { id: "halal", label: "Halal" },
  { id: "gluten-free", label: "Gluten free" },
  { id: "lactose-free", label: "Lactose free" },
  { id: "low-lactose", label: "Low lactose" },
  { id: "dairy-free", label: "Dairy free" },
  { id: "no-pork", label: "No pork" },
  { id: "no-red-meat", label: "No red meat" },
  { id: "no-fish", label: "No fish" },
  { id: "no-seafood", label: "No seafood" },
  { id: "allergy", label: "Allergy declared" },
] as const;

export type DietCategory = (typeof dietCategories)[number]["id"];
export interface DietClassification {
  response: "missing" | "none" | "requirements";
  categories: DietCategory[];
  needsReview: boolean;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[’‘]/gu, "'")
    .replace(/[–—]/gu, "-")
    .trim();
}

const patterns: Partial<Record<DietCategory, RegExp>> = {
  vegan: /\b(?:vegan|vegaani(?:nen|sta)?)\b/gu,
  vegetarian:
    /\b(?:lacto[ -]ovo vegetarian|vegetarian|kasvisruoka(?:valio)?|kasvissyoja)\b/gu,
  pescatarian: /\b(?:pescatarian|pescetarian|pesco[ -]vegetarian)\b/gu,
  halal: /\bhalal\b/gu,
  "gluten-free": /\b(?:gluten[ -]free|gluteeniton|gluteenitonta)\b/gu,
  "lactose-free": /\blactose[ -]free\b|laktoositon/gu,
  "low-lactose":
    /\b(?:low[ -]lactose|vah[a]?laktoosinen|vah[a]?laktoosista)\b/gu,
  "dairy-free": /\b(?:dairy[ -]free|milk[ -]free|maidoton|maidotonta)\b/gu,
  "no-pork":
    /\b(?:(?:no|without|can't eat|cannot eat|i don't eat) pork|ei sianlihaa|sianlihaton)\b/gu,
  "no-red-meat":
    /\b(?:(?:no|without|i don't eat) red meat|ei punaista lihaa)\b/gu,
  "no-fish":
    /\b(?:(?:no|without|i don't eat) fish|fish[ -]free|ei kalaa|kalaton)\b/gu,
  "no-seafood":
    /\b(?:no fish or seafood|(?:no|without) seafood|seafood[ -]free|ei merenelavia)\b/gu,
};

export function classifyDiet(raw: string | undefined): DietClassification {
  const text = normalize(raw ?? "");
  if (
    !text ||
    /^(?:[-.]+|n\/?a|not provided|not specified)$/u.test(text) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text)
  )
    return { response: "missing", categories: [], needsReview: false };
  if (
    /^(?:none|no|ei|no (?:food |dietary )?restrictions|no allergies|ei (?:ruokarajoitteita|rajoitteita|erityisruokavaliota|allergioita)(?: ollenkaan)?)[.!]?$/u.test(
      text,
    )
  )
    return { response: "none", categories: [], needsReview: false };

  const categories: DietCategory[] = [];
  // A negated diet is not a request for that diet. Keep it for human review.
  const negated =
    /\b(?:not|non|no)[ -]+(?:vegan|vegetarian|pescatarian|halal)\b/gu;
  const matchable = text.replace(negated, "");
  const recognized = new Array<boolean>(matchable.length).fill(false);
  for (const { id } of dietCategories) {
    const pattern = patterns[id];
    if (!pattern) continue;
    // Match the original response so overlapping phrases retain both requirements
    // without leaving fragments of a recognized phrase for manual review.
    const matches = [...matchable.matchAll(new RegExp(pattern.source, "gu"))];
    if (matches.length) {
      categories.push(id);
      for (const match of matches)
        recognized.fill(true, match.index, match.index + match[0].length);
    }
  }
  if (
    /allerg|anaphyla/iu.test(text) &&
    !/\b(?:no allergies|ei allergioita)\b/u.test(text)
  )
    categories.push("allergy");
  const alternative = /\b(?:or|tai|if|prefers?|preferably)\b|\//u.test(
    text.replace(/\bno fish or seafood\b/gu, " "),
  );
  if (categories.includes("vegan") && categories.includes("vegetarian"))
    categories.splice(categories.indexOf("vegetarian"), 1);
  const remainder = matchable
    .split("")
    .map((char, index) => (recognized[index] ? " " : char))
    .join("")
    .replace(/\b(?:and|ja|please|ruokavalio|diet|that's all)\b/gu, " ")
    .replace(/[\s.,;:+&()/-]/gu, "");
  return {
    response: "requirements",
    categories,
    needsReview:
      !categories.length ||
      Boolean(remainder) ||
      alternative ||
      negated.test(text) ||
      categories.includes("allergy"),
  };
}

interface DietPerson {
  status: "active" | "cancelled";
  diet?: string | undefined;
}
export interface CateringGroup {
  label: string;
  count: number;
  needsReview: boolean;
  responses: { text: string; count: number }[];
}
export interface CateringSummary {
  active: number;
  cancelled: number;
  missing: number;
  noRestrictions: number;
  requirements: number;
  needsReview: number;
  counts: { id: DietCategory; label: string; count: number }[];
  groups: CateringGroup[];
}

export function summarizeAttendeeDiets(
  people: readonly DietPerson[],
): CateringSummary {
  const result: CateringSummary = {
    active: 0,
    cancelled: 0,
    missing: 0,
    noRestrictions: 0,
    requirements: 0,
    needsReview: 0,
    counts: dietCategories.map((category) => ({ ...category, count: 0 })),
    groups: [],
  };
  const groups = new Map<string, CateringGroup>();
  for (const person of people) {
    if (person.status !== "active") {
      result.cancelled++;
      continue;
    }
    result.active++;
    const diet = classifyDiet(person.diet);
    if (diet.response === "missing") {
      result.missing++;
      continue;
    }
    if (diet.response === "none") {
      result.noRestrictions++;
      continue;
    }
    result.requirements++;
    if (diet.needsReview) result.needsReview++;
    for (const count of result.counts)
      if (diet.categories.includes(count.id)) count.count++;
    const raw = person.diet!.trim();
    // Unknown details and alternatives must never collapse into a generic meal group.
    const key = `${diet.categories.join("+")}:${diet.needsReview ? normalize(raw) : ""}`;
    const group = groups.get(key) ?? {
      label:
        diet.categories
          .map(
            (id) =>
              dietCategories.find((category) => category.id === id)!.label,
          )
          .join(" + ") || "Other requirements",
      count: 0,
      needsReview: diet.needsReview,
      responses: [],
    };
    group.count++;
    const response = group.responses.find(
      (item) => normalize(item.text) === normalize(raw),
    );
    if (response) response.count++;
    else group.responses.push({ text: raw, count: 1 });
    groups.set(key, group);
  }
  result.groups = [...groups.values()].sort(
    (a, b) =>
      Number(b.needsReview) - Number(a.needsReview) ||
      b.count - a.count ||
      a.label.localeCompare(b.label),
  );
  return result;
}

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

export function dietRequirementsText(summary: CateringSummary): string[] {
  return [
    "REQUIREMENT COUNTS",
    "Counts overlap: one person may have several requirements. Do not add these counts to calculate meals.",
    "Recognized categories can include alternatives. Check REVIEW groups before choosing meals.",
    ...summary.counts
      .filter((item) => item.count)
      .map((item) => `${item.label}: ${item.count}`),
    "",
    "COMBINED REQUIREMENTS AND ORIGINAL RESPONSES",
    "Each person with reported requirements appears in one group below. Keep all requirements together when preparing a meal.",
    "Responses marked REVIEW contain specific details, alternatives, or wording that needs checking. The original response remains the source for those details.",
    "",
    ...summary.groups.flatMap((group) => [
      `${group.count} ${group.count === 1 ? "person" : "people"} - ${group.label}${group.needsReview ? " [REVIEW]" : ""}`,
      ...group.responses.map(
        (response) => `  ${response.count} x ${response.text}`,
      ),
      "",
    ]),
    ...(summary.groups.length ? [] : ["No dietary requirements reported.", ""]),
  ];
}
