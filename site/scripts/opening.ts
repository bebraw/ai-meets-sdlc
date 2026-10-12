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
const previewButton =
  document.querySelector<HTMLButtonElement>("[data-use-preview]");
const quality = document.querySelector<HTMLElement>("[data-opening-quality]");
let playbackRequested = false;
let playAttempt = 0;

if (
  new URL(window.location.href).searchParams.get("intro") === "1" &&
  preroll &&
  deck &&
  continueButton
) {
  preroll.hidden = false;
  deck.hidden = true;
  continueButton.hidden = false;
  if (previewButton) previewButton.hidden = false;
  document.body.dataset.preroll = "true";
}

function finishPreroll() {
  if (!preroll || !deck || !continueButton) return;
  playbackRequested = false;
  playAttempt += 1;
  video?.pause();
  preroll.hidden = true;
  deck.hidden = false;
  continueButton.hidden = true;
  if (previewButton) previewButton.hidden = true;
  delete document.body.dataset.preroll;
  const url = new URL(window.location.href);
  url.searchParams.delete("intro");
  window.history.replaceState({}, "", url);
}

continueButton?.addEventListener("click", finishPreroll);

if (video && playButton && prompt && error) {
  let usingPreview = false;

  function showError() {
    if (preroll?.hidden) return;
    prompt!.hidden = false;
    error!.hidden = false;
  }

  function usePreview() {
    const source = video!.dataset.openingPreviewSrc;
    if (!source || usingPreview || preroll?.hidden) return;
    const position = video!.currentTime;
    usingPreview = true;
    playAttempt += 1;
    video!.pause();
    video!.src = source;
    video!.load();
    video!.currentTime = position;
    if (quality) quality.textContent = "1080p";
    if (previewButton) {
      previewButton.disabled = true;
      previewButton.textContent = "1080p";
    }
    if (playbackRequested) playFilm();
  }

  function playFilm() {
    if (preroll?.hidden) return;
    playbackRequested = true;
    const attempt = ++playAttempt;
    error!.hidden = true;
    void video!.play().catch((reason: unknown) => {
      if (attempt !== playAttempt || preroll?.hidden) return;
      if (reason instanceof DOMException && reason.name === "AbortError")
        return;
      if (
        reason instanceof DOMException &&
        reason.name === "NotSupportedError" &&
        !usingPreview
      ) {
        usePreview();
        return;
      }
      showError();
    });
  }

  playButton.addEventListener("click", playFilm);
  previewButton?.addEventListener("click", usePreview);
  video.addEventListener("play", () => {
    if (preroll?.hidden) {
      video.pause();
      return;
    }
    playbackRequested = true;
    prompt.hidden = true;
    error.hidden = true;
  });
  video.addEventListener("error", () => {
    if (usingPreview) showError();
    else usePreview();
  });
  video.addEventListener("ended", finishPreroll);
}
