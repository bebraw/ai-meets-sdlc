import * as v from "valibot";
import type { OverrideSchemaContext } from "@valibot/to-json-schema";

// Valibot accepts arrays as objects. The toolkit's wire format distinguishes
// arrays from records, including when a record has no required properties.
const plainObject = v.custom((value) => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return true;
  // A host may call the package with JSON parsed in a separate JS realm.
  const constructor = Object.getOwnPropertyDescriptor(
    prototype,
    "constructor",
  )?.value;
  return (
    Object.getPrototypeOf(prototype) === null &&
    typeof constructor === "function" &&
    Function.prototype.toString.call(constructor) ===
      Function.prototype.toString.call(Object)
  );
}, "Expected a JSON object.");

// Only the shaped schema contributes fields to the intersection's output.
// This preserves defaults and excludes fields discarded by the shaped schema.
const objectGuard = v.pipe(
  plainObject,
  v.transform(() => ({})),
);
type Guarded<S extends v.GenericSchema> = v.GenericSchema<
  v.InferInput<S>,
  v.InferOutput<S>
>;
type ObjectShape<Entries extends v.ObjectEntries> = v.StrictObjectSchema<
  Entries,
  undefined
>;
type PartialShape<Entries extends v.ObjectEntries> = ReturnType<
  typeof v.partial<ObjectShape<Entries>>
>;

export function jsonObject<S extends v.GenericSchema>(shape: S): Guarded<S> {
  return v.intersect([objectGuard, shape]);
}

export function strictJsonObject<const Entries extends v.ObjectEntries>(
  entries: Entries,
): Guarded<ObjectShape<Entries>> {
  return jsonObject(v.strictObject(entries));
}

export function partialJsonObject<const Entries extends v.ObjectEntries>(
  entries: Entries,
): Guarded<PartialShape<Entries>> {
  return jsonObject(v.partial(v.strictObject(entries)));
}

// JSON Schema already enforces this guard with type: object.
export function jsonObjectContract({
  valibotSchema,
  jsonSchema,
}: OverrideSchemaContext) {
  if (valibotSchema === plainObject) return { type: "object" } as const;
  if (
    valibotSchema.type === "intersect" &&
    "options" in valibotSchema &&
    Array.isArray(valibotSchema.options) &&
    valibotSchema.options[0] === objectGuard
  ) {
    const shape = jsonSchema.allOf?.[1];
    if (typeof shape === "object") return shape;
  }
}
