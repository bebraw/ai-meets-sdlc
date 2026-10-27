import { eventPath } from "../shared/event-paths.ts";
import { adminWorkspaceGroups } from "../site/admin-workspaces.ts";
import { escapeHtml } from "./speaker-workspace-utils.ts";
import {
  eventRouteAvailable,
  scopeUrl,
  type EventWorkspace,
} from "./event-workspaces.ts";

export async function eventResponse(
  response: Response,
  request: Request,
  events: EventWorkspace[],
  event: EventWorkspace | null,
  scoped: boolean,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const headers = new Headers(response.headers);
  headers.set("x-sdlcai-scope", event ? `event:${event.id}` : "shared");
  const location = headers.get("location");
  if (location && scoped && event) {
    const target = new URL(location, origin);
    // Login remains shared, but must return to the explicitly requested event.
    if (target.origin === origin) {
      if (
        target.pathname === "/admin/login/" &&
        target.searchParams.has("next")
      )
        target.searchParams.set(
          "next",
          scopeUrl(target.searchParams.get("next")!, event, origin),
        );
      else target.pathname = eventPath(target.pathname, event.id);
    }
    headers.set("location", target.href);
  }
  if (scoped && event && event.id !== "2026") {
    const cookies = headers.getSetCookie();
    headers.delete("set-cookie");
    for (const cookie of cookies)
      headers.append("set-cookie", scopeCookie(cookie, event.id));
  }
  let result = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  if (request.method === "HEAD") return result;
  const type = headers.get("content-type") ?? "";
  // 2026's stable URLs and signed render-manifest paths remain canonical.
  if (
    scoped &&
    event &&
    event.id !== "2026" &&
    type.includes("application/json") &&
    response.ok
  ) {
    const map = (value: unknown, key = ""): unknown => {
      if (typeof value === "string")
        return /(?:^|_)(?:url|link|href|src|path)$|(?:Url|Path)$/u.test(key)
          ? scopeUrl(value, event, origin)
          : value;
      if (Array.isArray(value)) return value.map((item) => map(item, key));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, map(item, key)]),
        );
      return value;
    };
    // Existing API responses are bounded by their handlers; streams and downloads
    // pass through untouched, including Q&A event streams and private media.
    result = new Response(JSON.stringify(map(await result.json())), {
      status: result.status,
      headers,
    });
    result.headers.delete("content-length");
  }
  if (
    !type.includes("text/html") ||
    headers.has("content-disposition") ||
    new URL(request.url).pathname
      .replace(/^\/events\/[^/]+/u, "")
      .startsWith("/api/")
  )
    return result;
  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        if (event) {
          el.setAttribute("data-event-id", event.id);
          el.setAttribute("data-event-label", event.label);
          el.setAttribute("data-event-scoped", scoped ? "true" : "false");
        }
      },
    })
    .on("[data-admin-scope-label]", {
      element(el) {
        el.setInnerContent(event?.label ?? "Shared SDLCAI");
      },
    })
    .on("[data-admin-desk-label]", {
      element(el) {
        el.setInnerContent(event ? "Event workspace" : "Administration");
      },
    })
    .on("[data-admin-event-controls]", {
      element(el) {
        el.setInnerContent(
          `<label class="grid gap-1 text-xs font-bold uppercase">Event workspace<select aria-label="Event workspace" data-admin-event-selector class="min-h-11 max-w-full border border-paper/50 bg-ink px-3 py-2 text-paper"><option value="/admin/"${event ? "" : " selected"}>Shared administration</option>${events.map((item) => `<option value="/events/${item.id}/admin/"${event?.id === item.id ? " selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}</select></label>`,
          { html: true },
        );
      },
    })
    .on("[data-admin-events]", {
      element(el) {
        el.setInnerContent(
          events
            .map(
              (item) =>
                `<li><a class="block border border-ink p-6 font-headline text-3xl font-black uppercase hover:bg-ink hover:text-paper" href="/events/${item.id}/admin/">${escapeHtml(item.label)} <span aria-hidden="true">→</span></a></li>`,
            )
            .join(""),
          { html: true },
        );
      },
    })
    .on("[data-event-navigation]", {
      element(el) {
        if (!event) el.remove();
      },
    });
  if (event) {
    rewriter.on("[data-admin-workspace-group], [data-admin-navigation-group]", {
      element(el) {
        const id =
          el.getAttribute("data-admin-workspace-group") ??
          el.getAttribute("data-admin-navigation-group");
        const group = adminWorkspaceGroups.find((item) => item.id === id);
        if (
          group &&
          !group.items.some((item) =>
            eventRouteAvailable(new URL(item.href, origin).pathname, event),
          )
        )
          el.remove();
      },
    });
    rewriter.on(
      scoped ? "a[href], form[action]" : "[data-admin-navigation] a[href]",
      {
        element(el) {
          const attr = el.tagName === "form" ? "action" : "href";
          if (el.hasAttribute("data-shared-admin-link")) return;
          const value = el.getAttribute(attr);
          if (!value) return;
          const path = new URL(value, origin).pathname;
          if (!eventRouteAvailable(path, event)) {
            el.remove();
            return;
          }
          el.setAttribute(attr, scopeUrl(value, event, origin));
        },
      },
    );
  }
  return rewriter.transform(result);
}

const eventCookies = new Set([
  "__Host-sdlcai-speaker-session",
  "sdlcai-registration-staff",
  "sdlcai-qa-staff",
  "sdlcai-qa-attendee",
]);
function scopeCookie(value: string, id: string): string {
  const separator = value.indexOf("=");
  const name = value.slice(0, separator);
  return eventCookies.has(name)
    ? `${name}-${id}${value.slice(separator)}`
    : value;
}
export function eventRequest(request: Request, url: URL, id: string): Request {
  const headers = new Headers(request.headers);
  if (id !== "2026") {
    const cookies = (headers.get("cookie") ?? "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
    const mapped = cookies
      .filter((item) => !eventCookies.has(item.split("=", 1)[0]!))
      .map((item) => {
        const separator = item.indexOf("=");
        const name = item.slice(0, separator);
        return name.endsWith(`-${id}`) &&
          eventCookies.has(name.slice(0, -(id.length + 1)))
          ? `${name.slice(0, -(id.length + 1))}${item.slice(separator)}`
          : item;
      });
    headers.set("cookie", mapped.join("; "));
  }
  return new Request(url, new Request(request, { headers }));
}
