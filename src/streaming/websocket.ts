import { GridNewsError } from "../errors.js";
import type { WirePayload } from "../types.js";

/** Structural subset of the WHATWG WebSocket interface the SDK relies on. */
export interface WebSocketLike {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

/** Close code the server uses for missing/invalid keys and insufficient tier. */
const CLOSE_UNAUTHORIZED = 4001;

export interface WebSocketConnectOptions {
  wsUrl: string;
  apiKey: string;
  webSocketImpl?: WebSocketConstructor;
  maxReconnects: number;
}

export interface WebSocketHandlers<T> {
  onMessage(payload: T): void;
  onError?(error: unknown): void;
  onClose?(code: number, reason: string): void;
}

export interface WebSocketSubscription {
  /** Closes the connection and disables reconnection. Safe to call more than once. */
  stop(): void;
}

/**
 * Connects to the GridNews streaming WebSocket. The stream is broadcast-only:
 * the server pushes article and press-release payloads as JSON text frames and
 * never expects client messages. Requires a pro or enterprise API key.
 */
export function connectWebSocket<T = WirePayload>(
  options: WebSocketConnectOptions,
  handlers: WebSocketHandlers<T>,
): WebSocketSubscription {
  const WebSocketImpl =
    options.webSocketImpl ??
    ((globalThis as { WebSocket?: WebSocketConstructor }).WebSocket as WebSocketConstructor | undefined);
  if (!WebSocketImpl) {
    throw new GridNewsError(
      "No WebSocket implementation available. On Node < 22 pass one explicitly, e.g. `webSocketImpl: (await import('ws')).WebSocket`.",
    );
  }

  const url = new URL(options.wsUrl);
  // Browsers cannot set headers on WebSocket connections, so the key travels
  // as a query parameter on both platforms.
  url.searchParams.set("apiKey", options.apiKey);

  let stopped = false;
  let reconnects = 0;
  let socket: WebSocketLike | undefined;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocketImpl(url.toString());

    socket.addEventListener("open", () => {
      reconnects = 0;
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        handlers.onMessage(item as T);
      }
    });

    socket.addEventListener("error", (event) => {
      handlers.onError?.(event);
    });

    socket.addEventListener("close", ({ code, reason }) => {
      handlers.onClose?.(code, reason);
      if (stopped || code === CLOSE_UNAUTHORIZED || reconnects >= options.maxReconnects) return;
      reconnects += 1;
      setTimeout(connect, Math.min(1000 * 2 ** (reconnects - 1), 10000));
    });
  };

  connect();

  return {
    stop() {
      stopped = true;
      socket?.close(1000, "client stopped");
    },
  };
}
