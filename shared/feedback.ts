export const feedbackNoticeVersion = "2026-10-16";
export const feedbackFormVersion = "3";
export type FeedbackFormVersion = typeof feedbackFormVersion;
export type FeedbackQuestion = { id: string; label: string } & (
  | { kind: "nps" }
  | { kind: "text"; showWhen?: { question: string; value: string } }
  | {
      kind: "rating";
      scale: readonly [string, string, string, string, string];
      unscoredOptions?: readonly string[];
    }
  | { kind: "choice"; options: readonly string[] }
  | {
      kind: "multiple";
      options: readonly string[];
      maxChoices?: number;
      exclusiveOption?: string;
    }
);
const valueScale = [
  "Not at all valuable",
  "Slightly valuable",
  "Moderately valuable",
  "Very valuable",
  "Extremely valuable",
] as const;
export const feedbackRetentionDays = 90;
export const feedbackConsentText =
  "I agree to Toska Osuuskunta using my answers to evaluate SDLCAI 2026 and improve future events. Participation is voluntary. I can withdraw and delete my response using my private link during the 90-day retention period.";

export const feedbackSections: readonly {
  title: string;
  description: string;
  questions: readonly FeedbackQuestion[];
}[] = [
  {
    title: "Overall impression & talks",
    description: "How did the programme work for you?",
    questions: [
      {
        id: "recommend",
        label: "How likely are you to recommend SDLCAI 2026 to a colleague?",
        kind: "nps",
      },
      {
        id: "recommendReason",
        label: "What is the main reason for your recommendation rating?",
        kind: "text",
      },
      {
        id: "overall",
        label:
          "How satisfied or dissatisfied were you with SDLCAI 2026 overall?",
        kind: "rating",
        scale: [
          "Very dissatisfied",
          "Dissatisfied",
          "Neither satisfied nor dissatisfied",
          "Satisfied",
          "Very satisfied",
        ],
        unscoredOptions: ["Unable to assess"],
      },
      {
        id: "academic",
        label: "How valuable were the academic talks you attended?",
        kind: "rating",
        scale: valueScale,
        unscoredOptions: ["Did not attend these talks", "Unable to assess"],
      },
      {
        id: "industry",
        label: "How valuable were the industry-focused talks you attended?",
        kind: "rating",
        scale: valueScale,
        unscoredOptions: ["Did not attend these talks", "Unable to assess"],
      },
    ],
  },
  {
    title: "Research meets practice",
    description: "Tell us what you valued in the mix.",
    questions: [
      {
        id: "mix",
        label:
          "How did the mix of academic research and industry experiences affect the event’s value to you?",
        kind: "choice",
        options: [
          "Much less valuable",
          "Somewhat less valuable",
          "No difference",
          "Somewhat more valuable",
          "Much more valuable",
          "Unable to assess",
        ],
      },
      {
        id: "valuable",
        label:
          "Which parts of the programme, if any, did you find most valuable?",
        kind: "multiple",
        maxChoices: 3,
        exclusiveOption: "None",
        options: [
          "Industry perspectives (morning)",
          "Views from academia (morning)",
          "Views from industry (afternoon)",
          "Deeper academic sessions (afternoon)",
          "Panels and discussions",
          "Research posters",
          "Networking",
          "Other",
          "None",
        ],
      },
      {
        id: "valuableOther",
        label: "Which other part did you find valuable?",
        kind: "text",
        showWhen: { question: "valuable", value: "Other" },
      },
    ],
  },
  {
    title: "The experience",
    description: "From the venue to the conversations between talks.",
    questions: [
      {
        id: "organization",
        label: "How would you rate the event organization?",
        kind: "rating",
        scale: [
          "Very poor",
          "Poor",
          "Neither good nor poor",
          "Good",
          "Very good",
        ],
        unscoredOptions: ["Unable to assess"],
      },
      {
        id: "networking",
        label:
          "How valuable were the opportunities you used to meet and connect with other attendees?",
        kind: "rating",
        scale: valueScale,
        unscoredOptions: [
          "Did not use these opportunities",
          "Unable to assess",
        ],
      },
      {
        id: "return",
        label: "Would you attend SDLCAI again?",
        kind: "choice",
        options: [
          "Definitely not",
          "Probably not",
          "Not sure",
          "Probably",
          "Definitely",
        ],
      },
    ],
  },
  {
    title: "Over to you",
    description:
      "These three questions are optional. Please leave out personal contact details and sensitive information. Public speaker names are welcome when suggesting future talks.",
    questions: [
      {
        id: "best",
        label: "What was the best part of SDLCAI 2026?",
        kind: "text",
      },
      {
        id: "improve",
        label: "What is the one thing we should improve most?",
        kind: "text",
      },
      {
        id: "future",
        label:
          "Which topics or speakers would you like to see at future SDLCAI events?",
        kind: "text",
      },
    ],
  },
];

