import { fontSelect } from "../print-options.ts";
import {
  printFontIds,
  printFontCss,
} from "../../../toolkit/blocks/print-fonts.mts";
import {
  buildProgrammeFeed,
  feedExample,
} from "../../../toolkit/blocks/programme-feed.mts";
import {
  fitTalkArtwork,
  renderSchedule,
  renderTalkArtwork,
} from "../../../toolkit/blocks/programme-render.mts";
import { prepareCateringBrief } from "../../../toolkit/blocks/diets.mts";
import { button, el, field, input, panel, select } from "./controls.ts";

const eventName = feedExample.event.name;

function result(title: string) {
  const view = panel(title);
  view.body.setAttribute("aria-live", "polite");
  view.body.setAttribute("aria-atomic", "true");
  return view;
}

function download(filename: string, type: string, text: string) {
  const link = el("a");
  const url = URL.createObjectURL(new Blob([text], { type }));
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function posters(root: HTMLElement) {
  const decision = select([
    "Submitted",
    "Shortlisted",
    "Accepted",
    "Waitlisted",
    "Declined",
    "Withdrawn",
  ]);
  const view = result("Presenter handoff for check-in");
  function update() {
    if (decision.value === "Accepted") {
      view.body.replaceChildren(
        el("strong", "1 accepted presenter"),
        el("p", "Alex Li · Diagram Lab · alex@example.test"),
        el("p", "Roster source · Poster"),
      );
    } else {
      view.body.replaceChildren(
        el("strong", "0 accepted presenters"),
        el(
          "p",
          "Alex’s proposal is marked " +
            decision.value.toLowerCase() +
            ". Only accepted presenters appear in the handoff.",
        ),
      );
    }
  }
  decision.addEventListener("change", update);
  root.replaceChildren(
    field("Review decision for “Accessible diagram design”", decision),
    view.panel,
  );
  update();
}

function speakers(root: HTMLElement) {
  const permission = select([
    "Keep the PDF private",
    "Allow the organizer to share it",
  ]);
  const view = result("Public programme");
  const material = el("p");
  view.body.replaceChildren(
    el("strong", "Field research in practice"),
    el("p", "Zoë Marin"),
    material,
  );
  const status = el("p");
  status.setAttribute("role", "status");
  let published = false;
  const publish = button("Publish slides as organizer", () => {
    published = !published;
    update();
  });
  function update() {
    const allowed = permission.selectedIndex === 1;
    if (!allowed) published = false;
    publish.disabled = !allowed;
    publish.textContent = published
      ? "Unpublish slides as organizer"
      : "Publish slides as organizer";
    material.textContent = published
      ? "Available to attendees · field-research.pdf"
      : "No public materials.";
    status.textContent = published
      ? "The organizer has released the PDF."
      : allowed
        ? "Slides awaiting organizer publication."
        : "Slides are private to the speaker workspace.";
  }
  permission.addEventListener("change", update);
  root.replaceChildren(
    field("Speaker’s choice for field-research.pdf", permission),
    publish,
    status,
    view.panel,
  );
  update();
}

function programme(root: HTMLElement) {
  const reference = select(["zoey", "zoe"]);
  const view = result("Feed validation");
  let file = "";
  const save = button("Download event.json", () =>
    download("event.json", "application/json", file),
  );
  let validation = 0;
  async function update() {
    const revision = ++validation;
    save.disabled = true;
    const data = structuredClone(feedExample);
    data.sessions[0]!.speakerIds = [reference.value];
    try {
      const feed = await buildProgrammeFeed(data);
      if (revision !== validation) return;
      file = JSON.stringify(feed, null, 2) + "\n";
      view.body.replaceChildren(
        el("strong", "Valid programme"),
        el("p", "Field research in practice → Zoë Marin"),
        el(
          "p",
          "Schema version " +
            feed.schemaVersion +
            " · Revision " +
            feed.revision.slice(0, 12),
        ),
      );
      save.disabled = false;
    } catch (error) {
      if (revision !== validation) return;
      view.body.replaceChildren(
        el("strong", "Feed unavailable"),
        el(
          "p",
          error instanceof Error
            ? error.message
            : "Programme validation failed.",
        ),
      );
    }
  }
  reference.addEventListener("change", () => void update());
  root.replaceChildren(
    field("Speaker ID on the session", reference),
    view.panel,
    save,
  );
  void update();
}

function schedule(root: HTMLElement) {
  const mode = select(["Agenda", "Venue screen"]);
  const zone = select(["Europe/Helsinki", "Europe/London", "America/New_York"]);
  const { panel: view, body } = panel("Schedule preview");
  const preview = el("iframe");
  preview.title = "Field Notes Forum schedule preview";
  preview.setAttribute("sandbox", "");
  preview.style.cssText = "width:100%;height:26rem;border:0";
  body.replaceChildren(preview);
  let html = "";
  const save = button("Download schedule.html", () =>
    download("schedule.html", "text/html", html),
  );
  function update() {
    const rendered = renderSchedule({
      eventName,
      timeZone: zone.value,
      mode: mode.value === "Agenda" ? "agenda" : "screen",
      sessions: [
        {
          start: "2026-06-20T09:00:00+03:00",
          title: "Registration",
          room: "Lobby",
        },
        {
          start: "2026-06-20T10:00:00+03:00",
          title: "Field research in practice",
          speakers: ["Zoë Marin"],
          room: "Assembly Hall",
        },
      ],
    });
    html = rendered.html;
    preview.srcdoc = html;
  }
  zone.addEventListener("change", update);
  mode.addEventListener("change", update);
  root.replaceChildren(
    field("Display", mode),
    field("Event time zone", zone),
    view,
    save,
  );
  update();
}

function graphics(root: HTMLElement) {
  const title = input("Field research in practice");
  title.maxLength = 300;
  title.required = true;
  const colors: Record<string, string> = {
    Sage: "#b5e9b0",
    Apricot: "#ffc392",
    Sky: "#baddff",
  };
  const accent = select(Object.keys(colors));
  const font = fontSelect();
  const view = panel("Artwork preview");
  const preview = el("iframe");
  preview.title = "Sample talk announcement";
  preview.setAttribute("sandbox", "allow-same-origin");
  preview.style.cssText =
    "width:100%;aspect-ratio:1200 / 630;border:0;display:block";
  const status = el("p");
  status.setAttribute("role", "status");
  preview.addEventListener("load", async () => {
    const doc = preview.contentDocument;
    if (!doc?.querySelector("section")) return;
    const fits = await fitTalkArtwork(doc);
    if (doc === preview.contentDocument) {
      status.textContent = fits
        ? "The title fits this 1200 × 630 layout."
        : "The copy exceeds the layout. Try shortening the title.";
    }
  });
  function update() {
    const copy = title.value.trim();
    if (!copy) {
      title.setCustomValidity("Enter a talk title.");
      title.reportValidity();
      return;
    }
    const { html, css } = renderTalkArtwork({
      eventName,
      title: copy,
      speaker: "Zoë Marin",
      caption: "Lessons from a year of listening.",
      accent: colors[accent.value]!,
    });
    preview.srcdoc =
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Talk announcement</title><style>' +
      printFontCss(printFontIds[font.selectedIndex]) +
      "*{box-sizing:border-box}html,body{margin:0}" +
      css +
      "</style><body>" +
      html +
      "</body></html>";
  }
  title.addEventListener("input", () => title.setCustomValidity(""));
  font.addEventListener("change", update);
  view.body.replaceChildren(preview, status);
  root.replaceChildren(
    field("Talk title", title),
    field("Accent color", accent),
    field("Typeface", font),
    button("Update artwork", update),
    view.panel,
  );
  update();
}

function directory(root: HTMLElement) {
  const visibility = select(["Private to organizers", "Visible to visitors"]);
  const position = select(["After Morgan Reed", "Before Morgan Reed"]);
  const view = result("Public organizer directory");
  function update() {
    const list = el("ol");
    const team = ["Morgan Reed · Example Arts"];
    if (visibility.selectedIndex === 1) {
      team.splice(
        position.selectedIndex === 1 ? 0 : 1,
        0,
        "Ari Chen · Local Lab",
      );
    }
    for (const name of team) list.appendChild(el("li", name));
    view.body.replaceChildren(list);
  }
  visibility.addEventListener("change", update);
  position.addEventListener("change", update);
  root.replaceChildren(
    field("Ari Chen’s visibility", visibility),
    field("Ari Chen’s display position", position),
    view.panel,
  );
  update();
}

function catering(root: HTMLElement) {
  const reply = input("Tree nut allergy");
  reply.maxLength = 2000;
  const reserved = select(["0", "1", "2", "3"]);
  const view = result("Caterer’s brief");
  let brief = "";
  function update() {
    const extra = Number(reserved.value);
    const { summary, text } = prepareCateringBrief(
      eventName,
      ["Vegan and gluten free", "No restrictions", reply.value].map((diet) => ({
        status: "active",
        diet,
      })),
      extra,
    );
    brief = text;
    const groups = el("ul");
    for (const group of summary.groups) {
      groups.appendChild(
        el(
          "li",
          group.count +
            " × " +
            group.label +
            (group.needsReview ? " · Needs review" : "") +
            " — " +
            group.responses.map((response) => response.text).join(", "),
        ),
      );
    }
    view.body.replaceChildren(
      el("strong", summary.active + " meals to prepare"),
      el(
        "p",
        `${extra} reserved · ${summary.noRestrictions} without restrictions · ${summary.missing} missing details · ${summary.needsReview} need review`,
      ),
      groups,
    );
  }
  const save = button("Download catering-brief.txt", () =>
    download("catering-brief.txt", "text/plain", brief),
  );
  function markEdited() {
    if (save.disabled) return;
    save.disabled = true;
    view.body.textContent =
      "Update the meal counts to prepare the edited brief.";
  }
  reply.addEventListener("input", markEdited);
  reserved.addEventListener("change", markEdited);
  root.replaceChildren(
    field("Third guest’s dietary response", reply),
    field("Additional reserved meals", reserved),
    button("Update meal counts", () => {
      update();
      save.disabled = false;
    }),
    view.panel,
    save,
  );
  update();
}

export const programmeDemos: Record<string, (root: HTMLElement) => void> = {
  "poster-proposals": posters,
  "speaker-workspace": speakers,
  "programme-feed": programme,
  schedule,
  "talk-graphics": graphics,
  "organizer-directory": directory,
  catering,
};
