import { button, el, field, input, panel, select } from "./controls.ts";

function result(title: string) {
  const view = panel(title);
  view.body.setAttribute("aria-live", "polite");
  view.body.setAttribute("aria-atomic", "true");
  return view;
}

function dinner(root: HTMLElement) {
  const reply = select(["Attending", "Declining"]);
  const meal = select(["Vegetarian", "Vegan", "Omnivore"]);
  const diet = input("");
  diet.placeholder = "e.g. Sesame allergy";
  const view = result("Catering handoff");
  const totals = el("p", "2 attending · 1 declined · 1 awaiting reply");
  const counts = el("p", "Meals requested · 1 vegan, 1 vegetarian.");
  const notes = el("p", "Dietary notes · Peanut allergy.");
  view.body.replaceChildren(totals, counts, notes);
  reply.addEventListener("change", () => {
    meal.disabled = diet.disabled = reply.value === "Declining";
  });
  const save = button("Save Casey’s reply", () => {
    const attending = reply.value === "Attending";
    totals.textContent = attending
      ? "3 attending · 1 declined · 0 awaiting reply"
      : "2 attending · 2 declined · 0 awaiting reply";
    const meals = new Map([
      ["vegan", 1],
      ["vegetarian", 1],
    ]);
    if (attending) {
      const choice = meal.value.toLowerCase();
      meals.set(choice, (meals.get(choice) ?? 0) + 1);
    }
    counts.textContent =
      "Meals requested · " +
      [...meals].map(([name, count]) => count + " " + name).join(", ") +
      ".";
    notes.textContent =
      attending && diet.value.trim()
        ? "Dietary notes · Peanut allergy. " + diet.value.trim()
        : "Dietary notes · Peanut allergy.";
  });
  diet.maxLength = 1900;
  root.replaceChildren(
    field("Casey’s dinner reply", reply),
    field("Meal choice", meal),
    field("Additional dietary notes", diet),
    save,
    view.panel,
  );
}

function questions(root: HTMLElement) {
  const view = panel("Approved questions by vote count");
  const list = el("ol");
  list.className = "space-y-3";
  list.setAttribute("role", "list");
  const status = el("p");
  status.setAttribute("role", "status");

  const stage = el("section");
  stage.setAttribute("aria-label", "Stage screen preview");
  stage.className =
    "mt-4 border-t-4 border-signal bg-[#101010] px-5 py-4 text-[#f6f4ef]";
  const stageTitle = el("h4", "Main stage");
  stageTitle.className = "mb-3 text-sm font-bold uppercase";
  const screen = el("p", "Stage screen waiting for the MC.");
  screen.className = "font-headline text-2xl leading-tight";
  stage.replaceChildren(stageTitle, screen);

  const question = input("Will the session slides be available?");
  question.maxLength = 1000;
  question.required = true;
  const label = el("div");
  label.replaceChildren(field("Attendee question", question));
  let pending = false;
  const submit = button("Submit as attendee", () => {
    const text = question.value.trim();
    if (!text) {
      question.setCustomValidity("Enter a question.");
      question.reportValidity();
      return;
    }
    pending = !pending;
    if (pending) {
      status.textContent = "Pending moderator review · “" + text + "”";
      submit.textContent = "Approve as moderator";
      label.replaceChildren(field("Question for moderator review", question));
    } else {
      addQuestion(text, 0, true);
      draw();
      question.value = "";
      status.textContent = "Approved for the audience queue · “" + text + "”";
      submit.textContent = "Submit as attendee";
      label.replaceChildren(field("Attendee question", question));
    }
    question.focus();
  });
  question.addEventListener("input", () => question.setCustomValidity(""));

  const questions: {
    text: string;
    votes: number;
    row: HTMLLIElement;
    present: HTMLButtonElement;
    count: HTMLElement;
  }[] = [];
  let selected: (typeof questions)[number] | undefined;
  function addQuestion(text: string, votes: number, own = false) {
    const row = el("li");
    row.className = "grid gap-2 border-t border-ink/30 pt-3";
    const count = el("span");
    const vote = button(own ? "Your question" : "Vote", () => {
      item.votes++;
      vote.textContent = "Voted";
      vote.disabled = true;
      draw();
      status.textContent =
        "Vote recorded for “" + item.text + "”. " + count.textContent + ".";
      present.focus();
    });
    vote.disabled = own;
    vote.setAttribute(
      "aria-label",
      own ? "You submitted this question" : "Vote for “" + text + "”",
    );
    const present = button("Show on stage", () => {
      selected = item;
      draw();
      status.textContent = "The MC put “" + item.text + "” on stage.";
      answer.focus();
    });
    present.setAttribute("aria-label", "Show “" + text + "” on stage as MC");
    const item = { text, votes, row, present, count };
    const actions = el("div");
    actions.className = "demo-actions";
    actions.replaceChildren(vote, present);
    row.replaceChildren(el("strong", text), count, actions);
    questions.push(item);
  }
  function draw() {
    // Stable sorting preserves submission order when two questions have the same vote count.
    const ranked = [...questions].sort((a, b) => b.votes - a.votes);
    for (const item of ranked) {
      item.count.textContent =
        item.votes + (item.votes === 1 ? " vote" : " votes");
      item.present.disabled = item === selected;
      item.present.textContent =
        item === selected ? "On stage" : "Show on stage";
    }
    list.replaceChildren(...ranked.map((item) => item.row));
    empty.hidden = Boolean(ranked.length);
    screen.textContent = selected
      ? selected.text
      : "Stage screen waiting for the MC.";
    answer.disabled = clear.disabled = !selected;
  }
  function leaveStage(answered: boolean) {
    if (!selected) return;
    const previous = selected;
    if (answered) questions.splice(questions.indexOf(previous), 1);
    selected = undefined;
    draw();
    status.textContent = answered
      ? "Marked answered · “" + previous.text + "”"
      : "Stage screen cleared. The question is still open for votes.";
    (answered ? (questions[0]?.present ?? question) : previous.present).focus();
  }
  const answer = button("Mark answered as MC", () => leaveStage(true));
  const clear = button("Clear stage screen", () => leaveStage(false));
  const stageActions = el("div");
  stageActions.className = "demo-actions";
  stageActions.replaceChildren(answer, clear);
  const empty = el(
    "p",
    "The queue is empty. Submit a question to start again.",
  );
  addQuestion("How did you test the change?", 4);
  addQuestion("Could you show a worked example?", 1);
  view.body.replaceChildren(list, empty, stage, stageActions);
  root.replaceChildren(label, submit, status, view.panel);
  draw();
}

