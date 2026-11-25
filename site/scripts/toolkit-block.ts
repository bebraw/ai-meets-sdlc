import { engagementDemos } from "./toolkit/engagement.ts";
import { programmeDemos } from "./toolkit/programme.ts";
import { venueDemos } from "./toolkit/venue.ts";

const demos = { ...engagementDemos, ...programmeDemos, ...venueDemos };
const root = document.querySelector<HTMLElement>("[data-toolkit-demo]");
const reset = document.querySelector<HTMLButtonElement>("[data-reset-demo]");
if (root && reset) {
  const mount = demos[root.dataset.toolkitDemo ?? ""];
  if (!mount)
    throw new Error("Missing toolkit example for " + root.dataset.toolkitDemo);
  root.replaceChildren();
  mount(root);
  reset.hidden = false;
  let mounted = root;
  reset.addEventListener("click", () => {
    const next = mounted.cloneNode(false) as HTMLElement;
    mounted.replaceWith(next);
    mounted = next;
    mount(next);
  });
}
