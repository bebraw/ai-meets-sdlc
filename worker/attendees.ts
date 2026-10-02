import { withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  decryptText,
  encryptText,
  jsonResponse,
  requireAdminAction,
} from "./form-utils.ts";
import { isRecord, readJsonWithinLimit } from "./speaker-workspace-utils.ts";
import {
  mergeAttendeeImport,
  attendeeSourceKey,
  parseAttendeeInput,
  parseAttendeeRoster,
  type AttendeeList,
  type AttendeeRecord,
} from "../site/scripts/attendee-model.ts";
import {
  createRegistrationGrant,
  logoutRegistration,
  readRegistrationGrants,
  redeemRegistrationGrant,
  registrationActor,
  revokeRegistrationGrant,
  type RegistrationActor,
} from "./registration-auth.ts";

export async function readAttendeeRoster(
  env: Env,
): Promise<{ revision: number; people: AttendeeRecord[] }> {
  const row = await env.INTERESTS.prepare(
    "SELECT revision, ciphertext, iv FROM attendee_roster WHERE id = 1",
  ).first<{ revision: number; ciphertext: string | null; iv: string | null }>();
  if (!row) throw new Error("Missing attendee migration");
  return {
    revision: row.revision,
    people:
      row.ciphertext && row.iv
        ? parseAttendeeRoster(
            JSON.parse(
              await decryptText(
                row.ciphertext,
                row.iv,
                env.EMAIL_ENCRYPTION_KEY!,
              ),
            ),
          )
        : [],
  };
}
async function readList(
  env: Env,
  actor: RegistrationActor,
): Promise<AttendeeList> {
  const [roster, arrivals] = await Promise.all([
    readAttendeeRoster(env),
    env.INTERESTS.prepare(
      `SELECT a.attendee_id, a.arrived_at, a.revision,
      COALESCE(g.label, a.arrived_by) AS actor FROM attendee_arrivals a
      LEFT JOIN registration_access_grants g ON a.arrived_by = 'grant:' || g.id`,
    ).all<{
      attendee_id: string;
      arrived_at: string | null;
      revision: number;
      actor: string | null;
    }>(),
  ]);
  const byId = new Map(arrivals.results.map((row) => [row.attendee_id, row]));
  return {
    revision: roster.revision,
    role: actor.role,
    attendees: roster.people.map((person) => {
      const arrival = byId.get(person.id);
      return {
        ...person,
        arrivedAt: arrival?.arrived_at ?? null,
        arrivedBy: arrival?.arrived_at ? arrival.actor : null,
        arrivalRevision: arrival?.revision ?? 0,
      };
    }),
  };
}
async function saveRoster(
  env: Env,
  people: AttendeeRecord[],
  revision: number,
): Promise<Response> {
  const text = JSON.stringify(parseAttendeeRoster(people));
  if (new TextEncoder().encode(text).byteLength > 1200 * 1024)
    return jsonResponse({ error: "Attendee list is too large." }, 413);
  const encrypted = await encryptText(text, env.EMAIL_ENCRYPTION_KEY!);
  const result = await env.INTERESTS.prepare(
    "UPDATE attendee_roster SET ciphertext = ?, iv = ?, updated_at = ?, revision = revision + 1 WHERE id = 1 AND revision = ?",
  )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
      revision,
    )
    .run();
  return result.meta.changes
    ? jsonResponse({ revision: revision + 1 })
    : jsonResponse(
        { error: "The attendee list changed. Reload before saving again." },
        409,
      );
}
export async function handleAttendeesRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const admin =
    path === "/api/admin/attendees" || path === "/api/admin/attendees/access";
  const staff =
    path === "/api/registration/attendees" ||
    path === "/api/registration/arrival";
  const session = path === "/api/registration/session";
  const page = path === "/registration/" || path === "/registration/access/";
  if (
    !admin &&
    !staff &&
    !session &&
    !page &&
    path !== "/registration" &&
    path !== "/registration/access"
  )
    return null;
  try {
    if (!env.EMAIL_ENCRYPTION_KEY)
      throw new Error("Missing encryption configuration");
    return withAdminSecurityHeaders(await handle(request, env, path, admin));
  } catch {
    return withAdminSecurityHeaders(
      jsonResponse(
        {
          error:
            "Registration storage is unavailable. No arrival has been confirmed; reload before trying again.",
        },
        503,
      ),
    );
  }
}
async function handle(
  request: Request,
  env: Env,
  path: string,
  admin: boolean,
): Promise<Response> {
  if (path === "/registration" || path === "/registration/access")
    return Response.redirect(new URL(`${path}/`, request.url).href, 308);
  const mutation = !["GET", "HEAD"].includes(request.method);
  if (mutation) {
    const forbidden = requireAdminAction(request, "manage-attendees");
    if (forbidden) return forbidden;
  }
  if (path === "/api/registration/session") {
    if (!["POST", "DELETE"].includes(request.method))
      return jsonResponse({ error: "Method not allowed." }, 405);
    if (request.method === "DELETE")
      return jsonResponse({ ok: true }, 200, {
        "set-cookie": await logoutRegistration(request, env),
      });
    const body = await readJsonWithinLimit(request, 4096);
    if (body instanceof Response) return body;
    const cookie =
      isRecord(body) && typeof body.token === "string"
        ? await redeemRegistrationGrant(request, env, body.token)
        : null;
    return cookie
      ? jsonResponse({ ok: true }, 200, { "set-cookie": cookie })
      : jsonResponse(
          {
            error:
              "This access link is invalid or has been revoked. Ask an organizer for a new link.",
          },
          401,
        );
  }
  if (path === "/registration/access/") {
    if (!["GET", "HEAD"].includes(request.method))
      return jsonResponse({ error: "Method not allowed." }, 405);
    return env.ASSETS.fetch(request);
  }
  const actor = await registrationActor(request, env);
  if (!actor || (admin && actor.role !== "admin")) {
    if (path === "/registration/" && ["GET", "HEAD"].includes(request.method))
      return Response.redirect(
        new URL("/registration/access/", request.url).href,
        303,
      );
    return jsonResponse(
      {
        error:
          "Registration access is required. Open your staff access link to sign in.",
      },
      401,
    );
  }
  if (path === "/registration/") {
    if (!["GET", "HEAD"].includes(request.method))
      return jsonResponse({ error: "Method not allowed." }, 405);
    return env.ASSETS.fetch(request);
  }
  if (path.endsWith("/access")) {
    if (request.method === "GET")
      return jsonResponse({
        grants: await readRegistrationGrants(request, env),
      });
    if (request.method !== "POST")
      return jsonResponse({ error: "Method not allowed." }, 405);
    const body = await readJsonWithinLimit(request, 4096);
    if (body instanceof Response) return body;
    if (!isRecord(body))
      return jsonResponse({ error: "Invalid access request." }, 400);
    if (
      body.action === "create" &&
      typeof body.label === "string" &&
      body.label.trim().length > 0 &&
      body.label.trim().length <= 100
    ) {
      await createRegistrationGrant(env, body.label.trim());
    } else if (
      body.action === "revoke" &&
      typeof body.id === "string" &&
      /^[0-9a-f-]{36}$/u.test(body.id)
    ) {
      await revokeRegistrationGrant(env, body.id);
    } else
      return jsonResponse(
        { error: "Provide a staff name or a valid access link." },
        400,
      );
    return jsonResponse({ grants: await readRegistrationGrants(request, env) });
  }
  if (request.method === "GET" && path !== "/api/registration/arrival")
    return jsonResponse({ ...(await readList(env, actor)) });
  if (path === "/api/registration/arrival")
    return markArrival(request, env, actor);
  if (!admin || !["POST", "PUT"].includes(request.method))
    return jsonResponse({ error: "Method not allowed." }, 405);
  const body = await readJsonWithinLimit(request, 1800 * 1024);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0
  )
    return jsonResponse({ error: "Reload the attendee list." }, 400);
  const roster = await readAttendeeRoster(env);
  if (roster.revision !== body.revision)
    return jsonResponse(
      { error: "The attendee list changed. Reload before saving again." },
      409,
    );
  let people;
  try {
    if (
      request.method === "POST" &&
      (body.source === "tito" || body.source === "webropol") &&
      Array.isArray(body.attendees)
    ) {
      people = mergeAttendeeImport(
        roster.people,
        body.source,
        body.attendees.map(parseAttendeeInput),
      );
    } else if (request.method === "PUT" && typeof body.id === "string") {
      const index = roster.people.findIndex((p) => p.id === body.id);
      if (index < 0) return jsonResponse({ error: "Attendee not found." }, 404);
      people = roster.people;
      const attendee = parseAttendeeInput(body.attendee);
      people[index] = {
        ...people[index]!,
        ...attendee,
        sourceKey: attendeeSourceKey(attendee),
      };
      people = parseAttendeeRoster(people);
    } else
      return jsonResponse(
        { error: "Choose Tito or Webropol and import attendee rows." },
        400,
      );
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error && error.name !== "ValiError"
            ? error.message
            : "Invalid attendee details. Maximum 2,000 attendees.",
      },
      400,
    );
  }
  return saveRoster(env, people, roster.revision);
}
async function markArrival(
  request: Request,
  env: Env,
  actor: RegistrationActor,
): Promise<Response> {
  if (request.method !== "POST")
    return jsonResponse({ error: "Method not allowed." }, 405);
  const body = await readJsonWithinLimit(request, 4096);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    typeof body.id !== "string" ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0 ||
    !Number.isSafeInteger(body.rosterRevision) ||
    Number(body.rosterRevision) < 0 ||
    (body.action !== "arrived" && body.action !== "undo")
  )
    return jsonResponse(
      { error: "Reload the attendee before marking an arrival." },
      400,
    );
  if (body.action === "undo" && actor.role !== "admin")
    return jsonResponse({ error: "Only organizers can undo an arrival." }, 403);
  const roster = await readAttendeeRoster(env);
  if (roster.revision !== body.rosterRevision)
    return jsonResponse(
      {
        error:
          "The registration list changed. Reload and verify the ticket again before confirming arrival.",
      },
      409,
    );
  const person = roster.people.find((p) => p.id === body.id);
  if (!person) return jsonResponse({ error: "Attendee not found." }, 404);
  if (body.action === "arrived" && person.status !== "active")
    return jsonResponse(
      {
        error: "This registration is cancelled. Ask an organizer to verify it.",
      },
      409,
    );
  const now = new Date().toISOString();
  const result = await env.INTERESTS.prepare(
    `INSERT INTO attendee_arrivals (attendee_id, arrived_at, arrived_by, revision)
    SELECT ?1, ?2, ?3, 1 WHERE ?4 = 0 AND ?2 IS NOT NULL
      AND EXISTS (SELECT 1 FROM attendee_roster WHERE id = 1 AND revision = ?5)
      AND (?6 IS NULL OR EXISTS (SELECT 1 FROM registration_staff_sessions s JOIN registration_access_grants g ON g.id = s.grant_id WHERE s.token_hash = ?6 AND s.expires_at > ?7 AND g.revoked_at IS NULL))
    ON CONFLICT(attendee_id) DO NOTHING`,
  ).bind(
    person.id,
    body.action === "arrived" ? now : null,
    actor.id,
    body.revision,
    body.rosterRevision,
    actor.sessionHash,
    now,
  );
  const update = env.INTERESTS.prepare(
    `UPDATE attendee_arrivals SET arrived_at = ?1, arrived_by = ?2, revision = revision + 1
    WHERE attendee_id = ?3 AND revision = ?4 AND ((?1 IS NULL AND arrived_at IS NOT NULL) OR (?1 IS NOT NULL AND arrived_at IS NULL))
      AND EXISTS (SELECT 1 FROM attendee_roster WHERE id = 1 AND revision = ?5)
      AND (?6 IS NULL OR EXISTS (SELECT 1 FROM registration_staff_sessions s JOIN registration_access_grants g ON g.id = s.grant_id WHERE s.token_hash = ?6 AND s.expires_at > ?7 AND g.revoked_at IS NULL))`,
  ).bind(
    body.action === "arrived" ? now : null,
    actor.id,
    person.id,
    body.revision,
    body.rosterRevision,
    actor.sessionHash,
    now,
  );
  const write = body.revision === 0 ? await result.run() : await update.run();
  return write.meta.changes
    ? jsonResponse({ ok: true })
    : jsonResponse(
        {
          error:
            "The arrival or registration changed. Reload to check its current status.",
        },
        409,
      );
}