function feedback(root: HTMLElement) {
  const rating = select(["1", "2", "3", "4", "5"], "5");
  const view = result("Organizer’s survey report");
  const total = el("p", "2 responses");
  const breakdown = el("p", "1 rated it 4 stars · 1 rated it 5 stars");
  const receipt = el("p", "The survey is open for responses.");
  receipt.setAttribute("role", "status");
  view.body.replaceChildren(total, breakdown);
  let submitted = false;
  const submit = button("Agree and submit rating", () => {
    submitted = !submitted;
    rating.disabled = submitted;
    const votes = [0, 0, 0, 1, 1];
    const index = Number(rating.value) - 1;
    if (submitted) votes[index] = (votes[index] ?? 0) + 1;
    total.textContent = submitted ? "3 responses" : "2 responses";
    breakdown.textContent = votes
      .flatMap((count, i) =>
        count
          ? [count + " rated it " + (i + 1) + (i === 0 ? " star" : " stars")]
          : [],
      )
      .join(" · ");
    receipt.textContent = submitted
      ? "Response saved. You can withdraw it with your private receipt."
      : "Response withdrawn. The report now counts the two original responses.";
    submit.textContent = submitted
      ? "Use receipt to withdraw rating"
      : "Agree and submit rating";
  });
  root.replaceChildren(
    field("How valuable was the programme? (1–5)", rating),
    el("p", "I agree that my rating may be used to improve this event."),
    submit,
    receipt,
    view.panel,
  );
}

