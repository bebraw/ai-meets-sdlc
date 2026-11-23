import { directory } from "./organizer-directory.mjs";
import { checkin } from "./check-in.mjs";
import { posters } from "./poster-proposals.mjs";
import { dinner } from "./dinner-rsvps.mjs";
import { speakers } from "./speaker-workspace.mjs";

export const blocks: [
  typeof directory,
  typeof checkin,
  typeof posters,
  typeof dinner,
  typeof speakers,
] = [directory, checkin, posters, dinner, speakers];

type WorkflowOperation = (typeof blocks)[number]["operations"][number];
/** The human interface uses the same result types as the handlers. */
export type WorkflowResults = {
  [T in WorkflowOperation as T["name"]]: Awaited<ReturnType<T["run"]>>;
};
