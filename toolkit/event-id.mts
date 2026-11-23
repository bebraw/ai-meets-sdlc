export function validateEventId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  )
    throw new Error("Choose a lowercase event ID of up to 80 characters");
}
