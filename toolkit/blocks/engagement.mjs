import { qa } from "./engagement-qa.mjs";
import { feedback } from "./engagement-feedback.mjs";
import { messages } from "./engagement-messages.mjs";
import { newsletter } from "./engagement-newsletter.mjs";
import { publication } from "./engagement-publication.mjs";
import { engagementResults } from "./engagement-results.mjs";

export const blocks = [qa, feedback, messages, newsletter, publication].map(
  (block) => ({
    ...block,
    operations: block.operations.map((op) => ({
      ...op,
      outputSchema: engagementResults[op.name],
    })),
  }),
);