export const feedbackQuestions = feedbackSections.flatMap((section) => [
  ...section.questions,
]);
export function feedbackOptions(
  question: FeedbackQuestion,
): { value: string; label: string; unscored: boolean }[] {
  if (question.kind === "text") return [];
  if (question.kind === "nps")
    return Array.from({ length: 11 }, (_, i) => ({
      value: String(i),
      label: String(i),
      unscored: false,
    }));
  if (question.kind === "rating")
    return [
      ...question.scale.map((label, i) => ({
        value: String(i + 1),
        label,
        unscored: false,
      })),
      ...(question.unscoredOptions || []).map((value) => ({
        value,
        label: value,
        unscored: true,
      })),
    ];
  return question.options.map((value) => ({
    value,
    label: value,
    unscored: false,
  }));
}
export type FeedbackAnswers = Record<string, string | string[]>;
export type FeedbackSubmission = {
  answers: FeedbackAnswers;
  consent: true;
  noticeVersion: string;
  formVersion: FeedbackFormVersion;
};
export type FeedbackTotal = { question: string; answer: string; count: number };
export type FeedbackItem = FeedbackSubmission & {
  id: string;
  expiresAt: number;
};
export type FeedbackDashboard = {
  totals: FeedbackTotal[];
  responses: FeedbackItem[];
  activeCount: number;
  nextOffset: number | null;
};

export function parseFeedback(form: FormData): FeedbackSubmission | string {
  const formVersion = form.get("formVersion");
  if (
    form.getAll("formVersion").length !== 1 ||
    formVersion !== feedbackFormVersion
  )
    return "The form has changed. Reload the page before submitting.";
  const allowed = new Set<string>([
    ...feedbackQuestions.map((q) => q.id),
    "consent",
    "noticeVersion",
    "formVersion",
    "receipt",
    "website",
    "cf-turnstile-response",
  ]);
  for (const key of form.keys())
    if (!allowed.has(key))
      return "The form contains an unexpected field. Reload the page and try again.";
  if (form.getAll("consent").length !== 1 || form.get("consent") !== "yes")
    return "Please agree to the feedback privacy notice before submitting.";
  if (
    form.getAll("noticeVersion").length !== 1 ||
    form.get("noticeVersion") !== feedbackNoticeVersion
  )
    return "The privacy notice has changed. Reload the page before submitting.";
  const answers: FeedbackAnswers = {};
  for (const question of feedbackQuestions) {
    const values = form.getAll(question.id);
    if (values.some((value) => typeof value !== "string"))
      return "Please submit text answers only.";
    if (question.kind === "multiple") {
      const selected = values as string[];
      if (
        !selected.length ||
        selected.length > (question.maxChoices ?? question.options.length) ||
        new Set(selected).size !== selected.length ||
        (question.exclusiveOption &&
          selected.includes(question.exclusiveOption) &&
          selected.length !== 1) ||
        selected.some((v) => !question.options.some((option) => option === v))
      )
        return question.maxChoices
          ? "Choose up to three valuable parts, or None on its own."
          : "Choose at least one valuable part of the programme.";
      answers[question.id] = selected;
      continue;
    }
    if (values.length > 1) return "Please select one answer per question.";
    const value = String(values[0] ?? "").trim();
    if (question.kind === "text") {
      if (value.length > 2000)
        return "Keep each comment within 2,000 characters.";
      if (
        question.showWhen &&
        value &&
        !form
          .getAll(question.showWhen.question)
          .includes(question.showWhen.value)
      )
        return "Select Other before adding another valuable part.";
    } else if (question.kind === "nps") {
      if (!/^(?:[0-9]|10)$/u.test(value))
        return "Please choose a recommendation rating from 0 to 10.";
    } else if (question.kind === "rating") {
      if (!/^[1-5]$/u.test(value) && !question.unscoredOptions?.includes(value))
        return "Choose a rating or the applicable unable-to-assess option for each question.";
    } else if (!question.options.some((option) => option === value))
      return "Please answer each required question.";
    answers[question.id] = value;
  }
  return {
    answers,
    consent: true,
    noticeVersion: feedbackNoticeVersion,
    formVersion,
  };
}

export function recommendationSummary(totals: readonly FeedbackTotal[]) {
  let promoters = 0,
    passives = 0,
    detractors = 0;
  for (const item of totals) {
    if (
      item.question !== "recommend" ||
      !/^(?:[0-9]|10)$/u.test(item.answer) ||
      !Number.isSafeInteger(item.count) ||
      item.count < 0
    )
      continue;
    const rating = Number(item.answer);
    if (rating >= 9) promoters += item.count;
    else if (rating >= 7) passives += item.count;
    else detractors += item.count;
  }
  const answered = promoters + passives + detractors;
  return {
    answered,
    promoters,
    passives,
    detractors,
    score: answered
      ? Math.round((100 * (promoters - detractors)) / answered)
      : null,
  };
}

export function feedbackContributions(
  answers: FeedbackAnswers,
): [string, string][] {
  const counts: [string, string][] = [["responses", "all"]];
  for (const q of feedbackQuestions) {
    if (q.kind === "text") continue;
    const answer = answers[q.id];
    for (const value of Array.isArray(answer) ? answer : [answer]) {
      if (value !== undefined) counts.push([q.id, value]);
    }
  }
  return counts;
}
