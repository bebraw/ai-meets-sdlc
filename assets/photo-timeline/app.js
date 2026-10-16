import {
  topics,
  photoTalks,
  programmeSpeakers,
  photoTopics,
  matchesDiscovery,
} from "./discovery.js";

const $ = (s) => document.querySelector(s);
const node = (tag, className = "", text) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const state = {
  collection: "highlights",
  lens: "all",
  photographer: "",
  chapter: "",
  query: "",
  speaker: "",
  talk: "",
  topic: "",
};
const lenses = [
  ["all", "Everything"],
  ["stage", "On stage"],
  ["panels", "Panels"],
  ["atmosphere", "Between talks"],
  ["sponsors", "Our sponsors"],
  ["beer", "Branded beer"],
];
const chapters = [
  {
    id: "arrival",
    start: 8 * 60,
    end: 9 * 60 + 9,
    title: "Before the first talk",
    short: "Arrivals",
    note: "A quiet stage, a busy desk, and the first conversations.",
    category: "venue",
  },
  {
    id: "morning",
    start: 9 * 60 + 9,
    end: 10 * 60 + 47,
    title: "Ideas take the stage",
    short: "Industry",
    note: "The morning's industry perspectives, seen from the stage and the room.",
    category: "talks",
  },
  {
    id: "coffee",
    start: 10 * 60 + 47,
    end: 11 * 60 + 11,
    title: "The space between",
    short: "Coffee",
    note: "Coffee, familiar faces, and the discussions that carry on after a talk.",
    category: "networking",
  },
  {
    id: "research",
    start: 11 * 60 + 11,
    end: 12 * 60 + 41,
    title: "Research, in conversation",
    short: "Research",
    note: "Academic perspectives and questions from the audience.",
    category: "panels",
  },
  {
    id: "lunch",
    start: 12 * 60 + 41,
    end: 13 * 60 + 31,
    title: "Off the main stage",
    short: "Lunch",
    note: "Lunch, research posters, and conversations in the foyer.",
    category: "posters",
  },
  {
    id: "practice",
    start: 13 * 60 + 31,
    end: 15 * 60,
    title: "From ideas to practice",
    short: "Practice",
    note: "Afternoon industry stories, followed by a shared discussion.",
    category: "panels",
  },
  {
    id: "break",
    start: 15 * 60,
    end: 15 * 60 + 35,
    title: "Another perspective",
    short: "A pause",
    note: "A chance to step back, compare notes, and look around.",
    category: "networking",
  },
  {
    id: "afternoon",
    start: 15 * 60 + 35,
    end: 17 * 60 + 2,
    title: "The last big questions",
    short: "Academia",
    note: "The final talks and panel bring the day's threads together.",
    category: "panels",
  },
  {
    id: "evening",
    start: 17 * 60 + 2,
    end: 21 * 60,
    title: "The people behind the day",
    short: "After hours",
    note: "A shared stage, a group photo, and time to unwind.",
    category: "group-photo",
  },
];
let catalog,
  photos = [],
  currentPhotos = [],
  currentIndex = 0,
  previewOpener,
  stopChapterTracking;
const minutes = (photo) => {
  const [hour, minute, second] = photo.capturedLocal
    .slice(11)
    .split(":")
    .map(Number);
  return hour * 60 + minute + (second || 0) / 60;
};
const clock = (minute) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
const tags = (photo) => photo.tags.map((tag) => tag.toLowerCase());
const matchesLens = (photo) =>
  state.lens === "all" ||
  (state.lens === "stage" &&
    ["talks", "panels", "audience", "group-photo"].includes(photo.category)) ||
  (state.lens === "panels" && photo.category === "panels") ||
  (state.lens === "atmosphere" &&
    ["networking", "venue", "behind-the-scenes", "posters"].includes(
      photo.category,
    )) ||
  tags(photo).includes(state.lens);
const filtered = () =>
  photos.filter(
    (p) =>
      (state.collection === "all" || p.selection === "selected") &&
      matchesLens(p) &&
      (!state.photographer || p.photographer === state.photographer) &&
      matchesDiscovery(p, state, catalog),
  );
