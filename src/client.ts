import { HttpClient } from "./http.js";
import { NewsResource } from "./resources/news.js";
import { PressReleasesResource } from "./resources/pressReleases.js";
import { QualityResource } from "./resources/quality.js";
import { SentimentResource } from "./resources/sentiment.js";
import { StreamResource } from "./streaming/streams.js";
import type { WebSocketConstructor } from "./streaming/websocket.js";
import type { HealthResponse, StatusResponse, UsageResult, ApiEnvelope } from "./types.js";

export interface GridNewsOptions {
  /**
   * Your GridNews API key. Optional — without it only the public endpoints
   * (topics, health/status) are available.
   */
  apiKey?: string;
  /** REST API base URL. Default: https://api.gridnews.io */
  baseUrl?: string;
  /** Streaming service base URL (SSE). Default: https://stream.gridnews.io */
  streamUrl?: string;
  /** Streaming WebSocket URL. Default: wss://stream.gridnews.io */
  wsUrl?: string;
  /** Per-request timeout in milliseconds. Default: 15000 */
  timeoutMs?: number;
  /** Retries for network errors and 429/5xx responses. Default: 2 */
  retries?: number;
  /** Reconnect attempts for dropped streams. Default: 10 */
  maxStreamReconnects?: number;
  /** Custom fetch implementation. Default: globalThis.fetch */
  fetch?: typeof globalThis.fetch;
  /**
   * WebSocket constructor. Defaults to globalThis.WebSocket (browsers and
   * Node 22+). On older Node pass the `ws` package's WebSocket class.
   */
  webSocketImpl?: WebSocketConstructor;
}

const DEFAULT_BASE_URL = "https://api.gridnews.io";
const DEFAULT_STREAM_URL = "https://stream.gridnews.io";
const DEFAULT_WS_URL = "wss://stream.gridnews.io";

export class GridNews {
  /** Article search, per-symbol news, sources, and topics. */
  readonly news: NewsResource;
  /** Press-release listing and filtering. */
  readonly pressReleases: PressReleasesResource;
  /** Symbol sentiment, on-demand ticker analysis, and sector breakdowns. */
  readonly sentiment: SentimentResource;
  /** Article quality statistics and per-article breakdowns. */
  readonly quality: QualityResource;
  /** SSE and WebSocket streams of the latest articles and press releases. */
  readonly stream: StreamResource;

  private readonly http: HttpClient;
  private readonly streamHttp: HttpClient;

  constructor(options: GridNewsOptions = {}) {
    const timeoutMs = options.timeoutMs ?? 15000;
    const retries = options.retries ?? 2;

    this.http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs,
      retries,
      fetch: options.fetch,
    });
    this.streamHttp = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: options.streamUrl ?? DEFAULT_STREAM_URL,
      timeoutMs,
      retries,
      fetch: options.fetch,
    });

    this.news = new NewsResource(this.http);
    this.pressReleases = new PressReleasesResource(this.http);
    this.sentiment = new SentimentResource(this.http);
    this.quality = new QualityResource(this.http);
    this.stream = new StreamResource({
      streamUrl: options.streamUrl ?? DEFAULT_STREAM_URL,
      wsUrl: options.wsUrl ?? DEFAULT_WS_URL,
      apiKey: options.apiKey,
      fetch: options.fetch,
      webSocketImpl: options.webSocketImpl,
      maxReconnects: options.maxStreamReconnects ?? 10,
    });
  }

  /** Current tier, limits, and today's usage for your API key. */
  async usage(): Promise<UsageResult> {
    const body = await this.http.get<ApiEnvelope<UsageResult>>("/api/query/usage");
    return body.data;
  }

  /** REST API health check. No API key required. */
  health(): Promise<HealthResponse> {
    return this.http.get<HealthResponse>("/api/health");
  }

  /** REST API status. No API key required. */
  status(): Promise<StatusResponse> {
    return this.http.get<StatusResponse>("/api/status");
  }

  /** Streaming service health check. No API key required. */
  streamHealth(): Promise<HealthResponse> {
    return this.streamHttp.get<HealthResponse>("/api/health");
  }
}
