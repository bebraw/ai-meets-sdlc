/** Bootstrap an empty event database once before injecting an external store. */
export const organizerSchema = `CREATE TABLE IF NOT EXISTS organizers (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,company TEXT NOT NULL DEFAULT '',photo TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 0 CHECK(visible IN(0,1)),badge INTEGER NOT NULL DEFAULT 0 CHECK(badge IN(0,1)),
  position INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`;

/** SQLite and D1 execute the same revision-checked operations in the same per-event schema. */
export function organizerStore(sql) {
  const columns =
    "id, name, company, photo, visible, badge, position, revision";
  return {
    list: (visibleOnly = false) =>
      sql.all(
        `SELECT ${columns} FROM organizers${visibleOnly ? " WHERE visible = 1" : ""} ORDER BY position,id`,
        [],
      ),
    create: (id, values) =>
      sql.write(
        "INSERT INTO organizers (name,company,photo,visible,badge,position,updated_at,id) VALUES (?,?,?,?,?,?,?,?)",
        [...values, id],
      ),
    update: (id, revision, values) =>
      sql.write(
        "UPDATE organizers SET name=?,company=?,photo=?,visible=?,badge=?,position=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?",
        [...values, id, revision],
      ),
    remove: (id, revision) =>
      sql.write("DELETE FROM organizers WHERE id=? AND revision=?", [
        id,
        revision,
      ]),
  };
}
export function d1OrganizerStore(db) {
  return organizerStore({
    async all(sql, values) {
      const statement = db.prepare(sql);
      return (
        await (values.length ? statement.bind(...values) : statement).all()
      ).results;
    },
    async write(sql, values) {
      return (
        await db
          .prepare(sql)
          .bind(...values)
          .run()
      ).meta.changes;
    },
  });
}