const image = (photo, hero = false) => {
  const img = node("img");
  img.src = `/${photo.images.thumbnail.path}`;
  if (hero) {
    img.srcset = `${img.src} ${photo.images.thumbnail.width}w, /${photo.images.preview.path} ${photo.images.preview.width}w`;
    img.sizes = "(min-width: 1000px) 65vw, 95vw";
  }
  img.width = photo.images.thumbnail.width;
  img.height = photo.images.thumbnail.height;
  img.alt =
    photo.altText ||
    photo.caption ||
    `SDLCAI event photo by ${photo.photographer}`;
  img.loading = "lazy";
  img.decoding = "async";
  return img;
};
function photoButton(photo, className, hero = false) {
  const button = node("button", className);
  button.type = "button";
  button.dataset.photoId = photo.id;
  button.setAttribute(
    "aria-label",
    `Open photo: ${photo.caption || photo.filename}, ${photo.capturedLocal.slice(11, 16)}`,
  );
  button.append(image(photo, hero));
  button.addEventListener("click", () => openPhoto(photo, button));
  return button;
}
function credit(photo) {
  return `Photo: ${photo.photographer} / CC BY 4.0`;
}

function applyDiscovery(change, focus = "discovery-status") {
  Object.assign(state, change, { chapter: "" });
  if (
    state.speaker &&
    state.talk &&
    !catalog.talks
      .find((talk) => talk.id === state.talk)
      ?.speakerIds.includes(state.speaker)
  )
    state.talk = "";
  if ($("#preview").open) $("#preview").close();
  render();
  const target = document.getElementById(focus);
  target?.focus({ preventScroll: true });
  if (focus === "discovery-status")
    target?.scrollIntoView({
      block: "start",
      behavior: reducedMotion() ? "instant" : "smooth",
    });
}

function discoveryButton(label, change, className = "context-chip") {
  const button = node("button", className, label);
  button.type = "button";
  button.addEventListener("click", () => applyDiscovery(change));
  return button;
}

