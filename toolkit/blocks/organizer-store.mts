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
type Value = string | number;
type Rows = Organizer[] | Promise<Organizer[]>;
type Count = number | Promise<number>;
export interface OrganizerStore<
  R extends Rows = Rows,
  C extends Count = Count,
> {
  list(visibleOnly?: boolean): R;
  create(id: string, values: Value[]): C;
  update(id: string, revision: number, values: Value[]): C;
  remove(id: string, revision: number): C;
}
interface D1 {
  prepare(sql: string): {
    all<T>(): Promise<{ results: T[] }>;
    bind(...args: Value[]): {
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}

/** Bootstrap an empty event database once before injecting an external store. */
export const organizerSchema = `CREATE TABLE IF NOT EXISTS organizers (
  id TEXT PRIMARY KEY,name TEXT NOT NULL,company TEXT NOT NULL DEFAULT '',photo TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 0 CHECK(visible IN(0,1)),badge INTEGER NOT NULL DEFAULT 0 CHECK(badge IN(0,1)),
  position INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`;

/** SQLite and D1 execute the same revision-checked operations in the same per-event schema. */
export function organizerStore<R extends Rows, C extends Count>(sql: {
  all(query: string, values: Value[]): R;
  write(query: string, values: Value[]): C;
}): OrganizerStore<R, C> {
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
export function d1OrganizerStore(
  db: D1,
): OrganizerStore<Promise<Organizer[]>, Promise<number>> {
  return organizerStore({
    async all(sql, values) {
      const statement = db.prepare(sql);
      return (
        await (
          values.length ? statement.bind(...values) : statement
        ).all<Organizer>()
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
