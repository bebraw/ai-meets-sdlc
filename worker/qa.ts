import { hasAdminSession } from "./admin-auth.ts";
import {
  formatCsvValue,
  jsonResponse,
  readFormDataWithinLimit,
  sha256Hex,
} from "./form-utils.ts";
import { readJsonWithinLimit, isRecord } from "./speaker-workspace-utils.ts";
import {
  createQaGrant,
  logoutQa,
  qaActor,
  qaParticipant,
  readQaGrants,
  redeemQaGrant,
  revokeQaGrant,
} from "./qa-auth.ts";
import { renderQaAccess, renderQaPage } from "./qa-view.ts";
import type {
  QaCommand,
  QaPageData,
  QaResult,
  QaRoomRecord,
  QaSettings,
  QaView,
} from "./qa-types.ts";

const views: Record<string, QaView> = {
  "/qa/": "attendee",
  "/qa/moderate/": "moderator",
  "/qa/mc/": "mc",
  "/qa/screen/": "screen",
  "/qa/present/": "present",
  "/admin/qa/": "admin",
};
const errorResult = (message: string, status = 400): QaResult => ({
  ok: false,
  changed: false,
  message,
  status,
});
const okResult = (message: string): QaResult => ({
  ok: true,
  changed: true,
  message,
  status: 200,
});
const value = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? body[key] : "";
export const qaHubName = "sdlcai-2026:qa-updates";

