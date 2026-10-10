import "./admin-navigation.ts";

const players = document.querySelectorAll<HTMLVideoElement>(
  "[data-intro-player]",
);

for (const review of document.querySelectorAll<HTMLElement>(
  "[data-intro-review]",
)) {
  const player = review.querySelector<HTMLVideoElement>("[data-intro-player]");
  if (!player) continue;
  const chapters = review.querySelector<HTMLElement>("[data-intro-chapters]");
  const error = review.querySelector<HTMLElement>("[data-intro-error]");
  const ready = () => {
    if (chapters) chapters.hidden = false;
    if (error) error.hidden = true;
  };
  player.addEventListener("loadedmetadata", ready);
  if (player.readyState >= HTMLMediaElement.HAVE_METADATA) ready();
  player.addEventListener("play", () => {
    for (const other of players) {
      if (other !== player) other.pause();
    }
  });
  player.addEventListener("error", () => {
    if (error) error.hidden = false;
    if (chapters) chapters.hidden = true;
  });
  chapters
    ?.querySelectorAll<HTMLButtonElement>("[data-intro-seek]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        player.currentTime = Number(button.dataset.introSeek);
        player.focus();
      });
    });
}

for (const archive of document.querySelectorAll<HTMLDetailsElement>(
  "details[data-intro-collapse]",
)) {
  archive.addEventListener("toggle", () => {
    if (archive.open) return;
    for (const player of archive.querySelectorAll<HTMLVideoElement>(
      "[data-intro-player]",
    )) {
      player.pause();
    }
  });
}

export {};
