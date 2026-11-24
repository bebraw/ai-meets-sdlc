import * as v from "valibot";
import type { QueryDatabase } from "../contracts.mjs";
import {
  channels,
  statuses,
  editorialInput,
  editorialDetails,
  clean,
  fail,
  number,
  object,
  operation,
  organizer,
} from "./engagement-common.mjs";

function checkUrl(value: string) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("Use a complete HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    fail("Use an HTTPS URL without embedded credentials.");
}

type EditorialRow = {
  id: string;
  revision: number;
  updated_at: string;
  details: string;
};
function item(row: EditorialRow) {
  return {
    id: row.id,
    revision: row.revision,
    updatedAt: row.updated_at,
    ...v.parse(editorialDetails, JSON.parse(row.details)),
  };
}

export const publication = {
  id: "publication-queue",
  title: "Editorial publication queue",
  description:
    "Keep copy, assets and source links together while tracking review, scheduling and published URLs by channel.",
  migrate(db: QueryDatabase) {
    db.exec(`CREATE TABLE IF NOT EXISTS editorial_items(
      id TEXT PRIMARY KEY,revision INTEGER NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL,details TEXT NOT NULL,updated_at TEXT NOT NULL)`);
  },
  operations: [
    operation(
      "publication_save",
      "Create a draft at revision 0 or save a revised item. Scheduled or published items require a valid publication date; published public posts also require their URL.",
      editorialInput,
      {
        id: "opening-recap",
        revision: 0,
        title: "Opening session recap",
        body: "Takeaways from this year's opening session.",
        channel: "website",
        status: "draft",
        sources: [
          { label: "Programme", url: "https://example.test/programme" },
        ],
        assets: [],
      },
      organizer,
      (input, { db }) => {
        const { id, revision: expected, ...details } = input;
        details.title = clean(details.title, "a title");
        details.body = clean(details.body, "draft copy");
        for (const entry of [...details.sources, ...details.assets])
          checkUrl(entry.url);
        if (details.publicationUrl) checkUrl(details.publicationUrl);
        if (details.publicationDate) {
          const date = Date.parse(details.publicationDate);
          if (
            !Number.isFinite(date) ||
            new Date(date).toISOString().slice(0, 10) !==
              details.publicationDate
          )
            fail("Choose a valid publication date.");
        }
        if (
          ["scheduled", "published"].includes(details.status) &&
          !details.publicationDate
        )
          fail("Set the publication date.");
        if (
          details.status === "published" &&
          details.channel !== "newsletter" &&
          !details.publicationUrl
        )
          fail("Set the published post URL.");
        const now = new Date().toISOString();
        const row =
          expected === 0
            ? db
                .prepare<EditorialRow>(
                  "INSERT INTO editorial_items VALUES(?,1,?,?,?,?) ON CONFLICT DO NOTHING RETURNING *",
                )
                .get(
                  id,
                  details.channel,
                  details.status,
                  JSON.stringify(details),
                  now,
                )
            : db
                .prepare<EditorialRow>(
                  "UPDATE editorial_items SET revision=revision+1,channel=?,status=?,details=?,updated_at=? WHERE id=? AND revision=? RETURNING *",
                )
                .get(
                  details.channel,
                  details.status,
                  JSON.stringify(details),
                  now,
                  id,
                  expected,
                );
        if (!row)
          fail(
            "The publication changed. Reload the item and review its revision.",
            409,
          );
        return item(row);
      },
    ),
    operation(
      "publication_list",
      "List a page of editorial items with optional channel and status filters.",
      object({
        status: v.optional(statuses),
        channel: v.optional(channels),
        offset: v.optional(number(0, 1_000_000)),
      }),
      { status: "draft" },
      organizer,
      (input, { db }) => ({
        items: db
          .prepare<EditorialRow>(
            "SELECT * FROM editorial_items WHERE (? IS NULL OR channel=?) AND (? IS NULL OR status=?) ORDER BY updated_at DESC,id LIMIT 50 OFFSET ?",
          )
          .all(
            input.channel ?? null,
            input.channel ?? null,
            input.status ?? null,
            input.status ?? null,
            input.offset ?? 0,
          )
          .map(item),
      }),
    ),
  ],
};
