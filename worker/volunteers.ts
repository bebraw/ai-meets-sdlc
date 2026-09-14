import { withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  decryptTextWithKey,
  encryptText,
  importAesKey,
  isLikelyEmail,
  jsonResponse,
  normalizeEmail,
  normalizeFormText,
  readFormDataWithinLimit,
  requireAdminAction,
} from "./form-utils.ts";

interface VolunteerDetails {
  name: string;
  email: string;
  task: string;
}

interface VolunteerRow {
  volunteer_id: string;
  details_ciphertext: string;
  details_iv: string;
  revision: number;
}

// Called only after the Worker's shared admin authentication guard.
export async function handleVolunteersRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await handleRequest(request, env));
  } catch {
    console.error("volunteers_request_failed");
    return withAdminSecurityHeaders(
      jsonResponse(
        { error: "Volunteers are temporarily unavailable. Please try again." },
        503,
      ),
    );
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const match = /^\/api\/admin\/volunteers(?:\/([a-f0-9-]{36}))?$/u.exec(
    new URL(request.url).pathname,
  );
  if (!match) return jsonResponse({ error: "Not found." }, 404);
  const id = match[1];
  const allowed = id ? ["PUT", "DELETE"] : ["GET", "POST"];
  if (!allowed.includes(request.method)) {
    return jsonResponse({ error: "Method not allowed." }, 405, {
      allow: allowed.join(", "),
    });
  }
  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY) {
    return jsonResponse({ error: "Volunteer storage is not configured." }, 503);
  }

  if (request.method === "GET") {
    const { results } = await env.INTERESTS.prepare(
      "SELECT volunteer_id, details_ciphertext, details_iv, revision FROM volunteers ORDER BY created_at, volunteer_id",
    ).all<VolunteerRow>();
    const key = await importAesKey(env.EMAIL_ENCRYPTION_KEY);
    const volunteers = await Promise.all(
      results.map(async (row) => {
        const details: VolunteerDetails = JSON.parse(
          await decryptTextWithKey(row.details_ciphertext, row.details_iv, key),
        );
        return { id: row.volunteer_id, revision: row.revision, ...details };
      }),
    );
    volunteers.sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ volunteers });
  }

  const forbidden = requireAdminAction(request, "manage-volunteers");
  if (forbidden) return forbidden;
  const form = await readFormDataWithinLimit(request, 16 * 1024);
  if (form instanceof Response) return form;
  const revision = Number(form.get("revision"));
  if (id && (!Number.isSafeInteger(revision) || revision < 1)) {
    return jsonResponse(
      { error: "Reload the volunteer list and try again." },
      400,
    );
  }

  if (request.method === "DELETE") {
    const result = await env.INTERESTS.prepare(
      "DELETE FROM volunteers WHERE volunteer_id = ? AND revision = ?",
    )
      .bind(id, revision)
      .run();
    return result.meta.changes ? jsonResponse({ ok: true }) : conflict();
  }

  const details: VolunteerDetails = {
    name: normalizeFormText(form.get("name")),
    email: normalizeEmail(form.get("email")),
    task: normalizeFormText(form.get("task")),
  };
  if (!details.name || details.name.length > 200) {
    return jsonResponse(
      { error: "Enter a name of up to 200 characters." },
      400,
    );
  }
  if (details.email.length > 254 || !isLikelyEmail(details.email)) {
    return jsonResponse(
      { error: "Enter a valid email address of up to 254 characters." },
      400,
    );
  }
  if (details.task.length > 2000) {
    return jsonResponse(
      { error: "Keep the task to 2,000 characters or fewer." },
      400,
    );
  }
  const encrypted = await encryptText(
    JSON.stringify(details),
    env.EMAIL_ENCRYPTION_KEY,
  );
  const now = new Date().toISOString();
  if (id) {
    const result = await env.INTERESTS.prepare(
      "UPDATE volunteers SET details_ciphertext = ?, details_iv = ?, revision = revision + 1, updated_at = ? WHERE volunteer_id = ? AND revision = ?",
    )
      .bind(encrypted.ciphertext, encrypted.iv, now, id, revision)
      .run();
    return result.meta.changes
      ? jsonResponse({ volunteer: { id, revision: revision + 1, ...details } })
      : conflict();
  }
  const newId = crypto.randomUUID();
  await env.INTERESTS.prepare(
    "INSERT INTO volunteers (volunteer_id, details_ciphertext, details_iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(newId, encrypted.ciphertext, encrypted.iv, now, now)
    .run();
  return jsonResponse(
    { volunteer: { id: newId, revision: 1, ...details } },
    201,
  );
}

function conflict(): Response {
  return jsonResponse(
    {
      error:
        "This volunteer was changed or removed elsewhere. Reload the list before trying again.",
    },
    409,
  );
}
