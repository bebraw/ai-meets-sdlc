// Run this file in a project where @sdlcai/event-toolkit is installed.
import assert from "node:assert/strict";
import { createToolkit } from "@sdlcai/event-toolkit";

const visitor = { role: "public", actor: "example-attendee" };
const examples = {
  "audience-qa": async (app) => {
    const room = "opening";
    await app.run("qa_configure_room", {
      room,
      title: "Opening questions",
      status: "open",
      revision: 0,
    });
    const q = await app.run(
      "qa_ask",
      { room, question: "Can you share the slides?", requestId: "ask-1" },
      visitor,
    );
    await app.run("qa_moderate", {
      room,
      questionId: q.id,
      status: "approved",
      revision: q.revision,
    });
    await app.run("qa_present", {
      room,
      action: "select",
      questionId: q.id,
      revision: 1,
    });
    const screen = await app.run("qa_screen", { room }, visitor);
    assert.equal(screen.question, "Can you share the slides?");
    console.log("Q&A stage:", screen.question);
  },
  "event-feedback": async (app) => {
    const form = await app.run("feedback_publish_form", {
      title: "Autumn gathering",
      consent: "Use my feedback to improve the next gathering.",
      retentionDays: 30,
      revision: 0,
      questions: [
        {
          id: "recommend",
          kind: "recommendation",
          label: "Would you recommend this event?",
          required: true,
        },
      ],
    });
    const receipt = await app.run(
      "feedback_respond",
      { version: form.version, consent: true, answers: { recommend: 9 } },
      visitor,
    );
    const report = await app.run("feedback_report", { version: form.version });
    assert.equal(report.recommendationScores[0].score, 100);
    await app.run(
      "feedback_withdraw",
      { code: receipt.withdrawalCode },
      visitor,
    );
    assert.equal((await app.run("feedback_report", {})).responsesReceived, 0);
    console.log(
      "Feedback:",
      report.responsesReceived,
      "response reported and withdrawn.",
    );
  },
  "attendee-messages": async (app, outbox) => {
    await app.run("messages_set_audience", {
      revision: 0,
      recipients: ["attendee@example.test"],
    });
    const preview = await app.run("messages_preview", {
      subject: "Doors open at nine",
      body: "Collect your badge at the desk in the main lobby.",
    });
    const result = await app.run("messages_send", {
      previewId: preview.previewId,
      send: true,
    });
    assert.equal(result.deliveries.accepted, 1);
    assert.equal(outbox.length, 1);
    console.log(
      "Announcements:",
      outbox.length,
      "message delivered to the example mailbox.",
    );
  },
  newsletter: async (app, outbox) => {
    const form = await app.run("newsletter_configure", {
      revision: 0,
      title: "Gathering news",
      consent: "Send me news of future gatherings.",
    });
    await app.run(
      "newsletter_subscribe",
      {
        email: "subscriber@example.test",
        revision: form.revision,
        consent: true,
      },
      visitor,
    );
    assert.equal((await app.run("newsletter_subscribers", {})).total, 0);
    // In a production mail transport this link is delivered to the address holder.
    const [, url] = outbox[0].text.match(
      /(https:\/\/example\.test\/newsletter_confirm\?\S+)/u,
    );
    const confirmed = await app.run(
      "newsletter_confirm",
      { code: new URL(url).searchParams.get("code") },
      visitor,
    );
    assert.equal((await app.run("newsletter_subscribers", {})).total, 1);
    await app.run(
      "newsletter_withdraw",
      { code: confirmed.withdrawalCode },
      visitor,
    );
    console.log(
      "Newsletter:",
      (await app.run("newsletter_changes", {})).changes
        .map((c) => c.status)
        .join(" → "),
    );
  },
  "publication-queue": async (app) => {
    const draft = {
      id: "opening",
      revision: 0,
      title: "Opening highlights",
      body: "Three ideas from the opening session.",
      channel: "website",
      status: "draft",
      assets: [],
      sources: [],
    };
    const saved = await app.run("publication_save", draft);
    await app.run("publication_save", {
      ...draft,
      revision: saved.revision,
      status: "review",
    });
    const review = await app.run("publication_list", { status: "review" });
    assert.equal(review.items[0].revision, 2);
    console.log("Editorial queue:", review.items[0].title, "is in review.");
  },
};

const enabled = process.argv.slice(2);
for (const id of enabled.length ? enabled : Object.keys(examples)) {
  if (!Object.hasOwn(examples, id))
    throw Error("Choose one of " + Object.keys(examples).join(", "));
  const outbox = [];
  const app = createToolkit({
    eventId: "autumn",
    enabled: [id],
    services: {
      sendMail: async (message) => {
        outbox.push(message);
        return { id: "example-" + outbox.length };
      },
      actionUrl: (name, params) =>
        "https://example.test/" + name + "?" + new URLSearchParams(params),
    },
  });
  try {
    await examples[id](app, outbox);
  } finally {
    await app.close();
  }
}
