import * as v from "valibot";

export const text = (max: number, min = 1) =>
  v.pipe(v.string(), v.minCodePoints(min), v.maxCodePoints(max));
export const boundedNumber = (min: number, max: number) =>
  v.pipe(v.number(), v.minValue(min), v.maxValue(max));
export const integer = (min: number, max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(max));
export const list = <T extends v.GenericSchema>(
  item: T,
  max: number,
  min = 0,
) => v.pipe(v.array(item), v.minLength(min), v.maxLength(max));
export const color = v.pipe(v.string(), v.regex(/^#[a-fA-F0-9]{6}$/));
