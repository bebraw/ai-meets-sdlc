/** Routes whose records and credentials belong to one event. */
export function isEventPath(path: string): boolean {
  if (/^\/admin\/(?:newsletter|login|logout)(?:\/|$)/u.test(path)) return false;
  if (/^\/api\/(?:admin\/newsletter(?:\/|$)|newsletter\/)/u.test(path))
    return false;
  return /^\/(?:admin(?:\/|$)|api\/|speaker(?:\/|$)|speaker-dinner(?:\/|$)|speaker-review\/|registration(?:\/|$)|qa(?:\/|$)|feedback(?:\/|$)|event-email\/|media\/|slides(?:\/|$)|assets\/(?:slides|social)(?:\/|$))/u.test(
    path,
  );
}

export function eventPath(path: string, id: string): string {
  return isEventPath(path) ? `/events/${encodeURIComponent(id)}${path}` : path;
}

export function parseEventPath(
  path: string,
): { id: string; path: string } | null {
  const match = /^\/events\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/.*)?$/u.exec(path);
  return match ? { id: match[1]!, path: match[2] ?? "/" } : null;
}
