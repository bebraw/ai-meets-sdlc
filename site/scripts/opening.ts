import "./slides.ts";

const video = document.querySelector<HTMLVideoElement>("[data-opening-video]");
const playButton =
  document.querySelector<HTMLButtonElement>("[data-play-intro]");
const prompt = document.querySelector<HTMLElement>("[data-video-prompt]");
const error = document.querySelector<HTMLElement>("[data-video-error]");
const preroll = document.querySelector<HTMLElement>("[data-opening-preroll]");
const deck = document.querySelector<HTMLElement>("[data-presentation-deck]");
const continueButton = document.querySelector<HTMLButtonElement>(
  "[data-finish-preroll]",
);

if (
  new URL(window.location.href).searchParams.get("intro") === "1" &&
  preroll &&
  deck &&
  continueButton
) {
  preroll.hidden = false;
  deck.hidden = true;
  continueButton.hidden = false;
  document.body.dataset.preroll = "true";
}

function finishPreroll() {
  if (!preroll || !deck || !continueButton) return;
  video?.pause();
  preroll.hidden = true;
  deck.hidden = false;
  continueButton.hidden = true;
  delete document.body.dataset.preroll;
  const url = new URL(window.location.href);
  url.searchParams.delete("intro");
  window.history.replaceState({}, "", url);
}

continueButton?.addEventListener("click", finishPreroll);

if (video && playButton && prompt && error) {
  playButton.addEventListener("click", () => {
    error.hidden = true;
    void video.play().catch(() => {
      error.hidden = false;
    });
  });
  video.addEventListener("play", () => {
    prompt.hidden = true;
    error.hidden = true;
  });
  video.addEventListener("error", () => {
    error.hidden = false;
  });
  video.querySelector("source")?.addEventListener("error", () => {
    error.hidden = false;
  });
  video.addEventListener("ended", finishPreroll);
}
