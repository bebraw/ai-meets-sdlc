import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "parse5";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateProgramme } from "../toolkit/blocks/programme-validation.mts";

export function elements(node) {
  return [node, ...(node.childNodes ?? []).flatMap(elements)];
}
export function attr(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}
export function textContent(node) {
  return (
    node.nodeName === "#text"
      ? node.value
      : (node.childNodes ?? []).map(textContent).join(" ")
  )
    .replace(/\s+/g, " ")
    .trim();
}
export async function validateFeed(feed, schema, directory) {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  if (!ajv.validate(schema, feed)) throw new Error(ajv.errorsText());
  validateProgramme(feed);
  for (const item of [
    feed.event,
    ...feed.sessions,
    ...feed.speakers,
    ...feed.actions,
  ]) {
    if (!item.url) continue;
    const url = new URL(item.url);
    if (!["sdlcai.org", "www.sdlcai.org"].includes(url.hostname)) continue;
    const filename = path.resolve(
      directory,
      `.${url.pathname}`,
      url.pathname.endsWith("/") ? "index.html" : "",
    );
    if (!filename.startsWith(path.resolve(directory) + path.sep))
      throw new Error("Invalid site path");
    const html = await readFile(filename, "utf8");
    if (
      url.hash &&
      !elements(parse(html)).some(
        (node) => attr(node, "id") === decodeURIComponent(url.hash.slice(1)),
      )
    ) {
      throw new Error(`Missing fragment: ${item.url}`);
    }
  }
}
