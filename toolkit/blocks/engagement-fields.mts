import { strictJsonObject, jsonObject } from "../json-object.mjs";
import * as v from "valibot";

export const object = strictJsonObject;
export const text = (max = 200, min = 1) =>
  v.pipe(v.string(), v.minCodePoints(min), v.maxCodePoints(max));
export const number = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
export const choice = <const T extends readonly [string, ...string[]]>(
  ...values: T
) => v.picklist(values);
export const list = <S extends v.GenericSchema>(
  item: S,
  max: number,
  min = 0,
) => v.pipe(v.array(item), v.minLength(min), v.maxLength(max));
export const key = v.pipe(text(80), v.regex(/^[a-zA-Z0-9_-]+$/));
export const revision = number(0, Number.MAX_SAFE_INTEGER - 1);
export const email = v.pipe(text(254), v.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));

export const surveyQuestions = list(
  object({
    id: key,
    label: text(300),
    kind: choice("rating", "recommendation", "choice", "text"),
    options: v.optional(list(text(150), 30, 2)),
    required: v.optional(v.boolean()),
  }),
  40,
  1,
);

export const answersSchema = v.pipe(
  jsonObject(v.record(v.string(), v.union([text(2000, 0), number(0, 10)]))),
  v.minEntries(1),
  v.maxEntries(40),
);

export const channels = choice("linkedin", "website", "newsletter");
export const statuses = choice(
  "draft",
  "review",
  "ready",
  "scheduled",
  "published",
);
const editorialEntries = {
  title: text(300),
  body: text(20000),
  channel: channels,
  status: statuses,
  sources: list(object({ label: text(), url: text(2048) }), 30),
  assets: list(
    object({
      url: text(2048),
      alt: text(1000),
      format: choice("portrait", "landscape", "document"),
    }),
    30,
  ),
  notes: v.optional(text(4000, 0)),
  publicationDate: v.optional(
    v.pipe(v.string(), v.regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)),
  ),
  publicationUrl: v.optional(text(2048)),
};
export const editorialDetails = object(editorialEntries);
export const editorialInput = object({
  id: key,
  revision,
  ...editorialEntries,
});
