import { DurableObject } from "cloudflare:workers";

// One notification hub for this event. It holds connections, never questions,
// participant identities, credentials, or authoritative room state.
export class QaUpdates extends DurableObject<Env> {
  private clients = new Map<
    ReadableStreamDefaultController<Uint8Array>,
    { until: number; detach: () => void }
  >();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private encoder = new TextEncoder();

  override async fetch(request: Request): Promise<Response> {
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    if (this.clients.size >= 2000)
      return new Response("Use polling", { status: 503 });
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start: (value) => {
        controller = value;
        const abort = () => this.remove(value);
        request.signal.addEventListener("abort", abort, { once: true });
        this.clients.set(value, {
          until: Date.now() + 15 * 60_000,
          detach: () => request.signal.removeEventListener("abort", abort),
        });
        value.enqueue(this.encoder.encode("retry: 3000\n: connected\n\n"));
      },
      cancel: () => this.remove(controller),
    });
    this.heartbeat ??= setInterval(() => {
      for (const [client, entry] of this.clients) {
        if (entry.until <= Date.now()) this.remove(client);
        else this.send(client, "event: qa-change\ndata: heartbeat\n\n");
      }
    }, 25_000);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  async notify(): Promise<void> {
    for (const client of this.clients.keys())
      this.send(client, "event: qa-change\ndata: changed\n\n");
  }
  private send(
    client: ReadableStreamDefaultController<Uint8Array>,
    message: string,
  ): void {
    if ((client.desiredSize ?? 0) <= 0) {
      this.remove(client);
      return;
    }
    try {
      client.enqueue(this.encoder.encode(message));
    } catch {
      this.remove(client);
    }
  }
  private remove(client: ReadableStreamDefaultController<Uint8Array>): void {
    const entry = this.clients.get(client);
    if (!entry) return;
    entry.detach();
    this.clients.delete(client);
    try {
      client.close();
    } catch {
      /* The browser may have cancelled already. */
    }
    if (this.clients.size === 0 && this.heartbeat !== undefined) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }
}
