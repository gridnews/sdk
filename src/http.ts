import { apiErrorFromResponse, GridNewsConnectionError } from "./errors.js";

export interface HttpClientOptions {
  apiKey?: string;
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Retries for network errors and 5xx/429 responses. */
  retries: number;
  fetch?: typeof globalThis.fetch;
}

export type QueryValue = string | number | boolean | string[] | undefined;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(path, this.options.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
    }
    return url.toString();
  }

  headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.apiKey) headers["X-API-Key"] = this.options.apiKey;
    return headers;
  }

  async get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    const url = this.buildUrl(path, query);
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
      }
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: this.headers(),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (cause) {
        lastError = new GridNewsConnectionError(`Request to ${url} failed: ${String(cause)}`, cause);
        continue;
      }

      if (response.ok) {
        return (await response.json()) as T;
      }

      const body = await response.json().catch(() => undefined);
      const error = apiErrorFromResponse(response.status, body, response.headers);
      if (!RETRYABLE_STATUS.has(response.status)) throw error;
      lastError = error;
    }

    throw lastError instanceof Error
      ? lastError
      : new GridNewsConnectionError(`Request to ${url} failed after ${this.options.retries + 1} attempts`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
