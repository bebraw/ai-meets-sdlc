import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import {
  scheduleSessions,
  scheduleSlideIds,
  type ScheduleOrder,
} from "./schedule-order.ts";

type Node = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

// The input is our own generated HTML. Moving existing subtrees preserves the
// shared templates, stable talk anchors, and canonical-content markers.
export async function applyScheduleToResponse(
  response: Response,
  order: ScheduleOrder,
): Promise<Response> {
  const document = parse(await response.text());
  const elements = walk(document);
  const byTalk = new Map(
    order.groups.flatMap((group) =>
      group.talkIds.map((id) => [id, group.id] as const),
    ),
  );
  const sessions = new Map(
    scheduleSessions.map((session) => [session.id, session]),
  );

  for (const kind of ["web", "screen", "cards"]) {
    const containers = elements.filter(
      (node) => attr(node, "data-schedule-kind") === kind,
    );
    const fragments = new Map<string, HtmlElement>();
    for (const container of containers) {
      for (const node of walk(container)) {
        const id = attr(node, "data-schedule-talk");
        if (id) fragments.set(id, node);
      }
    }
    for (const container of containers) {
      const group = order.groups.find(
        (item) => item.id === attr(container, "data-schedule-group"),
      );
      if (!group) continue;
      const children = group.talkIds.map((id) => {
        const node = fragments.get(id);
        if (!node) throw new Error(`Missing schedule HTML for ${id}`);
        return node;
      });
      container.childNodes = children;
      children.forEach((child) => {
        child.parentNode = container;
      });
    }
  }

  const slides = new Map(
    elements
      .filter((node) => attr(node, "data-runtime-slide"))
      .map((node) => [attr(node, "data-runtime-slide")!, node]),
  );
  if (slides.size) {
    const ordered = scheduleSlideIds(order).map((id) => {
      const slide = slides.get(id);
      if (!slide) throw new Error(`Missing slide ${id}`);
      return slide;
    });
    const parent = ordered[0]?.parentNode;
    if (parent && "childNodes" in parent) {
      parent.childNodes = ordered;
      for (const [index, slide] of ordered.entries()) {
        slide.parentNode = parent;
        setAttr(slide, "data-slide-number", String(index + 1));
        const talkId = attr(slide, "data-runtime-slide")?.replace(/^talk-/, "");
        const session = sessions.get(byTalk.get(talkId ?? "") ?? "");
        const originalSession = scheduleSessions.find((item) =>
          item.talks?.some((talk) => talk.id === talkId),
        );
        const updateLabel = (value: string) => {
          const numbered = value.replace(/slide \d+/i, `slide ${index + 1}`);
          return session && originalSession
            ? numbered.replace(originalSession.time, session.time)
            : numbered;
        };
        for (const child of walk(slide)) {
          for (const attribute of ["alt", "aria-label"]) {
            const value = attr(child, attribute);
            if (value && /slide \d+/i.test(value))
              setAttr(child, attribute, updateLabel(value));
          }
          if (attr(child, "data-runtime-slide-alt") !== undefined)
            text(
              child,
              updateLabel(
                child.childNodes
                  .map((node) => ("value" in node ? node.value : ""))
                  .join(""),
              ),
            );
          if (attr(child, "data-runtime-slide-number") !== undefined)
            text(child, String(index + 1).padStart(2, "0"));
          if (
            session &&
            (hasClass(child, "presentation-kicker") ||
              attr(child, "data-runtime-slide-time") !== undefined)
          ) {
            text(
              child,
              hasClass(child, "presentation-kicker")
                ? session.title
                : session.time,
            );
          }
        }
      }
    }
  }
  for (const element of elements) {
    const labelId = attr(element, "data-talk-session-label");
    if (labelId) {
      const session = sessions.get(byTalk.get(labelId) ?? "");
      if (session) text(element, session.title);
    }
    const linkId = attr(element, "data-talk-schedule-link");
    if (linkId) setAttr(element, "href", `/schedule/#${linkId}`);
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("cache-control", "no-store");
  headers.set("x-sdlcai-schedule-version", String(order.revision));
  return new Response(serialize(document), {
    status: response.status,
    headers,
  });
}

function walk(node: Node): HtmlElement[] {
  const children = "childNodes" in node ? node.childNodes.flatMap(walk) : [];
  return "tagName" in node ? [node, ...children] : children;
}
function attr(node: HtmlElement, name: string): string | undefined {
  return node.attrs.find((item) => item.name === name)?.value;
}
function setAttr(node: HtmlElement, name: string, value: string): void {
  const existing = node.attrs.find((item) => item.name === name);
  if (existing) existing.value = value;
  else node.attrs.push({ name, value });
}
function hasClass(node: HtmlElement, name: string): boolean {
  return (attr(node, "class") ?? "").split(/\s+/).includes(name);
}
function text(node: HtmlElement, value: string): void {
  node.childNodes = [{ nodeName: "#text", value, parentNode: node }];
}
