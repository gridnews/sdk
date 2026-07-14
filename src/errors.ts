/** Base class for every error thrown by the SDK. */
export class GridNewsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Rate-limit state parsed from `X-RateLimit-*` response headers. */
export interface RateLimitInfo {
  /** Daily request allowance for the key's tier, if reported. */
  limit?: number;
  /** Requests remaining today, if reported. */
  remaining?: number;
  /** Unix epoch seconds when the daily window resets, if reported. */
  reset?: number;
  /** The API key tier the server applied, if reported. */
  tier?: string;
}

/** A non-2xx HTTP response from the API. */
export class GridNewsAPIError extends GridNewsError {
  readonly status: number;
  /** Parsed JSON error body, when the server returned one. */
  readonly body?: unknown;
  readonly rateLimit: RateLimitInfo;

  constructor(status: number, message: string, body?: unknown, rateLimit: RateLimitInfo = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.rateLimit = rateLimit;
  }
}

/** 401 — missing or invalid API key. */
export class GridNewsAuthenticationError extends GridNewsAPIError {}

/** 403 — the API key's tier does not allow this endpoint. */
export class GridNewsPermissionError extends GridNewsAPIError {}

/** 429 — per-second or daily rate limit exceeded. */
export class GridNewsRateLimitError extends GridNewsAPIError {}

/** Network failure or timeout before an HTTP response was received. */
export class GridNewsConnectionError extends GridNewsError {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export function parseRateLimit(headers: Headers): RateLimitInfo {
  const num = (name: string) => {
    const raw = headers.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    limit: num("X-RateLimit-Limit"),
    remaining: num("X-RateLimit-Remaining"),
    reset: num("X-RateLimit-Reset"),
    tier: headers.get("X-RateLimit-Tier") ?? undefined,
  };
}

export function apiErrorFromResponse(status: number, body: unknown, headers: Headers): GridNewsAPIError {
  const message =
    (typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string"
      ? (body as { error: string }).error
      : undefined) ?? `GridNews API request failed with status ${status}`;
  const rateLimit = parseRateLimit(headers);
  if (status === 401) return new GridNewsAuthenticationError(status, message, body, rateLimit);
  if (status === 403) return new GridNewsPermissionError(status, message, body, rateLimit);
  if (status === 429) return new GridNewsRateLimitError(status, message, body, rateLimit);
  return new GridNewsAPIError(status, message, body, rateLimit);
}