function messages(root: HTMLElement) {
  const subject = input("Arrival details");
  subject.maxLength = 160;
  subject.required = true;
  const message = el("textarea");
  message.value = "The registration desk opens at 09:00 in the lobby.";
  message.maxLength = 10000;
  message.required = true;
  const view = result("Announcement preview");
  const recipients = el(
    "p",
    "Robin and Noa will receive the message at robin@example.test and noa@example.test. Kim has withdrawn.",
  );
  const heading = el("strong");
  const copy = el("p");
  const outcome = el("p", "Ready to preview.");
  view.body.replaceChildren(recipients, heading, copy, outcome);
  const simulate = button("Simulate sending", () => {
    outcome.textContent = "The simulated mail provider accepted both emails.";
    simulate.disabled = true;
  });
  simulate.disabled = true;
  const preview = button("Preview announcement", () => {
    for (const control of [subject, message]) {
      if (!control.value.trim()) {
        control.setCustomValidity(
          "Enter " + (control === subject ? "a subject." : "the message text."),
        );
        control.reportValidity();
        return;
      }
    }
    heading.textContent = subject.value.trim();
    copy.textContent = message.value.trim();
    outcome.textContent = "Preview ready for 2 recipients.";
    simulate.disabled = false;
  });
  for (const control of [subject, message]) {
    control.addEventListener("input", () => {
      control.setCustomValidity("");
      heading.textContent = "";
      copy.textContent = "";
      outcome.textContent = "Preview your edits to review the announcement.";
      simulate.disabled = true;
    });
  }
  const actions = el("div");
  actions.className = "demo-actions";
  actions.replaceChildren(preview, simulate);
  root.replaceChildren(
    field("Email subject", subject),
    field("Message to attendees", message),
    actions,
    view.panel,
  );
}

function newsletter(root: HTMLElement) {
  const address = "robin@example.test";
  const view = result("Organizer’s subscriber list");
  const members = el("p", "0 confirmed subscribers");
  const history = el("p", "Consent history is empty.");
  const inbox = el("p", "Robin’s sample inbox is empty.");
  view.body.replaceChildren(members, history);
  let step = 0;
  const advance = button("Agree and request confirmation", () => {
    step++;
    if (step === 1) {
      inbox.textContent =
        "Robin’s sample inbox has a one-time link to confirm the signup for Field Notes updates.";
      advance.textContent = "Open sample confirmation link";
    } else if (step === 2) {
      inbox.textContent =
        "Signup confirmed. Robin’s private withdrawal link is available.";
      members.textContent = "1 confirmed subscriber · " + address;
      history.textContent =
        "Consent history · subscribed under notice version 1.";
      advance.textContent = "Use sample withdrawal link";
    } else {
      inbox.textContent = "Robin withdrew consent.";
      members.textContent = "0 confirmed subscribers";
      history.textContent =
        "Consent history · subscribed, then withdrawn under notice version 1.";
      advance.disabled = true;
    }
  });
  inbox.setAttribute("role", "status");
  root.replaceChildren(
    el(
      "p",
      "“I agree to receive Field Notes news about upcoming events at " +
        address +
        ".”",
    ),
    inbox,
    advance,
    view.panel,
  );
}

function publication(root: HTMLElement) {
  const date = input("2030-09-04", "date");
  date.required = true;
  const url = input("https://example.test/programme-announcement", "url");
  url.required = true;
  const urlField = field("Published post URL", url);
  urlField.hidden = true;
  const view = result("Website publication record");
  const state = el("p", "Ready for publication");
  const location = el("p");
  view.body.replaceChildren(
    el("strong", "Programme announcement"),
    el("p", "Meet the speakers joining us for Field Notes this autumn."),
    state,
    location,
  );
  let scheduled = false;
  const save = button("Schedule announcement", () => {
    if (!scheduled) {
      if (!date.reportValidity()) return;
      state.textContent = "Scheduled for " + date.value;
      date.disabled = true;
      scheduled = true;
      urlField.hidden = false;
      save.textContent = "Record published post";
      url.focus();
      return;
    }
    try {
      const post = new URL(url.value);
      if (post.protocol !== "https:" || post.username || post.password)
        throw new Error();
    } catch {
      url.setCustomValidity(
        "Enter a complete HTTPS address without credentials.",
      );
    }
    if (!url.reportValidity()) return;
    state.textContent = "Published · " + date.value;
    location.textContent = url.value;
    save.disabled = true;
    url.readOnly = true;
  });
  url.addEventListener("input", () => url.setCustomValidity(""));
  root.replaceChildren(
    field("Publication date", date),
    urlField,
    save,
    view.panel,
  );
}

export const engagementDemos: Record<string, (root: HTMLElement) => void> = {
  "dinner-rsvps": dinner,
  "audience-qa": questions,
  "event-feedback": feedback,
  "attendee-messages": messages,
  newsletter,
  "publication-queue": publication,
};
