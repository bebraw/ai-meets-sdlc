import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { encryptText } from "../../worker/form-utils.ts";

const migrations = await Promise.all(
  (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFile(`migrations/${name}`, "utf8")),
);
export async function mailingFixture(t) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('ok')}}",
      compatibilityDate: "2026-04-30",
      d1Databases: ["INTERESTS"],
      r2Buckets: ["INTEREST_BACKUPS"],
    }),
  );
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("INTERESTS"),
    bucket = await mf.getR2Bucket("INTEREST_BACKUPS");
  for (const migration of migrations)
    for (const sql of migration
      .split(/;\s*\n/u)
      .map((value) => value.trim())
      .filter(Boolean))
      await db.prepare(sql).run();
  const messages = [];
  const env = {
    INTERESTS: db,
    INTEREST_BACKUPS: bucket,
    EMAIL_ENCRYPTION_KEY: "local-mailing-test-key",
    PUBLIC_SITE_ORIGIN: "https://sdlcai.org",
    NEWSLETTER_ENABLED: "true",
    TURNSTILE_SITE_KEY: "test-site-key",
    TURNSTILE_SECRET_KEY: "test-secret",
    TURNSTILE_HOSTNAMES: "sdlcai.org",
    EMAIL: {
      send: async (message) => {
        messages.push(message);
        return { messageId: `test-${messages.length}` };
      },
    },
  };
  async function roster(people) {
    const records = people.map((person, index) => ({
      id: `attendee-${index}`,
      source: "tito",
      sourceKey: `ticket:${index}`,
      name: `Attendee ${index}`,
      email: `person${index}@example.test`,
      company: "",
      ticketCode: `${index}`,
      status: "active",
      badge: true,
      type: "attendee",
      ...person,
    }));
    const encrypted = await encryptText(
      JSON.stringify(records),
      env.EMAIL_ENCRYPTION_KEY,
    );
    await db
      .prepare(
        "UPDATE attendee_roster SET ciphertext = ?, iv = ?, revision = revision + 1 WHERE id = 1",
      )
      .bind(encrypted.ciphertext, encrypted.iv)
      .run();
  }
  return { env, db, bucket, messages, roster };
}
export const origin = "https://sdlcai.org";
export function mailRequest(
  path,
  body,
  method = "POST",
  action = "attendee-messages",
) {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      "x-admin-action": action,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
