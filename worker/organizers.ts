import { withAdminSecurityHeaders } from "./admin-auth.ts";
import { jsonResponse, requireAdminAction } from "./form-utils.ts";
import { readJsonWithinLimit, isRecord } from "./speaker-workspace-utils.ts";

export interface Organizer {
  id: string;
  name: string;
  company: string;
  photo: string;
  visible: number;
  badge: number;
  position: number;
  revision: number;
}
export async function readOrganizers(env: Env): Promise<Organizer[]> {
  const { results } = await env.INTERESTS.prepare(
    "SELECT id, name, company, photo, visible, badge, position, revision FROM organizers ORDER BY position, id",
  ).all<Organizer>();
  return results;
}
export async function handleOrganizers(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await handle(request, env));
  } catch {
    return withAdminSecurityHeaders(
      jsonResponse({ error: "Organizer storage is unavailable." }, 503),
    );
  }
}
async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET")
    return jsonResponse({ organizers: await readOrganizers(env) });
  if (!["POST", "PUT", "DELETE"].includes(request.method))
    return jsonResponse({ error: "Method not allowed." }, 405);
  const forbidden = requireAdminAction(request, "manage-organizers");
  if (forbidden) return forbidden;
  const body = await readJsonWithinLimit(request, 16 * 1024);
  if (body instanceof Response) return body;
  if (!isRecord(body))
    return jsonResponse({ error: "Invalid organizer." }, 400);
  const id = typeof body.id === "string" ? body.id : "";
  const revision = body.revision;
  if (
    request.method !== "POST" &&
    (!/^[a-z0-9-]{1,80}$/u.test(id) ||
      !Number.isSafeInteger(revision) ||
      Number(revision) < 1)
  )
    return jsonResponse({ error: "Reload organizers before editing." }, 400);
  if (request.method === "DELETE") {
    const result = await env.INTERESTS.prepare(
      "DELETE FROM organizers WHERE id = ? AND revision = ?",
    )
      .bind(id, revision)
      .run();
    return result.meta.changes ? jsonResponse({ ok: true }) : conflict();
  }
  const name =
    typeof body.name === "string" ? body.name.trim().normalize("NFC") : "";
  const company =
    typeof body.company === "string"
      ? body.company.trim().normalize("NFC")
      : "";
  const photo = typeof body.photo === "string" ? body.photo.trim() : "";
  if (
    !name ||
    name.length > 200 ||
    company.length > 200 ||
    (photo &&
      !/^\/assets\/[a-zA-Z0-9_/-]+\.(webp|png|jpg|svg)$/u.test(photo)) ||
    typeof body.visible !== "boolean" ||
    typeof body.badge !== "boolean" ||
    !Number.isSafeInteger(body.position) ||
    Number(body.position) < 0 ||
    Number(body.position) > 1000
  )
    return jsonResponse(
      {
        error:
          "Check name, company, local photo path, and display order (0–1000).",
      },
      400,
    );
  const values = [
    name,
    company,
    photo,
    body.visible ? 1 : 0,
    body.badge ? 1 : 0,
    body.position,
    new Date().toISOString(),
  ];
  if (request.method === "POST") {
    await env.INTERESTS.prepare(
      "INSERT INTO organizers (name, company, photo, visible, badge, position, updated_at, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(...values, crypto.randomUUID())
      .run();
  } else {
    const result = await env.INTERESTS.prepare(
      "UPDATE organizers SET name = ?, company = ?, photo = ?, visible = ?, badge = ?, position = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
    )
      .bind(...values, id, revision)
      .run();
    if (!result.meta.changes) return conflict();
  }
  return jsonResponse({ organizers: await readOrganizers(env) });
}
function conflict(): Response {
  return jsonResponse(
    { error: "This organizer changed elsewhere. Reload before saving." },
    409,
  );
}
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function applyOrganizers(
  response: Response,
  env: Env,
): Promise<Response> {
  const people = (await readOrganizers(env)).filter((person) => person.visible);
  const cards = people
    .map(
      (person) =>
        `<figure class="group bg-ink">${person.photo ? `<img src="${escape(person.photo)}" alt="${escape(person.name)}" width="500" height="500" loading="lazy" class="aspect-square w-full object-cover grayscale transition duration-300 group-hover:grayscale-0">` : ""}<figcaption class="border-t border-paper px-3 py-2 text-sm font-bold uppercase">${escape(person.name)}</figcaption></figure>`,
    )
    .join("");
  const transformed = new HTMLRewriter()
    .on("[data-organizers]", {
      element(element) {
        element.setInnerContent(cards, { html: true });
      },
    })
    .transform(response);
  const headers = new Headers(transformed.headers);
  headers.delete("etag");
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(transformed.body, {
    status: transformed.status,
    headers,
  });
}
