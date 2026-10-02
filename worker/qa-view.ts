import type { QaPageData, QaQuestion, QaView } from "./qa-types.ts";

const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const control =
  "inline-flex min-h-11 items-center justify-center border border-ink px-4 py-3 text-sm font-bold uppercase transition hover:bg-ink hover:text-paper disabled:opacity-50 disabled:cursor-not-allowed";
const input = "min-w-0 w-full border border-ink bg-paper p-3 text-ink";
const hidden = (name: string, value: string | number): string =>
  `<input type="hidden" name="${name}" value="${escape(String(value))}">`;
function form(
  path: string,
  action: string,
  fields: string,
  label: string,
  disabled = false,
): string {
  return `<form action="${escape(path)}" method="post" data-qa-action>${hidden("action", action)}${fields}<button class="${control}"${disabled ? " disabled" : ""}>${escape(label)}</button></form>`;
}
function questionFields(data: QaPageData, question: QaQuestion): string {
  return `${hidden("roomId", data.room!.id)}${hidden("questionId", question.id)}${hidden("revision", question.revision)}${hidden("expectedActiveId", data.snapshot?.activeQuestionId ?? "")}`;
}
function questionCard(
  data: QaPageData,
  question: QaQuestion,
  path: string,
): string {
  const fields = questionFields(data, question);
  const moderation = data.view === "moderator" || data.view === "admin";
  let actions = "";
  if (data.view === "attendee" && question.status !== "pending") {
    actions = form(
      path,
      "vote",
      fields,
      question.voted ? "Voted" : question.own ? "Your question" : "Vote",
      question.own || question.voted || data.snapshot?.status !== "open",
    );
  }
  if (data.view === "mc") {
    actions =
      question.status === "active"
        ? form(path, "done", fields, "Mark answered")
        : form(
            path,
            "select",
            fields,
            "Put on screen",
            data.snapshot?.status === "archived",
          );
  }
  if (moderation && data.snapshot?.status !== "archived") {
    if (question.status === "pending" || question.status === "hidden")
      actions += form(path, "approve", fields, "Approve");
    if (question.status !== "hidden" && question.status !== "answered")
      actions += form(path, "hide", fields, "Hide");
    actions += `<details class="w-full border-t border-ink/20 pt-3"><summary class="w-fit cursor-pointer px-2 py-2 font-bold">Edit question</summary>
      <form action="${escape(path)}" method="post" class="mt-3 grid gap-3" data-qa-action>${hidden("action", "edit")}${fields}
        <label for="edit-${question.id}" class="font-bold">Question text</label><textarea id="edit-${question.id}" name="text" minlength="8" maxlength="500" required rows="3" class="${input}">${escape(question.text)}</textarea>
        <button class="${control} w-fit">Save question</button></form></details>`;
  }
  const labels = {
    pending: "Under consideration",
    approved: "Ready",
    active: "On screen",
    answered: "Answered",
    hidden: "Hidden",
  };
  return `<article class="grid min-w-0 gap-4 border border-ink bg-paper p-5 text-ink ${question.status === "active" ? "border-l-8" : ""}" data-qa-question="${question.id}">
    <div class="flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase"><span>${labels[question.status]}${question.own ? " / Your question" : ""}</span><span>${question.votes} ${question.votes === 1 ? "vote" : "votes"}</span></div>
    <h3 class="break-words text-xl font-bold leading-7 md:text-2xl">${escape(question.text)}</h3>
    ${actions ? `<div class="flex flex-wrap gap-3 ${question.status === "active" ? "qa-on-screen-controls" : ""}">${actions}</div>` : ""}
  </article>`;
}
function submission(data: QaPageData, path: string): string {
  const paused = data.snapshot?.status !== "open" && data.view === "attendee";
  if (data.snapshot?.status === "archived") return "";
  return `<section class="border border-ink bg-ink p-5 text-paper md:p-7" aria-labelledby="qa-ask-title" data-qa-submit-section>
    <p class="text-xs font-bold uppercase text-paper/70">${data.view === "attendee" ? "Your turn" : "Moderator question"}</p>
    <h2 class="mt-2 font-headline text-3xl font-black uppercase" id="qa-ask-title">${data.view === "attendee" ? "Ask a question" : "Add a question"}</h2>
    <p class="mt-3 text-sm leading-6 text-paper/80">${data.view === "attendee" ? "Questions appear after moderator approval. No name or sign-in needed." : "Moderator questions are approved immediately."}</p>
    <form action="${escape(path)}" method="post" class="mt-5 grid gap-3" data-qa-action data-qa-submission>
      ${hidden("action", "add")}${hidden("roomId", data.room!.id)}${hidden("requestId", crypto.randomUUID())}
      <label class="font-bold" for="qa-question">Question for ${escape(data.room!.title)}</label>
      <textarea class="${input}" id="qa-question" name="text" rows="4" minlength="8" maxlength="500" required${paused ? " disabled" : ""}>${escape(data.draft)}</textarea>
      <p class="text-sm text-paper/80">${paused ? "Submissions are paused. Your draft stays here." : "8–500 characters. Please keep personal details out of your question."}</p>
      <button class="min-h-11 border border-paper bg-paper px-5 py-3 font-bold uppercase text-ink transition hover:bg-ink hover:text-paper disabled:opacity-50"${paused ? " disabled" : ""}>${data.view === "attendee" ? "Send question" : "Add question"}</button>
    </form>
  </section>`;
}
function queue(data: QaPageData, path: string): string {
  const questions = data.snapshot!.questions;
  const moderation = data.view === "admin" || data.view === "moderator";
  const group = (title: string, items: QaQuestion[]): string =>
    `<section class="grid gap-4" aria-label="${title}"><div class="flex items-baseline justify-between gap-3 border-b border-ink pb-3"><h2 class="font-headline text-3xl font-black uppercase">${title}</h2><span class="font-bold">${items.length}</span></div>${items.length ? items.map((q) => questionCard(data, q, path)).join("") : `<p class="py-5 text-muted">${title === "Under consideration" ? "No questions waiting for review." : "No questions yet."}</p>`}</section>`;
  if (moderation)
    return `${group(
      "Under consideration",
      questions.filter((q) => q.status === "pending"),
    )}${group(
      "Ready and on screen",
      questions.filter((q) => q.status === "approved" || q.status === "active"),
    )}
    <details class="border-t border-ink pt-4"><summary class="w-fit cursor-pointer py-2 font-bold">Answered and hidden (${questions.filter((q) => q.status === "answered" || q.status === "hidden").length})</summary><div class="mt-4 grid gap-4">${questions
      .filter((q) => q.status === "answered" || q.status === "hidden")
      .map((q) => questionCard(data, q, path))
      .join("")}</div></details>`;
  return group(
    data.view === "mc" ? "MC queue" : "Audience questions",
    questions,
  );
}
function adminControls(data: QaPageData): string {
  const path = "/admin/qa/";
  const rooms = data.rooms
    .map(
      (room) =>
        `<article class="grid gap-4 border border-ink p-5"><div><p class="text-xs font-bold uppercase text-muted">${room.id === data.settings.active_room_id ? "Active session" : room.snapshot.status}</p><h3 class="mt-2 text-xl font-bold">${escape(room.title)}</h3></div><div class="flex flex-wrap gap-3"><a class="${control}" href="/admin/qa/?room=${room.id}">Manage</a>${form(path, "active-room", hidden("roomId", room.id) + hidden("settingsRevision", data.settings.revision), room.id === data.settings.active_room_id ? "Active" : "Make active", room.id === data.settings.active_room_id)}</div></article>`,
    )
    .join("");
  const grants = data.grants
    .map(
      (
        grant,
      ) => `<article class="grid min-w-0 gap-3 border border-ink p-5"><div class="flex flex-wrap justify-between gap-2"><h3 class="font-bold">${escape(grant.label)}</h3><span class="text-xs font-bold uppercase">${grant.role === "mc" ? "MC" : "Moderator"} / ${grant.revoked_at ? "Revoked" : "Active"}</span></div>
    ${grant.link ? `<label for="link-${grant.id}" class="text-sm">Reusable access link</label><input id="link-${grant.id}" class="${input} text-sm" type="text" readonly value="${escape(grant.link)}"><div class="flex flex-wrap gap-3"><button type="button" class="${control}" data-qa-copy="link-${grant.id}">Copy link</button>${form(path, "revoke-grant", hidden("grantId", grant.id), "Revoke access")}</div>` : '<p class="text-sm text-muted">This link and its sessions no longer grant access.</p>'}</article>`,
    )
    .join("");
  return `<section class="mb-10 grid gap-5 border-b border-ink pb-10" aria-labelledby="qa-rooms-title"><div class="flex flex-wrap items-center justify-between gap-4"><h2 id="qa-rooms-title" class="font-headline text-3xl font-black uppercase">Session rooms</h2>${form(path, "active-room", hidden("roomId", "") + hidden("settingsRevision", data.settings.revision), "Close audience entry", !data.settings.active_room_id)}</div><div class="grid gap-4 md:grid-cols-2">${rooms}</div>
    <details><summary class="w-fit cursor-pointer py-3 font-bold">Create another room</summary><form action="${path}" method="post" class="mt-3 flex flex-wrap items-end gap-3" data-qa-action>${hidden("action", "create-room")}<label class="grid min-w-0 gap-2 font-bold" for="qa-room-title">Room title<input class="${input}" id="qa-room-title" name="title" required maxlength="120"></label><button class="${control}">Create room</button></form></details></section>
    <section class="mb-10 grid gap-5 border-b border-ink pb-10" aria-labelledby="qa-access-title"><h2 id="qa-access-title" class="font-headline text-3xl font-black uppercase">Moderator and MC access</h2><p class="max-w-3xl leading-7 text-muted">Links can be reused on any device until you revoke them. Revoking a link also ends every session created through it.</p>
    <form action="${path}" method="post" class="flex flex-wrap items-end gap-3" data-qa-action>${hidden("action", "create-grant")}<label for="qa-grant-label" class="grid min-w-0 gap-2 font-bold">Name or team<input id="qa-grant-label" class="${input}" name="label" required maxlength="120"></label><label for="qa-grant-role" class="grid gap-2 font-bold">Role<select id="qa-grant-role" class="${input}" name="role"><option value="moderator">Moderator</option><option value="mc">MC</option></select></label><button class="${control}">Create access link</button></form><div class="grid gap-4 md:grid-cols-2">${grants || '<p class="text-muted">No access links yet.</p>'}</div></section>`;
}
export function renderQaAccess(notice: string): string {
  return `<div class="max-w-xl"><p class="mb-5 leading-7 text-muted">Open the reusable access link your admin shared, then continue. You can use the same link on another device or after signing out.</p><p role="status" aria-live="polite" data-qa-notice class="mb-4 font-bold">${escape(notice)}</p>
    <form action="/qa/access/" method="post" class="grid gap-4" data-qa-access-form><label for="qa-access-token" class="font-bold">Access code</label><input id="qa-access-token" class="${input}" name="token" type="password" autocomplete="off" required maxlength="43" aria-describedby="qa-access-help"><p id="qa-access-help" class="text-sm text-muted">Your link fills this in automatically. If needed, paste the code after “token=” in the link.</p><button class="${control}">Continue to QA workspace</button></form></div>`;
}
export function renderQaPage(data: QaPageData): string {
  const paths: Record<QaView, string> = {
    attendee: "/qa/",
    moderator: "/qa/moderate/",
    mc: "/qa/mc/",
    present: "/qa/present/",
    screen: "/qa/screen/",
    admin: "/admin/qa/",
  };
  const path = `${paths[data.view]}${data.room && ["admin", "moderator", "mc"].includes(data.view) ? `?room=${data.room.id}` : ""}`;
  if (data.view === "screen") {
    const active = data.snapshot?.questions.find((q) => q.status === "active");
    const size =
      (active?.text.length ?? 0) > 280
        ? "text-[clamp(1.5rem,2.7vw,3.25rem)]"
        : (active?.text.length ?? 0) > 140
          ? "text-[clamp(2rem,3.8vw,4.5rem)]"
          : "text-[clamp(2.5rem,5vw,7rem)]";
    return `<div data-qa-state data-room-id="${data.room?.id ?? ""}" class="grid min-h-screen content-between gap-10 p-8 md:p-14"><div><p class="text-sm font-bold uppercase text-paper/70">SDLCAI / Audience questions</p><h1 class="mt-3 text-xl font-bold">${escape(data.room?.title ?? "Q&A")}</h1></div><p class="break-words font-headline ${size} font-black leading-tight">${escape(active?.text ?? "Waiting for the next question.")}</p><p class="font-headline text-4xl font-black uppercase md:text-6xl">Ask & vote / sdlcai.org/qa</p></div>`;
  }
  const staff = data.view === "moderator" || data.view === "mc";
  const top = `<p role="status" aria-live="polite" data-qa-notice class="mb-5 font-bold">${escape(data.notice)}</p>${staff ? `<div class="mb-6 flex flex-wrap items-center justify-between gap-3"><a class="${control}" href="/qa/screen/" target="_blank" rel="noopener">Open audience screen</a><form action="/qa/logout/" method="post"><button class="${control}">Sign out of QA</button></form></div>` : ""}`;
  if (!data.room || !data.snapshot)
    return `<div data-qa-state data-room-id="">${top}${data.view === "admin" ? adminControls(data) : ""}<p class="border-y border-ink py-10 text-xl leading-8 text-muted">${staff ? "No session selected. An admin will select the active room." : "Audience questions are not open yet."}</p></div>`;
  const summary = `<div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-y border-ink py-5"><div><p class="text-xs font-bold uppercase text-muted">${data.snapshot.status === "open" ? "Questions open" : data.snapshot.status === "paused" ? "Questions paused" : "Session archived"}</p><h2 class="mt-2 font-headline text-3xl font-black uppercase">${escape(data.room.title)}</h2></div>${data.view === "admin" || data.view === "moderator" ? `<div class="flex flex-wrap gap-3">${form(path, "status", hidden("roomId", data.room.id) + hidden("status", data.snapshot.status === "open" ? "paused" : "open"), data.snapshot.status === "open" ? "Pause questions" : "Open questions", data.snapshot.status === "archived" && data.view !== "admin")}${data.view === "admin" ? `<a class="${control}" href="/api/admin/qa/export?room=${data.room.id}">Export questions</a><a class="${control}" href="/qa/mc/?room=${data.room.id}">MC view</a>${form(path, "status", hidden("roomId", data.room.id) + hidden("status", "archived"), "Archive room", data.snapshot.status === "archived")}` : ""}</div>` : ""}</div>`;
  const submit =
    data.view === "attendee" ||
    data.view === "moderator" ||
    data.view === "admin";
  const clear =
    data.view === "admin"
      ? `<details class="mt-10 border-t border-ink pt-4"><summary class="w-fit cursor-pointer py-3 font-bold">Clear this room’s questions</summary><p class="my-3 text-muted">This deletes all questions and votes in this room and pauses submissions. Export questions first if you need them.</p><form action="${path}" method="post" class="flex flex-wrap items-end gap-3" data-qa-action>${hidden("action", "reset")}${hidden("roomId", data.room.id)}${hidden("revision", data.snapshot.revision)}<label for="qa-clear-confirmation" class="grid gap-2 font-bold">Type CLEAR<input id="qa-clear-confirmation" name="confirmation" class="${input}" required pattern="CLEAR"></label><button class="${control}">Clear questions</button></form></details>`
      : "";
  return `<div data-qa-state data-room-id="${data.room.id}" data-revision="${data.snapshot.revision}">${top}${data.view === "admin" ? adminControls(data) : ""}${summary}<div class="grid items-start gap-8 ${submit ? "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)]" : ""}">${submit ? submission(data, path) : ""}<div class="grid min-w-0 gap-8">${queue(data, path)}</div></div>${clear}</div>`;
}