export function withQaHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "same-origin");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "Cookie, Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
function redirect(path: string, notice = "", cookie?: string): Response {
  const url = new URL(path, "https://sdlcai.org");
  if (notice) url.searchParams.set("notice", notice);
  const headers = new Headers({ location: `${url.pathname}${url.search}` });
  if (cookie) headers.append("set-cookie", cookie);
  return withQaHeaders(new Response(null, { status: 303, headers }));
}
function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
async function readBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  if (request.headers.get("content-type")?.startsWith("application/json")) {
    const body = await readJsonWithinLimit(request, 12 * 1024);
    return body instanceof Response
      ? body
      : isRecord(body)
        ? body
        : jsonResponse({ error: "Invalid form." }, 400);
  }
  const form = await readFormDataWithinLimit(request, 12 * 1024);
  return form instanceof Response ? form : Object.fromEntries(form);
}
function command(body: Record<string, unknown>): QaCommand {
  return {
    action: value(body, "action"),
    questionId: value(body, "questionId"),
    text: value(body, "text"),
    requestId: value(body, "requestId"),
    revision: Number(body.revision),
    expectedActiveId: value(body, "expectedActiveId"),
    status: value(body, "status"),
    confirmation: value(body, "confirmation"),
  };
}
async function readSettings(env: Env): Promise<QaSettings> {
  const settings = await env.INTERESTS.prepare(
    "SELECT active_room_id, revision FROM qa_settings WHERE id = 1",
  ).first<QaSettings>();
  if (!settings) throw new Error("Missing QA configuration");
  return settings;
}
async function readRooms(env: Env): Promise<QaRoomRecord[]> {
  return (
    await env.INTERESTS.prepare(
      "SELECT id, title, object_name, position FROM qa_rooms ORDER BY position, created_at",
    ).all<QaRoomRecord>()
  ).results;
}
async function readRoom(env: Env, id: string): Promise<QaRoomRecord | null> {
  if (!/^[a-z0-9-]{1,80}$/u.test(id)) return null;
  return env.INTERESTS.prepare(
    "SELECT id, title, object_name, position FROM qa_rooms WHERE id = ?",
  )
    .bind(id)
    .first<QaRoomRecord>();
}
async function pageData(
  request: Request,
  env: Env,
  view: QaView,
  participantId: string,
  notice = "",
  draft = "",
): Promise<QaPageData | Response> {
  const settings = await readSettings(env);
  const url = new URL(request.url);
  const requestedRoom = ["admin", "moderator", "mc"].includes(view)
    ? url.searchParams.get("room")
    : null;
  const room = await readRoom(
    env,
    requestedRoom || settings.active_room_id || "",
  );
  if (requestedRoom && !room) return html("This QA room does not exist.", 404);
  const actor = await qaActor(
    request,
    env,
    room?.object_name ?? "no-room",
    participantId,
  );
  if (
    (view === "admin" && actor.role !== "admin") ||
    (view === "moderator" &&
      actor.role !== "moderator" &&
      actor.role !== "admin") ||
    (view === "mc" && actor.role !== "mc" && actor.role !== "admin")
  ) {
    return redirect(
      "/qa/access/",
      "Use your active moderator or MC access link to continue.",
    );
  }
  const snapshotRole =
    view === "moderator" || view === "admin"
      ? actor.role
      : view === "attendee"
        ? "attendee"
        : "mc";
  const snapshot = room
    ? await env.QA_ROOMS.getByName(room.object_name).snapshot(
        snapshotRole,
        view === "attendee" || view === "moderator" ? actor.participantKey : "",
      )
    : null;
  const rooms =
    view === "admin"
      ? await Promise.all(
          (await readRooms(env)).map(async (item) => ({
            ...item,
            snapshot: await env.QA_ROOMS.getByName(item.object_name).snapshot(
              "mc",
            ),
          })),
        )
      : [];
  const grants = view === "admin" ? await readQaGrants(request, env) : [];
  return {
    view,
    room,
    snapshot,
    settings,
    rooms,
    grants,
    notice: notice || url.searchParams.get("notice") || "",
    draft,
    role: actor.role,
  };
}
async function renderPage(
  request: Request,
  env: Env,
  content: string,
  status = 200,
): Promise<Response> {
  if (request.headers.get("x-qa-fragment") === "1") {
    const response = html(content, status);
    response.headers.set("x-qa-fragment", "1");
    return response;
  }
  const asset = await env.ASSETS.fetch(
    new Request(new URL(new URL(request.url).pathname, request.url), {
      method: "GET",
    }),
  );
  if (!asset.ok) return html("QA page temporarily unavailable.", 503);
  const transformed = new HTMLRewriter()
    .on("[data-qa-content]", {
      element(element) {
        element.setInnerContent(content, { html: true });
      },
    })
    .transform(asset);
  const headers = new Headers(transformed.headers);
  headers.delete("etag");
  headers.delete("content-length");
  return new Response(request.method === "HEAD" ? null : transformed.body, {
    status,
    headers,
  });
}
async function notify(env: Env): Promise<void> {
  // Persistence has already completed. A missed notification must not turn a
  // successful write into a failed POST; reconnect/fallback reads the authority.
  try {
    await env.QA_UPDATES.getByName(qaHubName).notify();
  } catch {
    console.warn("qa_notification_unavailable");
  }
}