function discoveryControls() {
  const section = node("section", "discovery");
  section.setAttribute("aria-labelledby", "discovery-title");
  const intro = node("div", "discovery-heading");
  const title = node("h2", "", "Follow an idea.");
  title.id = "discovery-title";
  intro.append(
    title,
    node(
      "p",
      "muted small",
      "Find a speaker's programme, a talk, or a thread running through the day.",
    ),
  );
  const share = node("button", "copy-view", "Copy this view ↗");
  share.type = "button";
  share.addEventListener("click", () => {
    navigator.clipboard
      .writeText(location.href)
      .then(() => {
        $("#discovery-status").textContent =
          "View link copied. It includes your filters and chapter.";
      })
      .catch(() => {
        $("#discovery-status").textContent =
          "Copy the address bar URL to share this view, including its filters and chapter.";
      });
  });
  intro.append(share);
  section.append(intro);
  const form = node("form", "discovery-fields");
  form.setAttribute("role", "search");
  form.setAttribute("aria-label", "Search the photo timeline");
  const search = node("div", "search-label");
  const searchLabel = node("label", "", "Search the day");
  searchLabel.htmlFor = "discovery-query";
  const searchRow = node("span", "search-row");
  const input = node("input");
  input.type = "search";
  input.id = "discovery-query";
  input.name = "q";
  input.placeholder = "Speaker, talk or topic";
  input.value = state.query;
  input.maxLength = 200;
  const find = node("button", "find-photos", "Find photos →");
  find.type = "submit";
  searchRow.append(input, find);
  search.append(searchLabel, searchRow);
  form.append(search);
  for (const [id, label, values, selected] of [
    [
      "speaker",
      "Speaker programme",
      catalog.speakers
        .filter((speaker) =>
          catalog.talks.some((talk) => talk.speakerIds.includes(speaker.id)),
        )
        .map((speaker) => [speaker.id, speaker.name])
        .sort((a, b) => a[1].localeCompare(b[1])),
      state.speaker,
    ],
    [
      "talk",
      "Talk",
      catalog.talks
        .filter(
          (talk) => !state.speaker || talk.speakerIds.includes(state.speaker),
        )
        .map((talk) => [talk.id, talk.title]),
      state.talk,
    ],
  ]) {
    const labelNode = node("label", "select-label", label);
    const select = node("select");
    select.id = `discovery-${id}`;
    select.append(
      new Option(id === "speaker" ? "All speakers" : "All talks", ""),
    );
    for (const [value, label] of values)
      select.append(new Option(label, value));
    select.value = selected;
    select.addEventListener("change", () =>
      applyDiscovery({ [id]: select.value }, select.id),
    );
    labelNode.append(select);
    form.append(labelNode);
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyDiscovery({ query: input.value.trim() }, "discovery-query");
  });
  section.append(form);
  const topicRow = node("div", "topic-row");
  topicRow.setAttribute("role", "group");
  topicRow.setAttribute("aria-label", "Explore topics");
  topicRow.append(node("span", "eyebrow", "Follow a thread"));
  for (const topic of topics) {
    const button = discoveryButton(
      topic.label,
      { topic: state.topic === topic.id ? "" : topic.id },
      "topic-chip",
    );
    button.setAttribute("aria-pressed", String(state.topic === topic.id));
    topicRow.append(button);
  }
  section.append(topicRow);
  const summary = node("div", "discovery-summary");
  const status = node("p", "small");
  status.id = "discovery-status";
  status.tabIndex = -1;
  status.setAttribute("role", "status");
  const parts = [
    state.query && `“${state.query}”`,
    catalog.speakers.find((speaker) => speaker.id === state.speaker)?.name,
    catalog.talks.find((talk) => talk.id === state.talk)?.title,
    topics.find((topic) => topic.id === state.topic)?.label,
  ].filter(Boolean);
  status.textContent = parts.length
    ? `${currentPhotos.length ? "Following" : "No photos match"}: ${parts.join(" / ")}`
    : "The whole day, in chronological order.";
  summary.append(status);
  if (parts.length)
    summary.append(
      discoveryButton(
        "Clear discovery ×",
        { query: "", speaker: "", talk: "", topic: "" },
        "clear-discovery",
      ),
    );
  section.append(
    summary,
    node(
      "p",
      "context-note small muted",
      "Speaker names describe the programme, not verified people in the photograph. Time-based matches are marked in the preview.",
    ),
  );
  return section;
}

function programmeLabel(photo) {
  const talks = photoTalks(photo, catalog);
  return photo.eventContext?.kind === "panel"
    ? `Panel / ${photo.eventContext.title}`
    : talks.length === 1
      ? talks[0].title
      : photo.caption || "A moment from the day";
}

function programmeDetails(photo, compact = false) {
  const details = node("div", compact ? "frame-programme" : "photo-programme");
  const talks = photoTalks(photo, catalog);
  if (!talks.length) return details;
  if (talks.length === 1 && photo.eventContext?.kind !== "panel") {
    const link = discoveryButton(
      `${talks[0].title} →`,
      { talk: talks[0].id, speaker: "" },
      "programme-title programme-link",
    );
    link.setAttribute("aria-label", `Explore talk: ${talks[0].title}`);
    details.append(link);
  } else details.append(node("p", "programme-title", programmeLabel(photo)));
  const people = node("div", "context-chips");
  for (const speaker of programmeSpeakers(photo, catalog)) {
    const button = discoveryButton(speaker.name, {
      speaker: speaker.id,
      talk: "",
    });
    button.setAttribute("aria-label", `Explore ${speaker.name}'s programme`);
    people.append(button);
  }
  details.append(people);
  return details;
}

