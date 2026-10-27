import { eventPath, parseEventPath } from "../../shared/event-paths.ts";

export const eventId = (): string =>
  document.documentElement.dataset.eventId ??
  parseEventPath(location.pathname)?.id ??
  "2026";
export const eventLabel = (): string =>
  document.documentElement.dataset.eventLabel ?? "SDLCAI 2026";
export const eventLocalPath = (): string =>
  parseEventPath(location.pathname)?.path ?? location.pathname;
export const eventStorageKey = (name: string): string =>
  `sdlcai-${eventId()}-${name}`;

export function eventUrl(value: string | URL): string {
  const url = new URL(value, location.href);
  const relative =
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//");
  const result = () =>
    relative ? `${url.pathname}${url.search}${url.hash}` : url.href;
  if (
    url.origin !== location.origin ||
    (!parseEventPath(location.pathname) &&
      document.documentElement.dataset.eventScoped !== "true")
  )
    return result();
  url.pathname = eventPath(url.pathname, eventId());
  return result();
}

/** Explicit transport for edition tools; no global fetch or selection state. */
export function eventFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  // Shared export helpers also run in Node and in static preview harnesses.
  if (
    typeof document === "undefined" ||
    typeof location === "undefined" ||
    !location.href
  )
    return globalThis.fetch(input, init);
  return input instanceof Request
    ? globalThis.fetch(new Request(eventUrl(input.url), input), init)
    : globalThis.fetch(eventUrl(input), init);
}
