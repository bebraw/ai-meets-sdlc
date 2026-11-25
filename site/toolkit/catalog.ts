import { readFileSync } from "node:fs";
import { marked, type Tokens } from "marked";
import { createToolkit, roles, type Role } from "@sdlcai/event-toolkit";
import { engagementGuides } from "./engagement.ts";
import { programmeGuides } from "./programme.ts";
import { venueGuides } from "./venue.ts";

const roleNames: Record<Role, string> = {
  organizer: "Organizer",
  public: "Public visitor",
  staff: "Desk staff",
  speaker: "Speaker",
  moderator: "Moderator",
  mc: "MC",
  attendee: "Attendee",
};

interface CatalogOperation {
  description: string;
  roles: string[];
}

async function getOperations() {
  const kit = createToolkit();
  const blocks = new Map<string, Map<string, CatalogOperation>>();
  try {
    for (const role of roles) {
      for (const block of kit.catalog({ role, actor: "catalog" })) {
        const operations =
          blocks.get(block.id) ?? new Map<string, CatalogOperation>();
        blocks.set(block.id, operations);
        for (const { name, description } of block.operations) {
          const entry = operations.get(name) ?? { description, roles: [] };
          entry.roles.push(roleNames[role]);
          operations.set(name, entry);
        }
      }
    }
    return blocks;
  } finally {
    await kit.close();
  }
}

export async function getToolkitCatalog() {
  const guides = { ...venueGuides, ...programmeGuides, ...engagementGuides };
  const operations = await getOperations();
  const markdown = readFileSync(
    new URL("../../toolkit/GUIDE.md", import.meta.url),
    "utf8",
  );
  const groups = [];
  let group = "";
  for (const token of marked.lexer(markdown)) {
    if (token.type === "heading" && token.depth === 2) group = token.text;
    if (token.type !== "table") continue;
    const blocks = (token as Tokens.Table).rows.map((row) => {
      const [name, id, description] = row.map((cell) =>
        cell.text.replace(/^`|`$/g, ""),
      );
      const guide = id && guides[id];
      const entries = id ? operations.get(id) : undefined;
      if (!name || !id || !description || !guide || !entries?.size)
        throw new Error("Missing toolkit block guide or operations for " + id);
      const href = "/toolkit/" + id + "/";
      return {
        ...guide,
        group,
        name,
        id,
        description,
        href,
        url: "https://sdlcai.org" + href,
        title: name + " | Event organizer toolkit | SDLCAI",
        enableCommand: "export TOOLKIT_BLOCKS=" + id,
        operationLabel:
          entries.size + (entries.size === 1 ? " operation" : " operations"),
        operations: Array.from(entries, ([name, entry]) => ({
          name,
          description: entry.description,
          roles: entry.roles.join(", "),
        })),
      };
    });
    const id = group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    groups.push({ title: group, id, href: "#" + id, blocks });
  }
  const items = groups.flatMap((group) => group.blocks);
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of [...operations.keys(), ...Object.keys(guides)]) {
    if (!byId.has(id))
      throw new Error("Missing toolkit catalog entry for " + id);
  }
  return {
    groups,
    items: items.map(({ id }) => ({ id })),
    block(id: string) {
      const block = byId.get(id);
      if (!block) throw new Error("Unknown toolkit block " + id);
      return {
        ...block,
        related: block.related.map((relatedId) => {
          const related = byId.get(relatedId);
          if (!related)
            throw new Error("Unknown related toolkit block " + relatedId);
          return {
            name: related.name,
            href: related.href,
            description: related.description,
          };
        }),
      };
    },
  };
}
