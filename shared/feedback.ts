export const feedbackNoticeVersion = "2026-10-16";
export const feedbackFormVersion = "2";
export const feedbackRetentionDays = 90;
export const feedbackConsentText =
  "I agree to Toska Osuuskunta using my answers to evaluate SDLCAI 2026 and improve future events. Participation is voluntary. I can withdraw and delete my response using my private link during the 90-day retention period.";

export const feedbackSections = [
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
        label: "How would you rate SDLCAI 2026 overall?",
        kind: "rating",
      },
      { id: "academic", label: "Value of academic talks", kind: "rating" },
      {
        id: "industry",
        label: "Value of industry-focused talks",
        kind: "rating",
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
          "Did combining academic research and industry experiences add value to the event?",
        kind: "choice",
        options: [
          "Yes, definitely",
          "Yes, somewhat",
          "Not particularly",
          "No",
          "Not sure",
        ],
      },
      {
        id: "valuable",
        label: "Which parts of the program did you find most valuable?",
        kind: "multiple",
        options: [
          "Industry perspectives (morning)",
          "Views from academia (morning)",
          "Views from industry (afternoon)",
          "Deeper academic sessions (afternoon)",
          "Panels and discussions",
          "Posters and networking",
        ],
      },
    ],
  },
  {
    title: "The experience",
    description: "From the venue to the conversations between talks.",
    questions: [
      {
        id: "organization",
        label:
          "How would you rate the event organization, venue and practical arrangements?",
        kind: "rating",
      },
      {
        id: "networking",
        label:
          "How valuable were the opportunities to meet and connect with other attendees?",
        kind: "rating",
      },
      {
        id: "return",
        label: "Would you attend SDLCAI again?",
        kind: "choice",
        options: ["Definitely", "Probably", "Not sure", "Probably not"],
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
        label: "What should we improve for next time?",
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
] as const;

export const feedbackQuestions = feedbackSections.flatMap((section) => [
  ...section.questions,
]);
export type FeedbackAnswers = Record<string, string | string[]>;
export type FeedbackSubmission = {
  answers: FeedbackAnswers;
  consent: true;
  noticeVersion: string;
  formVersion?: "1" | "2";
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
  const formVersion = form.get("formVersion") ?? "1";
  if (
    form.getAll("formVersion").length > 1 ||
    (formVersion !== "1" && formVersion !== feedbackFormVersion)
  )
    return "The form has changed. Reload the page before submitting.";
  for (const question of feedbackQuestions) {
    const values = form.getAll(question.id);
    if (values.some((value) => typeof value !== "string"))
      return "Please submit text answers only.";
    if (question.kind === "multiple") {
      const selected = values as string[];
      if (
        !selected.length ||
        selected.length > question.options.length ||
        new Set(selected).size !== selected.length ||
        selected.some((v) => !question.options.some((option) => option === v))
      )
        return "Choose at least one valuable part of the programme.";
      answers[question.id] = selected;
      continue;
    }
    if (values.length > 1) return "Please select one answer per question.";
    const value = String(values[0] ?? "").trim();
    if (question.kind === "text") {
      if (value.length > 2000)
        return "Keep each comment within 2,000 characters.";
    } else if (question.kind === "nps") {
      // A form already open before this question was introduced can still be
      // submitted. Omission is preserved, never converted into a zero rating.
      if (!values.length && formVersion === "1") continue;
      if (!/^(?:[0-9]|10)$/u.test(value))
        return "Please choose a recommendation rating from 0 to 10.";
    } else if (question.kind === "rating") {
      if (!/^[1-5]$/u.test(value))
        return "Please rate every question from 1 to 5.";
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
