import { describe, expect, it } from "vitest";
import { HttpClient } from "../src/http.js";
import {
  GridNewsAuthenticationError,
  GridNewsPermissionError,
  GridNewsRateLimitError,
  apiErrorFromResponse,
  parseRateLimit,
} from "../src/errors.js";

const client = new HttpClient({
  baseUrl: "https://api.gridnews.io",
  timeoutMs: 1000,
  retries: 0,
});

describe("HttpClient.buildUrl", () => {
  it("joins array params with commas", () => {
    const url = client.buildUrl("/api/query/search", { symbols: ["AAPL", "TSLA"] });
    expect(url).toBe("https://api.gridnews.io/api/query/search?symbols=AAPL%2CTSLA");
  });

  it("skips undefined params and stringifies the rest", () => {
    const url = client.buildUrl("/api/query/search", {
      q: "earnings",
      limit: 10,
      includePressReleases: false,
      from: undefined,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("q")).toBe("earnings");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("includePressReleases")).toBe("false");
    expect(parsed.searchParams.has("from")).toBe(false);
  });
});

describe("HttpClient.headers", () => {
  it("adds X-API-Key only when a key is configured", () => {
    expect(client.headers()["X-API-Key"]).toBeUndefined();
    const authed = new HttpClient({
      apiKey: "test-key",
      baseUrl: "https://api.gridnews.io",
      timeoutMs: 1000,
      retries: 0,
    });
    expect(authed.headers()["X-API-Key"]).toBe("test-key");
  });
});

describe("error mapping", () => {
  const headers = new Headers({
    "X-RateLimit-Limit": "100",
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": "1770000000",
    "X-RateLimit-Tier": "free",
  });

  it("maps status codes to error subclasses", () => {
    expect(apiErrorFromResponse(401, { error: "Invalid API key" }, headers)).toBeInstanceOf(
      GridNewsAuthenticationError,
    );
    expect(apiErrorFromResponse(403, { error: "Insufficient tier" }, headers)).toBeInstanceOf(
      GridNewsPermissionError,
    );
    expect(apiErrorFromResponse(429, { error: "Rate limit exceeded" }, headers)).toBeInstanceOf(
      GridNewsRateLimitError,
    );
  });

  it("uses the body error string as the message", () => {
    const error = apiErrorFromResponse(403, { error: "Insufficient tier" }, headers);
    expect(error.message).toBe("Insufficient tier");
    expect(error.status).toBe(403);
  });

  it("parses rate-limit headers", () => {
    expect(parseRateLimit(headers)).toEqual({
      limit: 100,
      remaining: 0,
      reset: 1770000000,
      tier: "free",
    });
  });

  it("tolerates missing headers", () => {
    expect(parseRateLimit(new Headers())).toEqual({
      limit: undefined,
      remaining: undefined,
      reset: undefined,
      tier: undefined,
    });
  });
});
