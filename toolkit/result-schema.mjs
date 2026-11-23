// Describes JSON returned through MCP. Other interfaces deliver the same data
// fields and use their own representation for a downloadable artifact.
export function resultSchema(fields, required = []) {
  const properties = {};
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
          : value;
    }
  }
  return { type: "object", properties, required };
}
