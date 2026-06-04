export function getRequestOrigin(request: Request): string {
  const url = new URL(request.url);

  return `${url.protocol}//${url.host}`;
}

export function getClientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
    "unknown"
  );
}
