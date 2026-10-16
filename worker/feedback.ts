import {
  feedbackContributions,
  feedbackRetentionDays,
  parseFeedback,
  type FeedbackSubmission,
  type FeedbackTotal,
} from "../shared/feedback.ts";
import { requireAdmin, withAdminSecurityHeaders } from "./admin-auth.ts";
import {
  decryptText,
  encryptText,
  getExpectedTurnstileHostnames,
  getTurnstileToken,
  readFormDataWithinLimit,
  requireAdminAction,
  sha256Hex,
} from "./form-utils.ts";
import { verifyTurnstile } from "./turnstile.ts";

type FeedbackRow = {
  id: string;
  ciphertext: string;
  iv: string;
  expires_at: number;
};
const responsePath = "/api/feedback/response";
const adminPath = "/api/admin/feedback";
const day = 86_400_000;

function json(body: unknown, status = 200): Response {
  return privateFeedbackResponse(Response.json(body, { status }));
}

export function privateFeedbackResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}

export async function purgeExpiredFeedback(
  env: Env,
  now = Date.now(),
): Promise<void> {
  if (!env.INTERESTS) return;
  // Totals were accumulated independently on submission. No raw data is copied
  // to R2 backups, and expired answers are excluded even if cleanup was delayed.
  await env.INTERESTS.prepare(
    "DELETE FROM visitor_feedback WHERE expires_at <= ?",
  )
    .bind(now)
    .run();
}

