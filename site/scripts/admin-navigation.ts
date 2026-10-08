import "./index.ts";

const navigation = document.querySelector<HTMLElement>(
  "[data-admin-navigation]",
);
const menu = navigation?.querySelector<HTMLDetailsElement>(
  "[data-admin-workspace-menu]",
);
if (menu) {
  const summary = menu.querySelector("summary");
  const panel = menu.querySelector<HTMLElement>(".admin-workspace-panel");
  function fitMenu() {
    if (!menu?.open || !panel) return;
    panel.style.maxHeight = `${Math.max(80, window.innerHeight - panel.getBoundingClientRect().top - 16)}px`;
  }
  menu.addEventListener("toggle", fitMenu);
  window.addEventListener("resize", fitMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open) return;
    event.preventDefault();
    menu.open = false;
    summary?.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !menu.contains(event.target))
      menu.open = false;
  });
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Node && !menu.contains(event.target))
      menu.open = false;
  });
}

export {};