export async function handleQaRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    !(
      path === "/qa" ||
      path.startsWith("/qa/") ||
      path.startsWith("/api/qa/") ||
      path === "/api/admin/qa" ||
      path.startsWith("/api/admin/qa/") ||
      path === "/admin/qa" ||
      path === "/admin/qa/"
    )
  )
    return null;
  try {
    return withQaHeaders(await handle(request, env));
  } catch {
    console.error("qa_request_unavailable");
    return withQaHeaders(
      html("QA is temporarily unavailable. Please try again.", 503),
    );
  }
}
async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (views[`${path}/`] || path === "/qa/access") {
    url.pathname += "/";
    return new Response(null, {
      status: 308,
      headers: { location: `${url.pathname}${url.search}` },
    });
  }
  if (!env.EMAIL_ENCRYPTION_KEY || !env.QA_ROOMS || !env.QA_UPDATES)
    return html("QA is not configured.", 503);
  if (path === "/api/qa/events") {
    if (request.method !== "GET") return html("Method not allowed.", 405);
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return html("Request origin was not accepted.", 403);
    return env.QA_UPDATES.getByName(qaHubName).fetch(request);
  }
  if (!["GET", "HEAD", "POST"].includes(request.method))
    return new Response("Method not allowed.", {
      status: 405,
      headers: { allow: "GET, HEAD, POST" },
    });
  if (request.method === "POST" && request.headers.get("origin") !== url.origin)
    return jsonResponse({ error: "Request origin was not accepted." }, 403);
  if (path === "/qa/access/") {
    let notice = url.searchParams.get("notice") || "";
    let status = 200;
    if (request.method === "POST") {
      const body = await readBody(request);
      if (body instanceof Response) return body;
      const ipKey = await sha256Hex(
        request.headers.get("cf-connecting-ip") || "local",
      );
      if (
        await env.QA_ROOMS.getByName("sdlcai-2026:qa-login").throttle(
          ipKey,
          30,
          10 * 60_000,
        )
      )
        return html("Please wait before trying your access link again.", 429);
      const redeemed = await redeemQaGrant(request, env, value(body, "token"));
      if (redeemed)
        return redirect(
          redeemed.role === "mc" ? "/qa/mc/" : "/qa/moderate/",
          "",
          redeemed.cookie,
        );
      notice =
        "This access link is invalid or has been revoked. Ask an admin for a new link.";
      status = 401;
    }
    return renderPage(request, env, renderQaAccess(notice), status);
  }
  if (path === "/qa/logout/") {
    if (request.method !== "POST") return html("Method not allowed.", 405);
    return redirect("/qa/", "Signed out.", await logoutQa(request, env));
  }
  const isAdmin = path === "/admin/qa/" || path.startsWith("/api/admin/qa");
  if (isAdmin && !(await hasAdminSession(request, env)))
    return jsonResponse({ error: "Admin access is required." }, 401);
  const view = isAdmin ? "admin" : views[path];
  if (!view && path !== "/api/qa/snapshot") return html("Not found.", 404);
  const participant = await qaParticipant(request, env);
  const mode = view ?? "attendee";
  const settings = await readSettings(env);
  if (path === "/api/admin/qa/export" || path === "/api/admin/qa/history") {
    if (request.method !== "GET") return html("Method not allowed.", 405);
    const room = await readRoom(
      env,
      url.searchParams.get("room") || settings.active_room_id || "",
    );
    if (!room) return html("Choose a QA room first.", 404);
    const stub = env.QA_ROOMS.getByName(room.object_name);
    if (path.endsWith("history"))
      return jsonResponse({ history: await stub.history() });
    const snapshot = await stub.snapshot("admin");
    const csv = [
      "id,question,status,votes,created_at",
      ...snapshot.questions.map((q) =>
        [q.id, q.text, q.status, String(q.votes), q.createdAt]
          .map(formatCsvValue)
          .join(","),
      ),
    ].join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sdlcai-qa-${room.id}.csv"`,
      },
    });
  }
  if (request.method === "POST") {
    if (mode === "screen" || mode === "present")
      return html("This view is read-only.", 405);
    const body = await readBody(request);
    if (body instanceof Response) return body;
    let result: QaResult;
    const action = value(body, "action");
    if (
      mode === "admin" &&
      ["create-room", "active-room", "create-grant", "revoke-grant"].includes(
        action,
      )
    ) {
      result = await adminAction(request, env, body);
    } else {
      const room = await readRoom(env, value(body, "roomId"));
      if (!room) result = errorResult("This QA room does not exist.", 404);
      else if (mode === "attendee" && room.id !== settings.active_room_id)
        result = errorResult(
          "The active session changed. Your draft is preserved; review the new session before submitting it.",
          409,
        );
      else {
        const actor = await qaActor(
          request,
          env,
          room.object_name,
          participant.id,
        );
        const allowed =
          mode === "attendee"
            ? ["add", "vote"]
            : mode === "mc"
              ? ["select", "done"]
              : mode === "moderator"
                ? ["add", "approve", "hide", "edit", "status"]
                : [
                    "add",
                    "approve",
                    "hide",
                    "edit",
                    "status",
                    "select",
                    "done",
                    "reset",
                  ];
        if (
          (mode === "moderator" &&
            actor.role !== "moderator" &&
            actor.role !== "admin") ||
          (mode === "mc" && actor.role !== "mc" && actor.role !== "admin")
        )
          result = errorResult(
            "Your QA access has ended. Use an active access link to sign in.",
            403,
          );
        else if (!allowed.includes(action))
          result = errorResult(
            "This action is not available in this view.",
            403,
          );
        else
          result = await env.QA_ROOMS.getByName(room.object_name).command(
            { ...actor, role: mode === "attendee" ? "attendee" : actor.role },
            command(body),
            await sha256Hex(request.headers.get("cf-connecting-ip") || "local"),
          );
      }
    }
    if (result.changed) await notify(env);
    if (
      request.headers.get("accept")?.includes("application/json") ||
      path.startsWith("/api/")
    ) {
      const response = jsonResponse(
        { ...result, error: result.ok ? undefined : result.message },
        result.status,
      );
      if (participant.cookie)
        response.headers.append("set-cookie", participant.cookie);
      return response;
    }
    if (result.ok)
      return redirect(
        `${path}${url.search}`,
        result.message,
        participant.cookie,
      );
    const data = await pageData(
      request,
      env,
      mode,
      participant.id,
      result.message,
      action === "add" ? value(body, "text") : "",
    );
    const response =
      data instanceof Response
        ? data
        : await renderPage(request, env, renderQaPage(data), result.status);
    if (participant.cookie)
      response.headers.append("set-cookie", participant.cookie);
    return response;
  }
  const data = await pageData(request, env, mode, participant.id);
  if (data instanceof Response) return data;
  const response = path.startsWith("/api/")
    ? jsonResponse({ ...data })
    : await renderPage(request, env, renderQaPage(data));
  if (participant.cookie && !["screen", "present"].includes(mode))
    response.headers.append("set-cookie", participant.cookie);
  return response;
}
async function adminAction(
  request: Request,
  env: Env,
  body: Record<string, unknown>,
): Promise<QaResult> {
  const action = value(body, "action");
  if (action === "active-room") {
    const id = value(body, "roomId");
    if (id && !(await readRoom(env, id)))
      return errorResult("Choose an existing QA room.");
    const result = await env.INTERESTS.prepare(
      "UPDATE qa_settings SET active_room_id = ?, revision = revision + 1 WHERE id = 1 AND revision = ?",
    )
      .bind(id || null, Number(body.settingsRevision))
      .run();
    return result.meta.changes
      ? okResult(id ? "Active session updated." : "Audience questions closed.")
      : errorResult(
          "The active session changed elsewhere. Reload before selecting it.",
          409,
        );
  }
  if (action === "create-room") {
    const title = value(body, "title").trim().normalize("NFC");
    if (!title || title.length > 120)
      return errorResult("Use a room title of 1 to 120 characters.");
    const id = crypto.randomUUID();
    const result = await env.INTERESTS.prepare(
      "INSERT INTO qa_rooms (id, title, object_name, position, created_at) SELECT ?, ?, ?, COALESCE(MAX(position), -1) + 1, ? FROM qa_rooms HAVING COUNT(*) < 64",
    )
      .bind(id, title, `sdlcai-2026:${id}`, new Date().toISOString())
      .run();
    return result.meta.changes
      ? okResult("Room created and paused.")
      : errorResult("You can create up to 64 rooms.");
  }
  if (action === "create-grant") {
    const label = value(body, "label").trim().normalize("NFC");
    const role = value(body, "role");
    if (!label || label.length > 120 || (role !== "moderator" && role !== "mc"))
      return errorResult("Enter a name and choose moderator or MC.");
    if (
      (await readQaGrants(request, env)).filter((grant) => !grant.revoked_at)
        .length >= 50
    )
      return errorResult(
        "Revoke an unused access link before creating another.",
      );
    await createQaGrant(env, label, role);
    return okResult("Reusable access link created.");
  }
  if (action === "revoke-grant") {
    await revokeQaGrant(env, value(body, "grantId"));
    return okResult("Access link and its sessions revoked.");
  }
  return errorResult("Unknown admin action.");
}
