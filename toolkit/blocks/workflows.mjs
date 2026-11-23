import { directory } from "./organizer-directory.mjs";
import { checkin } from "./check-in.mjs";
import { posters } from "./poster-proposals.mjs";
import { dinner } from "./dinner-rsvps.mjs";
import { speakers } from "./speaker-workspace.mjs";

export const blocks = [directory, checkin, posters, dinner, speakers];
