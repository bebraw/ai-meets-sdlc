import * as v from "valibot";
import type { Context, QueryDatabase, Services } from "../contracts.mjs";
import type { Organizer } from "./organizer-store.mjs";
import { randomUUID } from "node:crypto";
import { organizerSchema, organizerStore } from "./organizer-store.mjs";
import {
  anyone,
  bool,
  fail,
  id,
  obj,
  withOptional,
  operation,
  organizer,
  rev,
  text,
  time,
  word,
} from "./workflow-helpers.mjs";

const details = {
  name: word(),
  company: text(200),
  photo: v.pipe(
    text(1000),
    v.regex(/^$|^\/assets\/[a-zA-Z0-9_/-]+\.(webp|png|jpg|svg)$/),
  ),
  visible: bool,
  badge: bool,
  position: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)),
};
const member = withOptional(details, [
  "company",
  "photo",
  "visible",
  "badge",
  "position",
]);
const sample = {
  name: "Morgan Reed",
  company: "Example Arts",
  position: 1,
  visible: true,
  badge: true,
};
const values = (input: v.InferOutput<typeof member>) => [
  input.name.trim().normalize("NFC"),
  (input.company ?? "").trim(),
  input.photo ?? "",
  Number(input.visible ?? false),
  Number(input.badge ?? false),
  input.position ?? 0,
  time(),
];
function store(ctx: Context) {
  if (ctx.services.organizerStore) return ctx.services.organizerStore;
  return organizerStore({
    all: (sql, params) => ctx.db.prepare<Organizer>(sql).all(...params),
    write: (sql, params) => Number(ctx.db.prepare(sql).run(...params).changes),
  });
}
function checkCount(count: number) {
  if (!count)
    fail("This organizer changed elsewhere. Reload before saving.", 409);
}
export const directory = {
  id: "organizer-directory",
  title: "Organizer directory",
  description:
    "Maintain an event team and publish the people who choose to appear in its directory.",
  usesExternalStore: (services: Services) => Boolean(services.organizerStore),
  migrate(db: QueryDatabase) {
    db.exec(organizerSchema);
  },
  operations: [
    operation(
      "organizers_public",
      "Read the publicly visible team in display order.",
      obj({}),
      {},
      anyone,
      async (_, ctx) => ({
        people: (await store(ctx).list(true)).map(
          ({ id, name, company, photo }) => ({ id, name, company, photo }),
        ),
      }),
    ),
    operation(
      "organizers_list",
      "List team records including revision, visibility and badge choices.",
      obj({}),
      {},
      organizer,
      async (_, ctx) => ({ people: await store(ctx).list() }),
    ),
    operation(
      "organizers_create",
      "Add a team member. Entries default to private.",
      member,
      sample,
      organizer,
      async (input, ctx) => {
        const id = randomUUID();
        await store(ctx).create(id, values(input));
        return { id, revision: 1 };
      },
    ),
    operation(
      "organizers_update",
      "Replace directory details if the supplied revision is current.",
      withOptional({ id, revision: rev, ...details }, ["company", "photo"]),
      { id: "from-organizers-list", revision: 1, ...sample },
      organizer,
      async (input, ctx) => {
        checkCount(
          await store(ctx).update(input.id, input.revision, values(input)),
        );
        return { id: input.id, revision: input.revision + 1 };
      },
    ),
    operation(
      "organizers_delete",
      "Remove the selected directory entry at its current revision.",
      obj({ id, revision: rev }),
      { id: "from-organizers-list", revision: 1 },
      organizer,
      async (input, ctx) => {
        checkCount(await store(ctx).remove(input.id, input.revision));
        return { removed: true };
      },
    ),
  ],
};