function controls() {
  const container = node("section", "explore-controls");
  container.setAttribute("aria-label", "Explore filters");
  const row = node("div", "lens-row");
  for (const [id, label] of lenses) {
    const button = node("button", "lens", label);
    button.type = "button";
    button.id = `lens-${id}`;
    button.setAttribute("aria-pressed", String(state.lens === id));
    button.addEventListener("click", () =>
      applyDiscovery({ lens: id }, button.id),
    );
    row.append(button);
  }
  const options = node("div", "collection-options");
  const scope = node("label", "select-label", "Show ");
  const select = node("select");
  select.id = "collection";
  for (const [value, text] of [
    ["highlights", "The highlights"],
    ["all", "The full public collection"],
  ]) {
    const option = node("option", "", text);
    option.value = value;
    select.append(option);
  }
  select.value = state.collection;
  select.addEventListener("change", () =>
    applyDiscovery({ collection: select.value }, select.id),
  );
  scope.append(select);
  const author = node("label", "select-label", "Through the eyes of ");
  const people = node("select");
  people.id = "photographer";
  for (const person of ["", ...new Set(photos.map((p) => p.photographer))]) {
    const option = node("option", "", person || "All photographers");
    option.value = person;
    people.append(option);
  }
  people.value = state.photographer;
  people.addEventListener("change", () =>
    applyDiscovery({ photographer: people.value }, people.id),
  );
  author.append(people);
  options.append(scope, author);
  container.append(row, options);
  return container;
}

function intro(label, title, description) {
  const header = node("section", "intro");
  const left = node("div");
  left.append(node("p", "eyebrow", label), node("h1", "", title));
  const right = node("div", "intro-note");
  right.append(
    node("p", "", description),
    node("p", "muted small", "13 October 2026 / Marsio / Finnish local time"),
  );
  header.append(left, right);
  return header;
}
function footer() {
  const el = node("footer", "timeline-footer");
  el.append(
    node("p", "eyebrow", "The day, through three photographers"),
    node(
      "p",
      "",
      "Photos by Juho Vepsäläinen, Bulent Sahin and Jaakko Hollmén. Shared under CC BY 4.0. Credit the photographer and mention any edits when sharing.",
    ),
  );
  const links = node("div", "footer-links");
  for (const [label, href] of [
    ["Browse the photo media bank →", "/photos/"],
    ["Download photographer credits", "/api/photos/credits"],
    ["CC BY 4.0 licence ↗", "https://creativecommons.org/licenses/by/4.0/"],
    ["Contact", "/contact/"],
    ["Privacy policy", "/privacy-policy/"],
  ]) {
    const link = node("a", "", label);
    link.href = href;
    links.append(link);
  }
  el.append(links);
  return el;
}

