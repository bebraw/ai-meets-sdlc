const slideSelector = "[data-presentation-slide]";
const activeClassName = "is-active";
const minimumSwipeDistance = 48;
const minimumSwipeRatio = 1.5;
const reducedMotionQuery = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
);

function initializeSlideDeck() {
  const slides = Array.from(
    document.querySelectorAll<HTMLElement>(slideSelector),
  );

  if (slides.length === 0) return;

  let currentIndex = 0;
  let activeTransition: ViewTransition | undefined;
  let touchStart: { x: number; y: number } | undefined;

  const supportsViewTransitions =
    typeof document.startViewTransition === "function";

  if (supportsViewTransitions) {
    document.documentElement.classList.add("supports-view-transitions");
  }

  function applySlide(index: number) {
    currentIndex = index;

    for (const [slideIndex, slide] of slides.entries()) {
      const isActive = slideIndex === currentIndex;

      slide.classList.toggle(activeClassName, isActive);
      slide.setAttribute("aria-hidden", String(!isActive));

      const progress = slide.querySelector<HTMLElement>(
        "[data-slide-progress]",
      );

      if (progress) {
        progress.textContent = `${currentIndex + 1} / ${slides.length}`;
      }
    }

    const url = new URL(window.location.href);
    url.searchParams.set("slide", String(currentIndex + 1));
    window.history.replaceState({}, "", url);
  }

  function showSlide(index: number, animate = true) {
    const nextIndex = clamp(index, 0, slides.length - 1);

    if (nextIndex === currentIndex && animate) return;

    const direction = nextIndex >= currentIndex ? "forward" : "backward";
    const update = () => applySlide(nextIndex);

    if (!animate || !supportsViewTransitions || reducedMotionQuery.matches) {
      update();
      return;
    }

    activeTransition?.skipTransition();
    document.documentElement.dataset.slideDirection = direction;

    const transition = document.startViewTransition(update);
    activeTransition = transition;

    void transition.finished.finally(() => {
      if (activeTransition !== transition) return;

      activeTransition = undefined;
      delete document.documentElement.dataset.slideDirection;
    });
  }

  function navigate(direction: -1 | 1) {
    showSlide(currentIndex + direction);
  }

  document.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;

    if (["ArrowRight", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      navigate(1);
      return;
    }

    if (["ArrowLeft", "PageUp", "Backspace"].includes(event.key)) {
      event.preventDefault();
      navigate(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      showSlide(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      showSlide(slides.length - 1);
    }
  });

  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.changedTouches[0];
      touchStart = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    },
    { passive: true },
  );

  document.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];

      if (!touchStart || !touch) return;

      const deltaX = touch.clientX - touchStart.x;
      const deltaY = touch.clientY - touchStart.y;
      touchStart = undefined;

      if (
        Math.abs(deltaX) < minimumSwipeDistance ||
        Math.abs(deltaX) < Math.abs(deltaY) * minimumSwipeRatio
      ) {
        return;
      }

      event.preventDefault();
      navigate(deltaX < 0 ? 1 : -1);
    },
    { passive: false },
  );

  showSlide(getInitialIndex(slides.length), false);
}

function getInitialIndex(slideCount: number) {
  const slideNumber = Number(
    new URL(window.location.href).searchParams.get("slide"),
  );

  if (!Number.isInteger(slideNumber)) return 0;

  return clamp(slideNumber - 1, 0, slideCount - 1);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

initializeSlideDeck();

export {};
