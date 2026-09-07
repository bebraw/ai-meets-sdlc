import {
  readCanonicalSpeaker,
  readCanonicalSpeakers,
} from "./canonical-content.ts";

interface ReceiptRow {
  receipt_id: string;
  speaker_id: string;
  object_key: string;
  byte_size: number;
  details_ciphertext: string;
  status: "submitted" | "processed" | "deleted";
  revision: number;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

interface ReceiptDetails {
  speaker_name: string;
  filename: string;
  content_type: string;
  description: string;
  amount: string;
  currency: string;
  expense_date: string;
  note: string;
  organizer_note: string;
}

const maxFileBytes = 10 * 1024 * 1024;
const maxReceiptsPerSpeaker = 30;
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function handleSpeakerReceiptRequest(
  request: Request,
  env: Env,
  speakerId: string,
): Promise<Response> {
  return handleReceiptRequest(request, env, speakerId);
}

// Admin authentication and mutation verification happen in speaker-workspace.
export async function handleAdminReceiptRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  return handleReceiptRequest(request, env, null);
}

async function handleReceiptRequest(
  request: Request,
  env: Env,
  speakerId: string | null,
): Promise<Response> {
  if (!env.INTERESTS || !env.SPEAKER_UPLOADS || !env.EMAIL_ENCRYPTION_KEY) {
    return json({ error: "Receipt storage is not configured." }, 503);
  }
  try {
    const url = new URL(request.url);
    const base =
      speakerId === null ? "/api/admin/receipts" : "/api/speaker/receipts";
    if (url.pathname === `${base}/access` && speakerId === null) {
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const input = await readJson(request);
      if (input instanceof Response) return input;
      if (
        typeof input.speaker_id !== "string" ||
        typeof input.enabled !== "boolean" ||
        !(await readCanonicalSpeaker(env, input.speaker_id))
      ) {
        return json(
          { error: "Choose a valid speaker and upload access setting." },
          400,
        );
      }
      await env.INTERESTS.prepare(
        `INSERT INTO speaker_receipt_access (speaker_id, enabled, updated_at)
        VALUES (?1, ?2, ?3) ON CONFLICT(speaker_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
      )
        .bind(input.speaker_id, input.enabled ? 1 : 0, new Date().toISOString())
        .run();
      return json({ message: "Receipt upload access saved." });
    }
    if (
      url.pathname === base ||
      (speakerId === null && url.pathname === `${base}.csv`)
    ) {
      if (
        request.method === "POST" &&
        speakerId !== null &&
        url.pathname === base
      )
        return await upload(request, env, speakerId);
      if (request.method !== "GET")
        return json({ error: "Method not allowed" }, 405);
      const query =
        speakerId === null
          ? env.INTERESTS.prepare(
              "SELECT * FROM speaker_travel_receipts WHERE status != 'deleted' ORDER BY created_at DESC",
            )
          : env.INTERESTS.prepare(
              "SELECT * FROM speaker_travel_receipts WHERE speaker_id = ?1 AND status != 'deleted' ORDER BY created_at DESC",
            ).bind(speakerId);
      const rows = (await query.all<ReceiptRow>()).results;
      const receipts = await Promise.all(
        rows.map((row) => serialize(row, env, speakerId === null)),
      );
      if (url.pathname.endsWith(".csv")) {
        const columns = [
          "receipt_id",
          "speaker_name",
          "description",
          "expense_date",
          "amount",
          "currency",
          "status",
          "filename",
          "note",
          "organizer_note",
          "created_at",
          "processed_at",
          "download_url",
        ] as const;
        const csv = [
          columns.join(","),
          ...receipts.map((receipt) =>
            columns
              .map((key) =>
                csvCell(
                  key === "download_url"
                    ? `${url.origin}${receipt[key]}`
                    : receipt[key],
                ),
              )
              .join(","),
          ),
        ].join("\r\n");
        return new Response(`\uFEFF${csv}\r\n`, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition":
              'attachment; filename="sdlcai-travel-receipts.csv"',
          },
        });
      }
      if (speakerId !== null)
        return json({
          receipts,
          enabled: await isEnabled(env, speakerId),
          upload_until: env.SPEAKER_WORKSPACE_ACCESS_UNTIL,
        });
      const [speakers, access] = await Promise.all([
        readCanonicalSpeakers(env),
        env.INTERESTS.prepare(
          "SELECT speaker_id, enabled FROM speaker_receipt_access",
        ).all<{ speaker_id: string; enabled: number }>(),
      ]);
      const enabled = new Set(
        access.results
          .filter((row) => row.enabled === 1)
          .map((row) => row.speaker_id),
      );
      return json({
        receipts,
        speakers: speakers.map((record) => ({
          speaker_id: record.speakerId,
          name: record.content.profile.name,
          enabled: enabled.has(record.speakerId),
        })),
      });
    }
    const parts = url.pathname.slice(base.length + 1).split("/");
    const receiptId = parts[0] ?? "";
    if (
      !url.pathname.startsWith(`${base}/`) ||
      !idPattern.test(receiptId) ||
      parts.length > 2 ||
      (parts.length === 2 && parts[1] !== "download")
    )
      return json({ error: "Not found" }, 404);
    const row = await env.INTERESTS.prepare(
      "SELECT * FROM speaker_travel_receipts WHERE receipt_id = ?1 AND status != 'deleted'",
    )
      .bind(receiptId)
      .first<ReceiptRow>();
    if (!row || (speakerId !== null && row.speaker_id !== speakerId))
      return json({ error: "Receipt was not found." }, 404);
    if (parts[1] === "download") {
      if (request.method !== "GET" && request.method !== "HEAD")
        return json({ error: "Method not allowed" }, 405);
      const details = await decryptDetails(row, env);
      const object = await env.SPEAKER_UPLOADS.get(row.object_key);
      if (!object)
        return json(
          { error: "Receipt file is unavailable. Contact the organizer." },
          404,
        );
      if (object.size > maxFileBytes + 28)
        return json({ error: "Receipt file is invalid." }, 500);
      const bytes = await decrypt(
        new Uint8Array(await object.arrayBuffer()),
        env,
        `${row.receipt_id}:${row.speaker_id}:file`,
      );
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: {
          "content-type": details.content_type,
          "content-length": String(bytes.byteLength),
          "content-disposition": `attachment; filename="receipt-${row.receipt_id}.${extension(details.content_type)}"; filename*=UTF-8''${encodeURIComponent(details.filename).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
          "x-content-type-options": "nosniff",
          "content-security-policy":
            "sandbox allow-downloads; default-src 'none'",
        },
      });
    }
    if (request.method === "PATCH" && speakerId === null) {
      const input = await readJson(request);
      if (input instanceof Response) return input;
      if (
        !Number.isInteger(input.revision) ||
        (input.status !== "submitted" && input.status !== "processed") ||
        typeof input.organizer_note !== "string" ||
        input.organizer_note.length > 2000
      )
        return json(
          {
            error:
              "Choose a status and keep the organizer note under 2,000 characters.",
          },
          400,
        );
      const details = await decryptDetails(row, env);
      details.organizer_note = input.organizer_note.trim();
      const now = new Date().toISOString();
      const result = await env.INTERESTS.prepare(
        `UPDATE speaker_travel_receipts SET status = ?1, details_ciphertext = ?2,
        updated_at = ?3, processed_at = ?4, revision = revision + 1 WHERE receipt_id = ?5 AND revision = ?6 AND status != 'deleted'`,
      )
        .bind(
          input.status,
          await encryptDetails(details, env, row.receipt_id, row.speaker_id),
          now,
          input.status === "processed" ? (row.processed_at ?? now) : null,
          row.receipt_id,
          input.revision,
        )
        .run();
      if (!result.meta.changes)
        return json(
          { error: "This receipt changed. Refresh before saving again." },
          409,
        );
      return json({ message: "Receipt status saved." });
    }
    if (request.method === "DELETE") {
      if (speakerId !== null && row.status === "processed")
        return json(
          {
            error: "A processed receipt can only be removed by the organizer.",
          },
          409,
        );
      const input = await readJson(request);
      if (input instanceof Response) return input;
      if (!Number.isInteger(input.revision))
        return json({ error: "Refresh before removing this receipt." }, 400);
      const result = await env.INTERESTS.prepare(
        `UPDATE speaker_travel_receipts SET status = 'deleted', revision = revision + 1
        WHERE receipt_id = ?1 AND revision = ?2 AND status != 'deleted' ${speakerId === null ? "" : "AND status = 'submitted'"}`,
      )
        .bind(row.receipt_id, input.revision)
        .run();
      if (!result.meta.changes)
        return json(
          { error: "This receipt changed. Refresh before removing it." },
          409,
        );
      // Mark first to prevent concurrent downloads/reviews. The daily cleanup
      // retries storage deletion if R2 is temporarily unavailable.
      await deleteStoredReceipt(env, row);
      return json({ message: "Receipt removed." });
    }
    return json({ error: "Method not allowed" }, 405);
  } catch {
    console.error("speaker_receipt_request_failed");
    return json(
      {
        error:
          "Receipts are temporarily unavailable. Please refresh and try again.",
      },
      503,
    );
  }
}

