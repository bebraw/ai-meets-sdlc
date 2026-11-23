function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function questionSchema(q) {
  if (q.kind === "choice")
    return { title: q.label, type: "string", enum: q.options };
  if (q.kind === "text")
    return { title: q.label, type: "string", maxLength: 2000 };
  const isRating = q.kind === "rating";
  return {
    title: q.label,
    type: "integer",
    minimum: isRating ? 1 : 0,
    maximum: isRating ? 5 : 10,
    description: isRating ? "Choose from 1 to 5." : "Choose from 0 to 10.",
  };
}

export async function prepareEngagementForm(op, call, previous = {}) {
  const survey = op.name === "feedback_respond",
    news = op.name === "newsletter_subscribe";
  const qaRoom =
    op.name.startsWith("qa_") &&
    !["qa_rooms", "qa_configure_room"].includes(op.name);
  if (!survey && !news && !qaRoom) return null;
  const enriched = structuredClone(op),
    fields = enriched.inputSchema.properties;
  if (qaRoom) {
    const { rooms } = await call("qa_rooms", {});
    const usable =
      op.name === "qa_ask" || op.name === "qa_vote"
        ? rooms.filter((r) => r.status === "open")
        : rooms;
    if (!usable.length)
      return {
        ...enriched,
        initial: {},
        unavailable: "No Q&A room is available for this action.",
      };
    fields.room = {
      ...fields.room,
      title: "Session room",
      enum: usable.map((r) => r.id),
      description: usable.map((r) => `${r.title} (${r.id})`).join(", "),
    };
    enriched.initial = {
      room: usable.some((r) => r.id === previous.room)
        ? previous.room
        : usable[0].id,
    };
    if (op.name === "qa_ask") {
      enriched.initial.requestId = crypto.randomUUID();
      enriched.example = { ...enriched.example, ...enriched.initial };
      fields.requestId = {
        ...fields.requestId,
        title: "Submission ID",
        readOnly: true,
      };
    }
    return enriched;
  }
  let form;
  try {
    form = await call(survey ? "feedback_form" : "newsletter_form", {});
  } catch (error) {
    return {
      ...enriched,
      initial: {},
      unavailable:
        error.message || "The organizer has not opened this form yet.",
    };
  }
  enriched.description = form.title;
  const versionField = survey ? "version" : "revision";
  fields[versionField] = {
    ...fields[versionField],
    title: "Form version",
    readOnly: true,
  };
  fields.consent = { ...fields.consent, title: form.consent };
  enriched.initial = { [versionField]: form[versionField], consent: false };
  if (survey) {
    fields.answers = {
      type: "object",
      title: "Your feedback",
      additionalProperties: false,
      properties: Object.fromEntries(
        form.questions.map((q) => [q.id, questionSchema(q)]),
      ),
      required: form.questions.filter((q) => q.required).map((q) => q.id),
    };
    enriched.initial.answers = {};
    enriched.description = `${form.title} · You can withdraw your response within ${form.retentionDays} days.`;
  }
  // The public example starts with the current notice and unchecked consent.
  enriched.example = structuredClone(enriched.initial);
  return enriched;
}

function button(label, onClick) {
  const control = element("button", label);
  control.type = "button";
  control.addEventListener("click", onClick);
  return control;
}

function actionLink(label, operation, input) {
  const link = element("a", label);
  link.href =
    "#" + new URLSearchParams({ operation, input: JSON.stringify(input) });
  return link;
}

function stage(data, container, call) {
  const section = element("section", undefined, "qa-stage");
  const title = element("h2", data.title),
    question = element("p", data.question || "Waiting for the next question.");
  question.setAttribute("aria-live", "polite");
  const status = element("p", "", "qa-error");
  status.setAttribute("role", "status");
  const actions = element("div", undefined, "qa-actions");
  section.append(title, question, status, actions);
  container.replaceChildren(section);
  if (section.requestFullscreen)
    actions.append(
      button("Full screen", async () => {
        try {
          if (document.fullscreenElement === section)
            await document.exitFullscreen();
          else await section.requestFullscreen();
        } catch (error) {
          status.textContent = error.message;
        }
      }),
    );
  if (!call) return;
  let reading = false;
  async function reload() {
    if (reading || document.hidden || !section.isConnected) return;
    reading = true;
    try {
      const next = await call("qa_screen", { room: data.room });
      const line = next.question || "Waiting for the next question.";
      if (question.textContent !== line) question.textContent = line;
      if (title.textContent !== next.title) title.textContent = next.title;
      status.textContent = "";
    } catch {
      status.textContent = "Connection interrupted. Reconnecting…";
    } finally {
      reading = false;
    }
  }
  actions.append(button("Refresh", reload));
  const timer = setInterval(() => {
    if (!section.isConnected) clearInterval(timer);
    else void reload();
  }, 5000);
}