function renderTimeline() {
  const main = $("#main");
  main.replaceChildren(
    intro(
      "SDLCAI 2026 / Photo timeline",
      "A day\nin frames.",
      "First coffee. Big questions. Conversations that kept going. Follow the day, or look at it through a different lens.",
    ),
    controls(),
    discoveryControls(),
  );
  const groups = chapters
    .map((c) => ({
      ...c,
      photos: currentPhotos.filter(
        (p) => minutes(p) >= c.start && minutes(p) < c.end,
      ),
    }))
    .filter((c) => c.photos.length);
  if (!groups.length) {
    main.append(
      node(
        "p",
        "empty",
        "There are no photos in this combination. Clear discovery or try another lens, collection or photographer.",
      ),
      footer(),
    );
    const reset = discoveryButton(
      "Reset all filters",
      {
        collection: "highlights",
        lens: "all",
        photographer: "",
        query: "",
        speaker: "",
        talk: "",
        topic: "",
      },
      "reset-filters",
    );
    main.insertBefore(reset, main.lastElementChild);
    return;
  }
  const navigation = node("nav", "chapter-nav");
  navigation.setAttribute("aria-label", "Jump to a chapter");
  const track = node("div", "chapter-track");
  track.tabIndex = 0;
  track.setAttribute("role", "group");
  track.setAttribute("aria-label", "Chapters, scroll for more");
  for (const group of groups) {
    const a = node("a", "chapter-link");
    a.href = `#${group.id}`;
    a.dataset.chapter = group.id;
    if (state.chapter === group.id) a.setAttribute("aria-current", "location");
    a.append(
      node("span", "chapter-clock", clock(group.start)),
      node("span", "", group.short),
    );
    a.addEventListener("click", () => {
      state.chapter = group.id;
    });
    track.append(a);
  }
  navigation.append(track);
  main.append(navigation);
  const story = node("div", "daybook");
  for (const [index, group] of groups.entries()) {
    const section = node(
      "section",
      `chapter chapter-${index % 2 ? "right" : "left"}`,
    );
    section.id = group.id;
    const heading = node("div", "chapter-heading");
    const time = node("div", "chapter-time");
    time.append(
      node(
        "span",
        "eyebrow",
        `${String(chapters.findIndex((chapter) => chapter.id === group.id) + 1).padStart(2, "0")} / ${group.short}`,
      ),
      node("span", "big-clock", clock(group.start)),
    );
    const title = node("div");
    title.append(node("h2", "", group.title), node("p", "muted", group.note));
    heading.append(time, title);
    section.append(heading);
    const feature =
      ((state.speaker || state.talk) &&
        group.photos.find(
          (photo) =>
            photo.eventContext?.kind === "talk" && photo.width >= photo.height,
        )) ||
      group.photos.find(
        (p) => p.category === group.category && p.width >= p.height,
      ) ||
      group.photos.find((p) => p.width >= p.height) ||
      group.photos[0];
    const figure = node("figure", "chapter-feature");
    figure.append(photoButton(feature, "feature-photo", true));
    const caption = node("figcaption");
    caption.append(
      node("p", "", feature.caption || group.title),
      node(
        "p",
        "credit",
        `${feature.capturedLocal.slice(11, 16)} / ${credit(feature)}`,
      ),
    );
    figure.append(caption);
    section.append(figure, programmeDetails(feature));
    const others = group.photos.filter((p) => p !== feature);
    if (others.length) {
      const strip = node("div", "filmstrip");
      strip.tabIndex = 0;
      strip.setAttribute("role", "group");
      strip.setAttribute(
        "aria-label",
        `More moments: ${group.short}, scroll for more`,
      );
      for (const photo of others) {
        const frame = node("figure", "film-frame");
        frame.append(photoButton(photo, "film-photo"));
        const caption = node("figcaption");
        caption.append(
          node("span", "frame-time", photo.capturedLocal.slice(11, 16)),
          node("span", "credit", photo.photographer),
        );
        frame.append(caption);
        frame.append(programmeDetails(photo, true));
        strip.append(frame);
      }
      section.append(
        strip,
        node(
          "p",
          "strip-hint muted small",
          "Follow the strip → Open any frame to look closer.",
        ),
      );
    }
    story.append(section);
  }
  main.append(story, footer());
  let frame = 0;
  const updateChapter = () => {
    frame = 0;
    const threshold =
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) ||
      0;
    let active;
    for (const section of story.children) {
      if (section.getBoundingClientRect().top <= threshold + 1)
        active = section;
      else break;
    }
    if (!active) return;
    state.chapter = active.id;
    history.replaceState(
      null,
      "",
      location.pathname + location.search + `#${state.chapter}`,
    );
    for (const link of navigation.querySelectorAll("a")) {
      if (link.dataset.chapter === active.id)
        link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(updateChapter);
  };
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  stopChapterTracking = () => {
    removeEventListener("scroll", schedule);
    removeEventListener("resize", schedule);
    cancelAnimationFrame(frame);
  };
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function render() {
  stopChapterTracking?.();
  currentPhotos = filtered();
  const params = new URLSearchParams();
  if (state.lens !== "all") params.set("lens", state.lens);
  if (state.collection === "all") params.set("collection", "all");
  if (state.photographer) params.set("photographer", state.photographer);
  if (state.query) params.set("q", state.query);
  if (state.speaker) params.set("speaker", state.speaker);
  if (state.talk) params.set("talk", state.talk);
  if (state.topic) params.set("topic", state.topic);
  history.replaceState(
    null,
    "",
    location.pathname +
      (params.size ? `?${params}` : "") +
      (state.chapter ? `#${state.chapter}` : ""),
  );
  renderTimeline();
  if (state.chapter && !document.getElementById(state.chapter)) {
    state.chapter = "";
    history.replaceState(null, "", location.pathname + location.search);
  }
}
function openPhoto(photo, opener) {
  previewOpener = opener;
  currentIndex = currentPhotos.findIndex((p) => p.id === photo.id);
  updatePreview();
  if (!$("#preview").open) $("#preview").showModal();
}
function updatePreview() {
  const photo = currentPhotos[currentIndex];
  if (!photo) return;
  $("#large-photo").src = `/${photo.images.preview.path}`;
  $("#large-photo").width = photo.images.preview.width;
  $("#large-photo").height = photo.images.preview.height;
  $("#large-photo").alt = photo.altText || photo.caption || photo.filename;
  $("#preview-title").textContent = "SDLCAI / A closer look";
  $("#preview-time").textContent =
    `${photo.capturedLocal.slice(11, 16)} / ${photo.category.replaceAll("-", " ")} / Finnish time`;
  $("#preview-caption").textContent = photo.caption || "A moment from SDLCAI";
  $("#preview-context").textContent = photo.eventContext
    ? `${photo.eventContext.association === "timing-only" ? "Time-based programme context" : "Programme context"}: ${photo.eventContext.title}`
    : "";
  const discovery = $("#preview-discovery");
  discovery.replaceChildren();
  {
    const talks = photoTalks(photo, catalog);
    if (talks.length) {
      discovery.append(
        node("p", "eyebrow", "Keep exploring"),
        programmeDetails(photo),
      );
      const links = node("div", "context-chips");
      for (const talk of talks.length > 1 ? talks : [])
        links.append(
          discoveryButton(`Explore talk: ${talk.title} →`, {
            talk: talk.id,
            speaker: "",
          }),
        );
      discovery.append(links);
    }
    const threads = node("div", "context-chips topic-links");
    for (const topic of photoTopics(photo))
      threads.append(discoveryButton(topic.label, { topic: topic.id }));
    discovery.append(threads);
    if (
      photo.eventContext?.recordingOffsetSeconds != null &&
      ["talk", "panel"].includes(photo.eventContext.kind)
    ) {
      const watch = node(
        "a",
        "recording-link",
        "Watch this moment in the recording ↗",
      );
      watch.href = `https://www.youtube.com/watch?v=d7POyy6dYFI&t=${photo.eventContext.recordingOffsetSeconds}s`;
      watch.target = "_blank";
      watch.rel = "noreferrer";
      discovery.append(watch);
    }
    discovery.append(
      node(
        "p",
        "small muted",
        "Programme associations help you explore; they do not identify people in the photograph.",
      ),
    );
  }
  $("#preview-credit").textContent = credit(photo);
  $("#fullscreen-credit").textContent = credit(photo);
  $("#download").href = `/media/event-photos/${photo.id}/share.jpg?download=1`;
  $("#gallery").href =
    `/photos/?selection=&search=${encodeURIComponent(photo.filename)}`;
  $("#previous").disabled = currentIndex <= 0;
  $("#next").disabled = currentIndex >= currentPhotos.length - 1;
}
$("#previous").addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex--;
    updatePreview();
  }
});
$("#next").addEventListener("click", () => {
  if (currentIndex < currentPhotos.length - 1) {
    currentIndex++;
    updatePreview();
  }
});
$("#close").addEventListener("click", () => $("#preview").close());
$("#preview").addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#preview").classList.contains("immersive")) {
    event.preventDefault();
    exitImmersive();
    return;
  }
  if (event.key === "ArrowLeft" && currentIndex > 0) {
    event.preventDefault();
    currentIndex--;
    updatePreview();
  }
  if (event.key === "ArrowRight" && currentIndex < currentPhotos.length - 1) {
    event.preventDefault();
    currentIndex++;
    updatePreview();
  }
});
$("#fullscreen").addEventListener("click", async () => {
  const preview = $("#preview");
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (preview.classList.contains("immersive")) {
    exitImmersive();
    return;
  }
  if (preview.requestFullscreen) {
    try {
      await preview.requestFullscreen();
      return;
    } catch {}
  }
  preview.classList.add("immersive");
  $("#fullscreen").textContent = "Exit full screen";
  $("#fullscreen").setAttribute("aria-pressed", "true");
});
function exitImmersive() {
  $("#preview").classList.remove("immersive");
  $("#fullscreen").textContent = "Full screen";
  $("#fullscreen").setAttribute("aria-pressed", "false");
}
document.addEventListener("fullscreenchange", () => {
  const fullscreen = Boolean(document.fullscreenElement && $("#preview").open);
  $("#fullscreen").textContent = fullscreen
    ? "Exit full screen"
    : "Full screen";
  $("#fullscreen").setAttribute("aria-pressed", String(fullscreen));
});
$("#preview").addEventListener("close", () => {
  exitImmersive();
  if (document.fullscreenElement)
    void document.exitFullscreen().catch(() => {});
  if (previewOpener?.isConnected) previewOpener.focus({ preventScroll: true });
});
function themeLabel() {
  $("#theme").textContent =
    document.documentElement.dataset.theme === "dark"
      ? "Light mode"
      : "Dark mode";
}
themeLabel();
$("#theme").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  themeLabel();
  try {
    localStorage.setItem("sdlcai-theme", theme);
  } catch {}
});
async function loadCatalog() {
  $("#main").setAttribute("aria-busy", "true");
  try {
    const response = await fetch("/api/photos/catalog", {
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Could not load the public collection.");
    catalog = await response.json();
    photos = catalog.photos
      .filter((p) => ["selected", "alternate"].includes(p.selection))
      .sort(
        (a, b) =>
          Date.parse(a.capturedAt) - Date.parse(b.capturedAt) ||
          a.id.localeCompare(b.id),
      );
    const params = new URLSearchParams(location.search);
    if (lenses.some(([id]) => id === params.get("lens")))
      state.lens = params.get("lens");
    if (params.get("collection") === "all") state.collection = "all";
    if (photos.some((p) => p.photographer === params.get("photographer")))
      state.photographer = params.get("photographer");
    {
      state.query = (params.get("q") || "").trim().slice(0, 200);
      if (
        catalog.speakers.some((speaker) => speaker.id === params.get("speaker"))
      )
        state.speaker = params.get("speaker");
      if (
        catalog.talks.some(
          (talk) =>
            talk.id === params.get("talk") &&
            (!state.speaker || talk.speakerIds.includes(state.speaker)),
        )
      )
        state.talk = params.get("talk");
      if (topics.some((topic) => topic.id === params.get("topic")))
        state.topic = params.get("topic");
      if (chapters.some((chapter) => `#${chapter.id}` === location.hash))
        state.chapter = location.hash.slice(1);
    }
    render();
    if (state.chapter)
      requestAnimationFrame(() =>
        document
          .getElementById(state.chapter)
          ?.scrollIntoView({ behavior: "instant" }),
      );
  } catch {
    const message = node("div", "empty");
    const retry = node("button", "", "Retry loading photos");
    retry.type = "button";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Loading photos…";
      void loadCatalog();
    });
    message.append(
      node("h1", "", "A day in frames"),
      node("p", "", "Could not load the public collection. Please try again."),
      retry,
    );
    $("#main").replaceChildren(message, footer());
  } finally {
    $("#main").setAttribute("aria-busy", "false");
  }
}

// Load metadata after the shell has painted, including navigation transitions.
await new Promise((resolve) => {
  const idle = () => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(resolve, { timeout: 1000 });
    else setTimeout(resolve, 0);
  };
  const afterPaint = () => {
    if (
      typeof PerformanceObserver !== "function" ||
      !PerformanceObserver.supportedEntryTypes.includes("paint") ||
      performance.getEntriesByName("first-contentful-paint").length
    ) {
      idle();
      return;
    }
    let finished = false;
    const observer = new PerformanceObserver((list) => {
      if (
        list
          .getEntries()
          .some((entry) => entry.name === "first-contentful-paint")
      )
        ready();
    });
    const ready = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallback);
      observer.disconnect();
      idle();
    };
    const fallback = setTimeout(ready, 1000);
    try {
      observer.observe({ type: "paint", buffered: true });
    } catch {
      ready();
    }
  };
  const afterLoad = () =>
    requestAnimationFrame(() => requestAnimationFrame(afterPaint));
  if (document.readyState === "complete") afterLoad();
  else addEventListener("load", afterLoad, { once: true });
});
await loadCatalog();
