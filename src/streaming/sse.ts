import { apiErrorFromResponse, GridNewsConnectionError } from "../errors.js";

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseSubscription {
  /** Closes the stream. Safe to call more than once. */
  stop(): void;
}

export interface SseHandlers {
  onEvent(event: SseEvent): void;
  onError?(error: unknown): void;
  /** Called after the stream closes for good (stopped, or retries exhausted). */
  onClose?(): void;
}

export interface SseConnectOptions {
  url: string;
  headers: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Reconnect attempts after an established stream drops. Auth errors never reconnect. */
  maxReconnects: number;
}

/**
 * Minimal Server-Sent-Events consumer on top of fetch. The endpoints this SDK
 * targets emit `event: <name>\ndata: <json>\n\n` frames and comment keepalives.
 */
export function connectSse(options: SseConnectOptions, handlers: SseHandlers): SseSubscription {
  const controller = new AbortController();
  let stopped = false;

  const run = async () => {
    let reconnects = 0;
    while (!stopped) {
      try {
        const fetchImpl = options.fetch ?? globalThis.fetch;
        const response = await fetchImpl(options.url, {
          headers: { ...options.headers, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => undefined);
          throw apiErrorFromResponse(response.status, body, response.headers);
        }
        if (!response.body) {
          throw new GridNewsConnectionError("SSE response had no body");
        }
        reconnects = 0;
        await readStream(response.body, handlers, () => stopped);
        // Server closed the stream cleanly; fall through to reconnect logic.
        throw new GridNewsConnectionError("SSE stream ended");
      } catch (error) {
        if (stopped || isAbort(error)) break;
        handlers.onError?.(error);
        // 4xx (auth, tier, bad request) will repeat identically — don't loop on it.
        if (isNonRetryable(error) || reconnects >= options.maxReconnects) break;
        reconnects += 1;
        await sleep(Math.min(1000 * 2 ** (reconnects - 1), 10000));
      }
    }
    handlers.onClose?.();
  };

  void run();

  return {
    stop() {
      stopped = true;
      controller.abort();
    },
  };
}

async function readStream(body: ReadableStream<Uint8Array>, handlers: SseHandlers, isStopped: () => boolean) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!isStopped()) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = parseFrame(frame);
        if (event) handlers.onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Exported for tests. */
export function parseFrame(frame: string): SseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keepalive
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return { event, data: data.join("\n") };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isNonRetryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    (error as { status: number }).status >= 400 &&
    (error as { status: number }).status < 500 &&
    (error as { status: number }).status !== 429
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
