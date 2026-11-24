import assert from "node:assert/strict";

/** Run the browser workflows against the same instance used by an organizer MCP client. */
export async function checkWorkflowUi(admin, origin, callMcp) {
  const context = await admin.context().browser().newContext();
  const visitor = await context.newPage();
  const errors = [];
  visitor.on("pageerror", (error) => errors.push(error.message));
  function route(op, input) {
    return (
      origin +
      "/#" +
      new URLSearchParams({
        operation: op,
        ...(input ? { input: JSON.stringify(input) } : {}),
      })
    );
  }
  async function ready(page, op) {
    await page.waitForFunction(
      (op) =>
        document.querySelector("#operation")?.value === op &&
        !document.querySelector("#run").disabled,
      op,
    );
  }
  async function execute(page, op) {
    await ready(page, op);
    const done = page.waitForResponse(
      (response) =>
        response.url() === origin + "/api/run/" + op &&
        response.request().method() === "POST",
    );
    await page.locator("#run").click();
    const response = await done,
      body = await response.json();
    assert.equal(response.status(), 200, op + ": " + JSON.stringify(body));
    return body.data;
  }
  async function open(page, op, input) {
    await page.goto(route(op, input));
    await ready(page, op);
  }
  function field(page, name) {
    return page.locator('[data-path="' + name + '"]');
  }
  try {
    const member = await callMcp("organizers_create", {
      name: "UI Directory Example",
      visible: false,
    });
    await open(admin, "organizers_list");
    await execute(admin, "organizers_list");
    await admin
      .getByRole("button", { name: "Edit UI Directory Example", exact: true })
      .click();
    await ready(admin, "organizers_update");
    assert.equal(new URL(admin.url()).hash, "#operation=organizers_update");
    assert.equal(await field(admin, "id").inputValue(), member.id);
    await field(admin, "name").fill("UI Directory Updated");
    await field(admin, "visible").check();
    await execute(admin, "organizers_update");
    await open(visitor, "organizers_public");
    await execute(visitor, "organizers_public");
    await visitor
      .getByRole("heading", { name: "UI Directory Updated", exact: true })
      .waitFor();

    const { rosterRevision } = await callMcp("checkin_roster", {});
    await callMcp("checkin_register", {
      people: [
        {
          id: "workflow-ui-holder",
          name: "UI Ticket Holder",
          ticketCode: "UI-101",
        },
      ],
      rosterRevision,
    });
    const grant = await callMcp("checkin_issue_grant", {
      label: "UI door staff",
    });
    await open(visitor, "checkin_lookup", { token: grant.token });
    await field(visitor, "query").fill("UI-101");
    await execute(visitor, "checkin_lookup");
    await visitor
      .getByRole("button", { name: "Check in UI Ticket Holder", exact: true })
      .click();
    await execute(visitor, "checkin_arrive");
    await visitor
      .getByRole("heading", { name: "Arrival recorded", exact: true })
      .waitFor();

    const future = (days) =>
      new Date(Date.now() + days * 86400000).toISOString();
    const consent = "I agree to contact about this example proposal.";
    const call = await callMcp("posters_call", {});
    await callMcp("posters_configure_call", {
      revision: call.revision,
      consent,
      deadline: future(4),
    });
    await open(visitor, "posters_submit");
    for (const [key, value] of Object.entries({
      name: "UI Poster Presenter",
      email: "presenter@example.test",
      title: "Library wayfinding",
      abstract: "Reports from a community event.",
    }))
      await field(visitor, key).fill(value);
    await visitor.getByLabel(consent, { exact: true }).check();
    await execute(visitor, "posters_submit");
    await open(admin, "posters_review_queue");
    await execute(admin, "posters_review_queue");
    const proposal = admin
      .locator("#result article")
      .filter({ hasText: "UI Poster Presenter" });
    await proposal.getByRole("button", { name: "Review proposal" }).click();
    await ready(admin, "posters_decide");
    await field(admin, "status").selectOption("accepted");
    await execute(admin, "posters_decide");
    assert.ok(
      (await callMcp("posters_presenters", {})).people.some(
        (p) => p.name === "UI Poster Presenter",
      ),
    );

    const dinner = await callMcp("dinner_invite", {
      name: "UI Dinner Guest",
      replyBy: future(4),
      retainUntil: future(6),
    });
    await open(visitor, "dinner_read_invitation", { token: dinner.token });
    await execute(visitor, "dinner_read_invitation");
    await visitor
      .getByRole("button", {
        name: "Respond to dinner invitation",
        exact: true,
      })
      .click();
    await ready(visitor, "dinner_respond");
    assert.equal(new URL(visitor.url()).hash, "#operation=dinner_respond");
    await field(visitor, "attendance").selectOption("attending");
    await field(visitor, "meal").selectOption("vegan");
    await execute(visitor, "dinner_respond");
    await visitor
      .getByRole("heading", { name: "Dinner response saved", exact: true })
      .waitFor();
    assert.ok((await callMcp("dinner_catering", {})).meals.vegan >= 1);

    const speaker = await callMcp("speaker_assign", {
      talkId: "workflow-ui-talk",
      speakerId: "workflow-ui-speaker",
      name: "UI Speaker",
      title: "Community-led events",
      email: "speaker@example.test",
      expiresAt: future(4),
    });
    await open(visitor, "speaker_read_workspace", { token: speaker.token });
    await execute(visitor, "speaker_read_workspace");
    await visitor
      .getByRole("button", { name: "Edit profile and talk", exact: true })
      .click();
    await ready(visitor, "speaker_submit");
    await field(visitor, "bio").fill("Event programmer.");
    await field(visitor, "abstract").fill(
      "Experiences from independent organizers.",
    );
    await field(visitor, "mayPublish").check();
    await execute(visitor, "speaker_submit");
    await open(admin, "speaker_review_queue");
    await execute(admin, "speaker_review_queue");
    const session = admin
      .locator("#result article")
      .filter({ hasText: "UI Speaker" });
    await session
      .getByRole("button", { name: "Review submission", exact: true })
      .click();
    await execute(admin, "speaker_review");
    await open(visitor, "speaker_programme");
    await execute(visitor, "speaker_programme");
    await visitor
      .getByRole("heading", { name: "Community-led events", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
