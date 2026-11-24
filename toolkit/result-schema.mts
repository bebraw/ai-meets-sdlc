// Describes JSON returned through MCP. Other interfaces deliver the same data
// fields and use their own representation for a downloadable artifact.
import type { JsonSchema, ObjectSchema } from "./contracts.mjs";
export type ResultFields = Record<
  string,
  string | readonly string[] | JsonSchema
>;
export function resultSchema(
  fields: ResultFields,
  required: readonly string[] = [],
): ObjectSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (name === "artifact" && value === "object") {
      properties.artifact = {
        type: "object",
        required: ["uri", "name", "mimeType"],
        properties: {
          uri: { type: "string", format: "uri" },
          name: { type: "string" },
          mimeType: { type: "string" },
        },
      };
    } else {
      properties[name] =
        typeof value === "string" || Array.isArray(value)
          ? { type: value }
          : (value as JsonSchema);
    }
  }
  return { type: "object", properties, required };
}
