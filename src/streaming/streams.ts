import { GridNewsError } from "../errors.js";
import type {
  StreamArticle,
  StreamConnectedEvent,
  StreamFilterParams,
  StreamPressRelease,
  WirePayload,
} from "../types.js";
import { connectSse, type SseSubscription } from "./sse.js";
import {
  connectWebSocket,
  type WebSocketConstructor,
  type WebSocketHandlers,
  type WebSocketSubscription,
} from "./websocket.js";

export interface StreamResourceConfig {
  streamUrl: string;
  wsUrl: string;
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  webSocketImpl?: WebSocketConstructor;
  maxReconnects: number;
}

export interface ArticleStreamHandlers {
  onArticle(article: StreamArticle): void;
  onConnected?(info: StreamConnectedEvent): void;
  onError?(error: unknown): void;
  onClose?(): void;
}

export interface PressReleaseStreamHandlers {
  onPressRelease(release: StreamPressRelease): void;
  onConnected?(info: StreamConnectedEvent): void;
  onError?(error: unknown): void;
  onClose?(): void;
}

export class StreamResource {
  constructor(private readonly config: StreamResourceConfig) {}

  /** Breaking-article stream over SSE. Requires a pro or enterprise API key. */
  articles(params: StreamFilterParams, handlers: ArticleStreamHandlers): SseSubscription {
    return this.subscribeSse(
      "/api/news/stream",
      {
        providers: params.providers?.join(","),
        symbols: params.symbols?.join(","),
        q: params.search,
        delay: params.delay,
      },
      (event, data) => {
        if (event === "connected") handlers.onConnected?.(data as StreamConnectedEvent);
        else if (event === "article") handlers.onArticle(data as StreamArticle);
      },
      handlers,
    );
  }

  /** Breaking press-release stream over SSE. Requires a pro or enterprise API key. */
  pressReleases(params: StreamFilterParams, handlers: PressReleaseStreamHandlers): SseSubscription {
    return this.subscribeSse(
      "/api/news/press-releases/stream",
      {
        providers: params.providers?.join(","),
        symbols: params.symbols?.join(","),
        search: params.search,
        delay: params.delay,
      },
      (event, data) => {
        if (event === "connected") handlers.onConnected?.(data as StreamConnectedEvent);
        else if (event === "press_release") handlers.onPressRelease(data as StreamPressRelease);
      },
      handlers,
    );
  }

  /**
   * Broadcast WebSocket carrying every article and press release as it is
   * published (no server-side filtering — filter client-side). Requires a pro
   * or enterprise API key.
   */
  websocket(handlers: WebSocketHandlers<WirePayload>): WebSocketSubscription {
    if (!this.config.apiKey) {
      throw new GridNewsError("The streaming WebSocket requires an apiKey.");
    }
    return connectWebSocket<WirePayload>(
      {
        wsUrl: this.config.wsUrl,
        apiKey: this.config.apiKey,
        webSocketImpl: this.config.webSocketImpl,
        maxReconnects: this.config.maxReconnects,
      },
      handlers,
    );
  }

  private subscribeSse(
    path: string,
    query: Record<string, string | number | undefined>,
    dispatch: (event: string, data: unknown) => void,
    handlers: { onError?(error: unknown): void; onClose?(): void },
  ): SseSubscription {
    if (!this.config.apiKey) {
      throw new GridNewsError(`${path} requires an apiKey (pro tier or above).`);
    }
    const url = new URL(path, this.config.streamUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return connectSse(
      {
        url: url.toString(),
        headers: { "X-API-Key": this.config.apiKey },
        fetch: this.config.fetch,
        maxReconnects: this.config.maxReconnects,
      },
      {
        onEvent: ({ event, data }) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            return;
          }
          dispatch(event, parsed);
        },
        onError: handlers.onError,
        onClose: handlers.onClose,
      },
    );
  }
}
