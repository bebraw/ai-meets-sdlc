import { withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  jsonResponse,
  requireAdminAction,
  encryptText,
  decryptTextWithKey,
  importAesKey,
} from "./form-utils.ts";
import { readJsonWithinLimit, isRecord } from "./speaker-workspace-utils.ts";
import {
  defaultSettings,
  parseWorkspace,
} from "../site/scripts/badge-model.ts";
export async function handleBadgeWorkspace(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    return withAdminSecurityHeaders(await handle(request, env));
  } catch {
    return withAdminSecurityHeaders(
      jsonResponse(
        {
          error:
            "Badge storage is unavailable. Your unsaved edits remain in this tab.",
        },
        503,
      ),
    );
  }
}
async function handle(request: Request, env: Env): Promise<Response> {
  if (!["GET", "PUT"].includes(request.method))
    return jsonResponse({ error: "Method not allowed." }, 405);
  if (!env.EMAIL_ENCRYPTION_KEY)
    return jsonResponse({ error: "Badge encryption is not configured." }, 503);
  if (request.method === "GET") {
    const row = await env.INTERESTS.prepare(
      "SELECT revision, ciphertext, iv FROM badge_workspace WHERE id = 1",
    ).first<{
      revision: number;
      ciphertext: string | null;
      iv: string | null;
    }>();
    if (!row) throw new Error("Missing migration");
    const workspace =
      row.ciphertext && row.iv
        ? parseWorkspace(
            JSON.parse(
              await decryptTextWithKey(
                row.ciphertext,
                row.iv,
                await importAesKey(env.EMAIL_ENCRYPTION_KEY),
              ),
            ),
          )
        : { people: [], settings: defaultSettings };
    return jsonResponse({ revision: row.revision, workspace });
  }
  const forbidden = requireAdminAction(request, "manage-badges");
  if (forbidden) return forbidden;
  const body = await readJsonWithinLimit(request, 1800 * 1024);
  if (body instanceof Response) return body;
  if (
    !isRecord(body) ||
    !Number.isSafeInteger(body.revision) ||
    Number(body.revision) < 0
  )
    return jsonResponse({ error: "Reload the saved badge list." }, 400);
  let workspace;
  try {
    workspace = parseWorkspace(body.workspace);
  } catch {
    return jsonResponse(
      { error: "Invalid badge data or print settings. Maximum 2,000 badges." },
      400,
    );
  }
  const encrypted = await encryptText(
    JSON.stringify(workspace),
    env.EMAIL_ENCRYPTION_KEY,
  );
  const result = await env.INTERESTS.prepare(
    "UPDATE badge_workspace SET ciphertext = ?, iv = ?, revision = revision + 1, updated_at = ? WHERE id = 1 AND revision = ?",
  )
    .bind(
      encrypted.ciphertext,
      encrypted.iv,
      new Date().toISOString(),
      body.revision,
    )
    .run();
  if (!result.meta.changes)
    return jsonResponse(
      {
        error:
          "The saved badge list changed in another tab. Download your draft before reloading and reconciling.",
      },
      409,
    );
  return jsonResponse({ revision: Number(body.revision) + 1 });
}