async function upload(
  request: Request,
  env: Env,
  speakerId: string,
): Promise<Response> {
  if (!(await isEnabled(env, speakerId)))
    return json(
      {
        error:
          "Receipt uploads have not been enabled for you. Contact the organizer.",
      },
      403,
    );
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;"))
    return json({ error: "Submit the receipt upload form." }, 415);
  const bytes = await readBytes(request, maxFileBytes + 16 * 1024);
  if (bytes instanceof Response) return bytes;
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type")! },
    }).formData();
  } catch {
    return json({ error: "The receipt form could not be read." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > maxFileBytes)
    return json({ error: "Choose a receipt file up to 10 MB." }, 400);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectContentType(fileBytes);
  if (
    !contentType ||
    (file.type &&
      file.type !== "application/octet-stream" &&
      file.type !== contentType)
  )
    return json({ error: "Use a PDF, JPEG, PNG, or WebP receipt." }, 415);
  const speaker = await readCanonicalSpeaker(env, speakerId);
  if (!speaker) return json({ error: "Speaker was not found." }, 404);
  const text = (field: string) =>
    typeof form.get(field) === "string" ? String(form.get(field)).trim() : "";
  const details: ReceiptDetails = {
    speaker_name: speaker.content.profile.name,
    filename:
      file.name
        .split(/[\\/]/u)
        .pop()
        ?.replace(/[\x00-\x1f\x7f]/gu, "")
        .slice(0, 160) || `receipt.${extension(contentType)}`,
    content_type: contentType,
    description: text("description"),
    amount: text("amount").replace(",", "."),
    currency: text("currency").toUpperCase(),
    expense_date: text("expense_date"),
    note: text("note"),
    organizer_note: "",
  };
  if (
    details.description.length < 2 ||
    details.description.length > 160 ||
    details.note.length > 2000
  )
    return json(
      {
        error:
          "Add a description of 2–160 characters and keep notes under 2,000 characters.",
      },
      400,
    );
  if (
    !/^\d{1,8}(?:\.\d{1,3})?$/u.test(details.amount) ||
    Number(details.amount) <= 0 ||
    !/^[A-Z]{3}$/u.test(details.currency)
  )
    return json(
      {
        error:
          "Enter a positive receipt amount and a three-letter currency code, such as EUR.",
      },
      400,
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(details.expense_date) ||
    !Number.isFinite(Date.parse(details.expense_date)) ||
    new Date(details.expense_date).toISOString().slice(0, 10) !==
      details.expense_date
  )
    return json({ error: "Enter the expense date shown on the receipt." }, 400);
  const receiptId = crypto.randomUUID();
  const objectKey = `travel-receipts/${speakerId}/${receiptId}.enc`;
  const encryptedFile = await encrypt(
    fileBytes,
    env,
    `${receiptId}:${speakerId}:file`,
  );
  const encryptedDetails = await encryptDetails(
    details,
    env,
    receiptId,
    speakerId,
  );
  const now = new Date().toISOString();
  await env.SPEAKER_UPLOADS.put(objectKey, encryptedFile, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  let saved = false;
  try {
    // Enforce both access and quota in the same database statement.
    const result = await env.INTERESTS.prepare(
      `INSERT INTO speaker_travel_receipts
      (receipt_id, speaker_id, object_key, byte_size, details_ciphertext, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6
      WHERE EXISTS (SELECT 1 FROM speaker_receipt_access WHERE speaker_id = ?2 AND enabled = 1)
      AND (SELECT COUNT(*) FROM speaker_travel_receipts WHERE speaker_id = ?2 AND status != 'deleted') < ?7`,
    )
      .bind(
        receiptId,
        speakerId,
        objectKey,
        file.size,
        encryptedDetails,
        now,
        maxReceiptsPerSpeaker,
      )
      .run();
    saved = result.meta.changes === 1;
    if (!saved)
      return json(
        {
          error:
            "Upload access changed or the 30-receipt limit was reached. Refresh or contact the organizer.",
        },
        409,
      );
  } finally {
    if (!saved) await env.SPEAKER_UPLOADS.delete(objectKey);
  }
  return json(
    {
      message:
        "Receipt submitted. The organizer will process it after the event.",
      receipt_id: receiptId,
    },
    201,
  );
}

async function isEnabled(env: Env, speakerId: string): Promise<boolean> {
  const row = await env.INTERESTS.prepare(
    "SELECT enabled FROM speaker_receipt_access WHERE speaker_id = ?1",
  )
    .bind(speakerId)
    .first<{ enabled: number }>();
  return row?.enabled === 1;
}

async function serialize(row: ReceiptRow, env: Env, admin: boolean) {
  const details = await decryptDetails(row, env);
  return {
    ...details,
    receipt_id: row.receipt_id,
    speaker_id: row.speaker_id,
    byte_size: row.byte_size,
    status: row.status,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    processed_at: row.processed_at,
    download_url: `${admin ? "/api/admin" : "/api/speaker"}/receipts/${row.receipt_id}/download`,
  };
}

async function encryptDetails(
  details: ReceiptDetails,
  env: Env,
  receiptId: string,
  speakerId: string,
): Promise<string> {
  return Buffer.from(
    await encrypt(
      new TextEncoder().encode(JSON.stringify(details)),
      env,
      `${receiptId}:${speakerId}:details`,
    ),
  ).toString("base64");
}

async function decryptDetails(
  row: ReceiptRow,
  env: Env,
): Promise<ReceiptDetails> {
  const bytes = await decrypt(
    new Uint8Array(Buffer.from(row.details_ciphertext, "base64")),
    env,
    `${row.receipt_id}:${row.speaker_id}:details`,
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as ReceiptDetails;
}

async function importKey(env: Env): Promise<CryptoKey> {
  const derived = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `speaker-travel-receipts:${env.EMAIL_ENCRYPTION_KEY}`,
    ),
  );
  return crypto.subtle.importKey("raw", derived, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(
  bytes: Uint8Array<ArrayBuffer>,
  env: Env,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await importKey(env),
    bytes,
  );
  const result = new Uint8Array(12 + encrypted.byteLength);
  result.set(iv);
  result.set(new Uint8Array(encrypted), 12);
  return result;
}

async function decrypt(
  bytes: Uint8Array<ArrayBuffer>,
  env: Env,
  context: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(0, 12),
        additionalData: new TextEncoder().encode(context),
      },
      await importKey(env),
      bytes.slice(12),
    ),
  );
}