function moderatedQueue(data, container, call) {
  const section = element("section", undefined, "qa-queue");
  const header = element("div", undefined, "qa-queue-header");
  header.append(
    element("h2", data.room.title),
    element("span", data.room.status),
  );
  section.append(header);
  const status = element("p", "", "qa-error");
  status.setAttribute("role", "status");
  let busy = false;
  async function update(name, input) {
    if (busy || !call) return;
    busy = true;
    const room = data.room.id;
    try {
      await call(name, { ...input, room });
      const after = await call("qa_view", { room });
      if (section.isConnected) moderatedQueue(after, container, call);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
    }
  }
  if (!data.questions.length)
    section.append(element("p", "No questions are visible yet."));
  for (const q of data.questions) {
    const row = element("article");
    const selected = data.room.selected === q.id;
    row.append(
      element(
        "small",
        `${selected ? "On stage" : q.status} · ${q.votes} ${q.votes === 1 ? "vote" : "votes"}`,
      ),
      element("p", q.question),
    );
    if (call && data.room.status !== "archived") {
      const actions = element("div", undefined, "qa-actions");
      if (
        q.status === "approved" &&
        !q.own &&
        !q.voted &&
        data.room.status === "open"
      )
        actions.append(
          button("Vote", () => void update("qa_vote", { questionId: q.id })),
        );
      if (
        data.permissions.canModerate &&
        ["pending", "approved"].includes(q.status)
      ) {
        for (const target of q.status === "pending"
          ? ["approved", "hidden"]
          : ["hidden"])
          actions.append(
            button(
              target === "approved" ? "Approve" : "Hide",
              () =>
                void update("qa_moderate", {
                  questionId: q.id,
                  status: target,
                  revision: q.revision,
                }),
            ),
          );
      }
      if (data.permissions.canPresent && q.status === "approved")
        actions.append(
          button(
            selected ? "Mark answered" : "Show on stage",
            () =>
              void update("qa_present", {
                questionId: q.id,
                action: selected ? "answered" : "select",
                revision: data.room.revision,
              }),
          ),
        );
      if (actions.children.length) row.append(actions);
    }
    section.append(row);
  }
  section.append(status);
  container.replaceChildren(section);
}

export function renderEngagementResult(op, data, container, call) {
  if (op.name === "qa_ask") {
    const section = element("section");
    section.append(
      element("h2", "Question received"),
      element(
        "p",
        data.status === "pending"
          ? "Your question is waiting for moderation."
          : `Question status: ${data.status}.`,
      ),
    );
    const actions = element("div", undefined, "qa-actions");
    actions.append(
      actionLink("Ask another question", "qa_ask", {
        room: data.room,
        requestId: crypto.randomUUID(),
      }),
      actionLink("See room questions", "qa_view", { room: data.room }),
    );
    section.append(actions);
    container.replaceChildren(section);
    return true;
  }
  if (op.name === "qa_rooms") {
    const section = element("section", undefined, "qa-queue");
    section.append(element("h2", "Session rooms"));
    if (!data.rooms.length)
      section.append(element("p", "No rooms are open yet."));
    for (const room of data.rooms) {
      const row = element("article");
      row.append(element("h3", room.title), element("small", room.status));
      const actions = element("div", undefined, "qa-actions");
      for (const [label, name, display] of [
        ["Open questions", "qa_view", moderatedQueue],
        ["Stage screen", "qa_screen", stage],
      ]) {
        if (!call) continue;
        actions.append(
          button(label, async () => {
            try {
              const result = await call(name, { room: room.id });
              if (section.isConnected) display(result, container, call);
            } catch (error) {
              if (section.isConnected)
                actions.append(element("span", error.message));
            }
          }),
        );
      }
      if (room.status === "open")
        actions.append(
          actionLink("Ask a question", "qa_ask", {
            room: room.id,
            requestId: crypto.randomUUID(),
          }),
        );
      row.append(actions);
      section.append(row);
    }
    container.replaceChildren(section);
    return true;
  }
  if (op.name === "qa_screen") {
    stage(data, container, call);
    return true;
  }
  if (op.name === "qa_view") {
    moderatedQueue(data, container, call);
    return true;
  }
  if (op.name === "feedback_respond") {
    const section = element("section");
    section.append(
      element("h2", "Feedback received"),
      element("p", "Keep your private withdrawal code."),
      element("code", data.withdrawalCode),
      element(
        "p",
        `Available until ${new Date(data.expiresAt).toLocaleDateString()}.`,
      ),
    );
    container.replaceChildren(section);
    return true;
  }
  if (
    op.name === "newsletter_subscribe" ||
    op.name === "newsletter_confirm" ||
    op.name === "newsletter_withdraw" ||
    op.name === "messages_withdraw" ||
    op.name === "feedback_withdraw"
  ) {
    const section = element("section");
    const labels = {
      newsletter_subscribe: "Check your inbox",
      newsletter_confirm: "Subscription confirmed",
      newsletter_withdraw: "Unsubscribed from event news",
      messages_withdraw: "Unsubscribed from event announcements",
      feedback_withdraw: "Feedback withdrawn",
    };
    section.append(element("h2", labels[op.name]));
    if (data.message) section.append(element("p", data.message));
    if (data.withdrawalCode)
      section.append(
        element("p", "Keep your private withdrawal code."),
        element("code", data.withdrawalCode),
      );
    container.replaceChildren(section);
    return true;
  }
  return false;
}