export async function handleFeedbackRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["/api/feedback", responsePath, adminPath].includes(path)) return null;
  const admin = path === adminPath;
  const respond = (response: Response) =>
    admin
      ? withAdminSecurityHeaders(response)
      : privateFeedbackResponse(response);
  if (admin) {
    const unauthorized = await requireAdmin(request, env);
    if (unauthorized) return unauthorized;
  }
  if (!env.INTERESTS || !env.EMAIL_ENCRYPTION_KEY)
    return respond(
      json({ error: "Feedback is temporarily unavailable." }, 503),
    );
  const allowedMethods = admin
    ? ["GET", "DELETE"]
    : path === responsePath
      ? ["POST", "DELETE"]
      : ["POST"];
  if (!allowedMethods.includes(request.method))
    return respond(json({ error: "Method not allowed" }, 405));
  if (request.method !== "GET" && request.headers.get("origin") !== url.origin)
    return respond(json({ error: "Submit from the SDLCAI site." }, 403));
  if (admin && request.method === "DELETE") {
    const forbidden = requireAdminAction(request, "delete-feedback");
    if (forbidden) return respond(forbidden);
  }
  try {
    const now = Date.now();
    if (admin && request.method === "GET") {
      const offsetString = url.searchParams.get("offset") ?? "0";
      if (!/^\d{1,7}$/u.test(offsetString))
        return respond(json({ error: "Invalid page." }, 400));
      const offset = Number(offsetString);
      await purgeExpiredFeedback(env, now);
      // One transactional snapshot keeps counts, active count and page consistent.
      const [totals, count, rows] = await env.INTERESTS.batch([
        env.INTERESTS.prepare(
          "SELECT question, answer, count FROM visitor_feedback_totals ORDER BY question, answer",
        ),
        env.INTERESTS.prepare(
          "SELECT COUNT(*) AS count FROM visitor_feedback WHERE expires_at > ?",
        ).bind(now),
        env.INTERESTS.prepare(
          "SELECT id, ciphertext, iv, expires_at FROM visitor_feedback WHERE expires_at > ? ORDER BY expires_at DESC, id DESC LIMIT 21 OFFSET ?",
        ).bind(now, offset),
      ]);
      const page = (rows!.results as FeedbackRow[]).slice(0, 20);
      const responses = await Promise.all(
        page.map(async (row) => ({
          ...(await readSubmission(row, env)),
          id: row.id,
          expiresAt: row.expires_at,
        })),
      );
      return respond(
        json({
          totals: totals!.results as FeedbackTotal[],
          responses,
          activeCount: (count!.results[0] as { count: number }).count,
          nextOffset: rows!.results.length > 20 ? offset + 20 : null,
        }),
      );
    }
    const form = await readFormDataWithinLimit(request, 32_768);
    if (form instanceof Response) return respond(form);
    if (admin) {
      const id = String(form.get("id") ?? "");
      if (!/^[\da-f-]{36}$/u.test(id))
        return respond(json({ error: "Invalid response." }, 400));
      const row = await env.INTERESTS.prepare(
        "SELECT id, ciphertext, iv, expires_at FROM visitor_feedback WHERE id = ? AND expires_at > ?",
      )
        .bind(id, now)
        .first<FeedbackRow>();
      if (row) await deleteFeedback(row, env, now);
      return respond(json({ deleted: Boolean(row) }));
    }
    const receipt = form.get("receipt");
    if (
      typeof receipt !== "string" ||
      !/^[a-f0-9]{64}$/u.test(receipt) ||
      form.getAll("receipt").length !== 1
    )
      return json({ error: "A valid private response code is required." }, 400);
    const hash = await sha256Hex(receipt);
    if (path === responsePath) {
      const row = await env.INTERESTS.prepare(
        "SELECT id, ciphertext, iv, expires_at FROM visitor_feedback WHERE receipt_hash = ? AND expires_at > ?",
      )
        .bind(hash, now)
        .first<FeedbackRow>();
      if (!row)
        return json(
          {
            error:
              "This response has been deleted or its 90-day retention period has ended.",
          },
          404,
        );
      if (request.method === "DELETE") {
        await deleteFeedback(row, env, now);
        return json({ deleted: true });
      }
      return json({
        ...(await readSubmission(row, env)),
        expiresAt: row.expires_at,
      });
    }
    const submission = parseFeedback(form);
    if (typeof submission === "string") return json({ error: submission }, 400);
    if (form.get("website"))
      return json({ error: "Unable to accept this submission." }, 400);
    const hostnames = getExpectedTurnstileHostnames(env);
    if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY || !hostnames.size)
      return json(
        { error: "Security verification is temporarily unavailable." },
        503,
      );
    const verification = await verifyTurnstile({
      expectedAction: "visitor-feedback",
      expectedHostnames: hostnames,
      request,
      secret: env.TURNSTILE_SECRET_KEY,
      token: getTurnstileToken(form),
    });
    if (!verification.success)
      return json({ error: "Complete the security check and try again." }, 400);
    const encrypted = await encryptText(
      JSON.stringify(submission),
      env.EMAIL_ENCRYPTION_KEY,
    );
    const expiresAt = now + feedbackRetentionDays * day;
    // All increments and insertion commit together. The hash makes retried
    // submissions idempotent; it is never connected to a mailing record.
    const changes = feedbackContributions(submission.answers).map(
      ([question, answer]) =>
        env.INTERESTS.prepare(
          "INSERT INTO visitor_feedback_totals (question, answer, count) SELECT ?, ?, 1 WHERE NOT EXISTS (SELECT 1 FROM visitor_feedback WHERE receipt_hash = ?) ON CONFLICT(question, answer) DO UPDATE SET count = count + 1",
        ).bind(question, answer, hash),
    );
    changes.push(
      env.INTERESTS.prepare(
        "INSERT INTO visitor_feedback (id, receipt_hash, ciphertext, iv, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(receipt_hash) DO NOTHING",
      ).bind(
        crypto.randomUUID(),
        hash,
        encrypted.ciphertext,
        encrypted.iv,
        expiresAt,
      ),
    );
    await env.INTERESTS.batch(changes);
    const saved = await env.INTERESTS.prepare(
      "SELECT expires_at FROM visitor_feedback WHERE receipt_hash = ?",
    )
      .bind(hash)
      .first<{ expires_at: number }>();
    return json({ saved: true, expiresAt: saved!.expires_at });
  } catch {
    // Do not log answers, receipt tokens, URLs or database error parameters.
    console.error("visitor_feedback_operation_failed", {
      admin,
      method: request.method,
    });
    return respond(
      json(
        { error: "Feedback is temporarily unavailable. Please try again." },
        503,
      ),
    );
  }
}

async function readSubmission(
  row: FeedbackRow,
  env: Env,
): Promise<FeedbackSubmission> {
  const value: FeedbackSubmission = JSON.parse(
    await decryptText(row.ciphertext, row.iv, env.EMAIL_ENCRYPTION_KEY),
  );
  return value;
}

async function deleteFeedback(
  row: FeedbackRow,
  env: Env,
  now: number,
): Promise<void> {
  const submission = await readSubmission(row, env);
  // Conditional updates plus deletion in a single transaction prevent two
  // concurrent withdrawals (or expiry cleanup) from subtracting twice.
  const changes = feedbackContributions(submission.answers).map(
    ([question, answer]) =>
      env.INTERESTS.prepare(
        "UPDATE visitor_feedback_totals SET count = count - 1 WHERE question = ? AND answer = ? AND EXISTS (SELECT 1 FROM visitor_feedback WHERE id = ? AND expires_at > ?)",
      ).bind(question, answer, row.id, now),
  );
  changes.push(
    env.INTERESTS.prepare(
      "DELETE FROM visitor_feedback WHERE id = ? AND expires_at > ?",
    ).bind(row.id, now),
  );
  await env.INTERESTS.batch(changes);
}
