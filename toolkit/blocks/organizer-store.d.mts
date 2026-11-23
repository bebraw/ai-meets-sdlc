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
export const organizerSchema: string;
export interface OrganizerStore<
  R extends Rows = Rows,
  C extends Count = Count,
> {
  list(visibleOnly?: boolean): R;
  create(id: string, values: Value[]): C;
  update(id: string, revision: number, values: Value[]): C;
  remove(id: string, revision: number): C;
}
export function organizerStore<R extends Rows, C extends Count>(driver: {
  all(sql: string, values: Value[]): R;
  write(sql: string, values: Value[]): C;
}): OrganizerStore<R, C>;
interface D1 {
  prepare(sql: string): {
    all<T>(): Promise<{ results: T[] }>;
    bind(...args: Value[]): {
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
}
export function d1OrganizerStore(
  db: D1,
): OrganizerStore<Promise<Organizer[]>, Promise<number>>;
