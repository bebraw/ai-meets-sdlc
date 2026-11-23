import { randomUUID } from "node:crypto";
import {
  actorKey,
  atomic,
  clean,
  codeInstructions,
  email,
  fail,
  limitWrites,
  mailer,
  migrateLimits,
  newCode,
  number,
  object,
  operation,
  organizer,
  publicRoles,
  revision,
  text,
  verifyChallenge,
} from "./engagement-common.mjs";

function settings(db) {
  return (
    db
      .prepare("SELECT title,consent,revision FROM news_settings WHERE id=1")
      .get() ?? fail("Publish newsletter consent wording first.", 404)
  );
}

export const newsletter = {
  id: "newsletter",
  title: "Newsletter subscriptions",
  scope: "installation",
  description:
    "Collect explicit signups, confirm email ownership and withdraw subscriptions across an organizer's events.",
  migrate(db) {
    migrateLimits(db);
    db.exec(`CREATE TABLE IF NOT EXISTS news_settings(id INTEGER PRIMARY KEY CHECK(id=1), title TEXT NOT NULL, consent TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS news_members(
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, email TEXT, status TEXT NOT NULL,
      consent TEXT NOT NULL, consent_revision INTEGER NOT NULL, confirm_hash TEXT UNIQUE, withdraw_hash TEXT UNIQUE, pending_withdraw TEXT,
      requested_at INTEGER NOT NULL,expires INTEGER);
    CREATE TABLE IF NOT EXISTS news_consent_history(seq INTEGER PRIMARY KEY AUTOINCREMENT,
      member TEXT NOT NULL, status TEXT NOT NULL, notice TEXT NOT NULL,revision INTEGER NOT NULL,occurred_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS news_expiry ON news_members(expires);`);
  },
  cleanup({ sharedDb }) {
    // Expired re-subscribe attempts leave an earlier withdrawal in the change feed.
    return {
      expired: sharedDb
        .prepare(
          "DELETE FROM news_members WHERE status='pending' AND expires<=?",
        )
        .run(Date.now()).changes,
    };
  },
  operations: [
    operation(
      "newsletter_configure",
      "Publish organizer-wide newsletter signup wording. Share this form across events.",
      object({ title: text(160), consent: text(2000), revision }),
      {
        title: "Field Notes news",
        consent: "I want email updates about future Field Notes events.",
        revision: 0,
      },
      organizer,
      (input, { sharedDb: db }) => {
        const title = clean(input.title, "the newsletter title");
        const notice = clean(input.consent, "consent wording");
        const row =
          input.revision === 0
            ? db
                .prepare(
                  "INSERT INTO news_settings VALUES(1,?,?,1) ON CONFLICT DO NOTHING RETURNING title,consent,revision",
                )
                .get(title, notice)
            : db
                .prepare(
                  "UPDATE news_settings SET title=?,consent=?,revision=revision+1 WHERE id=1 AND revision=? RETURNING title,consent,revision",
                )
                .get(title, notice, input.revision);
        return (
          row ?? fail("Newsletter settings changed. Reload the form.", 409)
        );
      },
    ),
    operation(
      "newsletter_form",
      "Read the current newsletter consent notice and version.",
      object({}),
      {},
      publicRoles,
      (_, { sharedDb }) => settings(sharedDb),
    ),
    operation(
      "newsletter_subscribe",
      "Request a one-time email confirmation after accepting the published consent wording. Confirmation expires in 24 hours.",
      object(
        {
          email,
          revision,
          consent: { type: "boolean", const: true },
          challenge: text(4096),
        },
        ["email", "revision", "consent"],
      ),
      { email: "listener@example.test", revision: 1, consent: true },
      publicRoles,
      async (input, ctx) => {
        const send = mailer(ctx);
        await verifyChallenge(ctx, "newsletter_subscribe", input.challenge);
        const db = ctx.sharedDb,
          address = input.email.toLowerCase().trim();
        const now = Date.now(),
          confirm = newCode(),
          withdraw = newCode(),
          fingerprint = ctx.fingerprint("news-address:" + address);
        const digest = ctx.fingerprint("news-confirm:" + confirm);
        const generic = {
          message: "If a confirmation is needed, check your email.",
        };
        const pending = atomic(db, () => {
          const form = settings(db);
          if (input.consent !== true || form.revision !== input.revision)
            fail(
              "Review the current consent wording before requesting confirmation.",
              409,
            );
          limitWrites(db, actorKey(ctx, "news"), 10, 3_600_000);
          const existing = db
            .prepare(
              "SELECT id,status,requested_at FROM news_members WHERE fingerprint=?",
            )
            .get(fingerprint);
          if (
            existing?.status === "subscribed" ||
            (existing?.status === "pending" &&
              existing.requested_at + 600_000 > now)
          )
            return null;
          const id = existing?.id ?? randomUUID();
          db.prepare(
            `INSERT INTO news_members(id,fingerprint,email,status,consent,consent_revision,confirm_hash,requested_at,expires,withdraw_hash,pending_withdraw)
          VALUES(?,?,?,'pending',?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET email=excluded.email,status='pending',
          consent=excluded.consent,consent_revision=excluded.consent_revision,confirm_hash=excluded.confirm_hash,
          requested_at=excluded.requested_at,expires=excluded.expires,withdraw_hash=excluded.withdraw_hash,pending_withdraw=excluded.pending_withdraw`,
          ).run(
            id,
            fingerprint,
            ctx.seal(address),
            form.consent,
            form.revision,
            digest,
            now,
            now + 86_400_000,
            ctx.fingerprint("news-withdraw:" + withdraw),
            ctx.seal(withdraw),
          );
          return { id, form };
        });
        if (!pending) return generic;
        try {
          await send({
            to: address,
            subject: `Confirm your subscription to ${pending.form.title}`,
            text: `${pending.form.consent}\n\nConfirm ownership of this address within 24 hours:\n${codeInstructions(ctx, "newsletter_confirm", confirm)}\n\nAfter confirmation you can withdraw at any time:\n${codeInstructions(ctx, "newsletter_withdraw", withdraw)}\n\nIf you did not request this, you can ignore this email.`,
          });
        } catch {
          db.prepare(
            "UPDATE news_members SET requested_at=0,confirm_hash=NULL,expires=0 WHERE id=? AND confirm_hash=?",
          ).run(pending.id, digest);
          fail("The confirmation email could not be sent. Try again.", 502);
        }
        return generic;
      },
    ),
    operation(
      "newsletter_confirm",
      "Confirm email ownership with the one-time code sent to the address. Keep the returned withdrawal code.",
      object({ code: text(128) }),
      { code: "code-from-confirmation-email" },
      publicRoles,
      ({ code }, ctx) =>
        atomic(ctx.sharedDb, () => {
          const row = ctx.sharedDb
            .prepare(
              `UPDATE news_members SET status='subscribed',confirm_hash=NULL,expires=NULL
        WHERE status='pending' AND confirm_hash=? AND expires>? RETURNING id,consent,consent_revision,pending_withdraw`,
            )
            .get(ctx.fingerprint("news-confirm:" + code), Date.now());
          if (!row)
            fail("Confirmation expired, already used, or invalid.", 404);
          const withdraw = ctx.open(row.pending_withdraw);
          ctx.sharedDb
            .prepare("UPDATE news_members SET pending_withdraw=NULL WHERE id=?")
            .run(row.id);
          ctx.sharedDb
            .prepare(
              "INSERT INTO news_consent_history(member,status,notice,revision,occurred_at) VALUES(?,'subscribed',?,?,?)",
            )
            .run(
              row.id,
              row.consent,
              row.consent_revision,
              new Date().toISOString(),
            );
          return {
            subscribed: true,
            withdrawalCode: withdraw,
            withdrawal: codeInstructions(ctx, "newsletter_withdraw", withdraw),
          };
        }),
    ),
    operation(
      "newsletter_withdraw",
      "Withdraw consent using a private code. The subscriber address is removed from the active list.",
      object({ code: text(128) }),
      { code: "private-withdrawal-code" },
      publicRoles,
      ({ code }, ctx) =>
        atomic(ctx.sharedDb, () => {
          const row = ctx.sharedDb
            .prepare(
              `UPDATE news_members SET status='withdrawn',email=NULL,withdraw_hash=NULL,confirm_hash=NULL,expires=NULL
        WHERE status='subscribed' AND withdraw_hash=? RETURNING id,consent,consent_revision`,
            )
            .get(ctx.fingerprint("news-withdraw:" + code));
          if (!row) fail("Withdrawal code invalid or already used.", 404);
          ctx.sharedDb
            .prepare(
              "INSERT INTO news_consent_history(member,status,notice,revision,occurred_at) VALUES(?,'withdrawn',?,?,?)",
            )
            .run(
              row.id,
              row.consent,
              row.consent_revision,
              new Date().toISOString(),
            );
          return { withdrawn: true };
        }),
    ),
    operation(
      "newsletter_subscribers",
      "List a page of confirmed subscribers for this installation.",
      object({ offset: number(0, 1_000_000) }, []),
      {},
      organizer,
      (input, ctx) => ({
        subscribers: ctx.sharedDb
          .prepare(
            "SELECT id,email,consent_revision AS consentVersion FROM news_members WHERE status='subscribed' ORDER BY rowid LIMIT 100 OFFSET ?",
          )
          .all(input.offset ?? 0)
          .map((row) => ({ ...row, email: ctx.open(row.email) })),
        total: ctx.sharedDb
          .prepare(
            "SELECT COUNT(*) AS n FROM news_members WHERE status='subscribed'",
          )
          .get().n,
      }),
    ),
    operation(
      "newsletter_changes",
      "Read confirmed consents and withdrawals after a cursor for provider synchronization. Track the stable subscriber ID at your provider; withdrawn addresses are erased.",
      object({ after: number(0, Number.MAX_SAFE_INTEGER) }, []),
      { after: 0 },
      organizer,
      (input, ctx) => {
        const rows = ctx.sharedDb
          .prepare(
            `SELECT h.seq,h.member,h.status,h.notice,h.revision,h.occurred_at AS occurredAt,m.email,m.status AS currentStatus FROM news_consent_history h
        LEFT JOIN news_members m ON h.member=m.id WHERE h.seq>? ORDER BY h.seq LIMIT 100`,
          )
          .all(input.after ?? 0);
        const changes = rows.map(
          ({ email: stored, currentStatus, ...row }) => ({
            ...row,
            email:
              row.status === "subscribed" && currentStatus === "subscribed"
                ? ctx.open(stored)
                : null,
          }),
        );
        return { changes, next: changes.at(-1)?.seq ?? input.after ?? 0 };
      },
    ),
  ],
};