function detectContentType(bytes: Uint8Array): string | null {
  const start = new TextDecoder().decode(bytes.slice(0, 12));
  if (start.startsWith("%PDF-")) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (Buffer.from(bytes.slice(0, 8)).toString("hex") === "89504e470d0a1a0a")
    return "image/png";
  if (start.startsWith("RIFF") && start.slice(8) === "WEBP")
    return "image/webp";
  return null;
}

function extension(type: string): string {
  return (
    (
      {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      } as Record<string, string>
    )[type] ?? "bin"
  );
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+\-@]/u.test(text) ? `'${text}` : text).replace(/"/gu, '""')}"`;
}

async function readJson(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Submit the form again." }, 415);
  const bytes = await readBytes(request, 16 * 1024);
  if (bytes instanceof Response) return bytes;
  try {
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (input && typeof input === "object" && !Array.isArray(input))
      return input as Record<string, unknown>;
  } catch {
    /* Return a stable validation error. */
  }
  return json({ error: "Submit the form again." }, 400);
}

async function readBytes(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer> | Response> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/u.test(length) || Number(length) > limit))
    return json(
      { error: "Upload is too large. Files must be no larger than 10 MB." },
      413,
    );
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          return json(
            {
              error: "Upload is too large. Files must be no larger than 10 MB.",
            },
            413,
          );
        }
        chunks.push(value);
      }
    } catch {
      return json({ error: "Upload was interrupted. Please try again." }, 400);
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function deleteStoredReceipt(
  env: Env,
  row: Pick<ReceiptRow, "receipt_id" | "object_key">,
): Promise<void> {
  await env.SPEAKER_UPLOADS.delete(row.object_key);
  await env.INTERESTS.prepare(
    "DELETE FROM speaker_travel_receipts WHERE receipt_id = ?1 AND status = 'deleted'",
  )
    .bind(row.receipt_id)
    .run();
}

export async function purgeDeletedSpeakerReceipts(env: Env): Promise<void> {
  if (!env.INTERESTS || !env.SPEAKER_UPLOADS) return;
  const rows = await env.INTERESTS.prepare(
    "SELECT receipt_id, object_key FROM speaker_travel_receipts WHERE status = 'deleted' LIMIT 100",
  ).all<Pick<ReceiptRow, "receipt_id" | "object_key">>();
  for (const row of rows.results) await deleteStoredReceipt(env, row);
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
