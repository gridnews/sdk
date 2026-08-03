import { describe, expect, it } from "vitest";
import { GridNews } from "../src/index.js";

/**
 * The events resource. What is worth pinning is the query serialization
 * (arrays must reach the API comma-joined, not repeated) and that the
 * envelope is unwrapped, since both are silent failures rather than errors.
 */
function clientWith(capture: { url?: string; headers?: Record<string, string> }, body: unknown) {
  return new GridNews({
    apiKey: "test-key",
    baseUrl: "https://api.example.com",
    fetch: (async (url: string, init: any) => {
      capture.url = String(url);
      capture.headers = init?.headers;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof globalThis.fetch,
  });
}

const EVENT = {
  id: "evt1",
  summary: "HSBC to Sell Singapore Insurance Business",
  type: "article",
  rootId: "art1",
  firstSeenAt: "2026-08-03T10:00:00.000Z",
  lastSeenAt: "2026-08-03T11:00:00.000Z",
  entriesCount: 3,
  sourcesCount: 3,
  independentVoices: 2,
  impactScore: 1.4,
  sourceReputation: 0.8,
  symbols: ["HSBC"],
  sectors: [],
  industries: [],
  sources: [],
};

describe("events.list", () => {
  it("comma-joins array filters and unwraps the envelope", async () => {
    const cap: { url?: string } = {};
    const client = clientWith(cap, {
      status: "success",
      data: {
        events: [EVENT],
        pagination: { limit: 20, total: 1, page: 1 },
        query: {},
      },
    });

    const result = await client.events.list({
      symbols: ["AAPL", "MSFT"],
      minVoices: 2,
      type: "article",
      orderBy: "-impactScore",
    });

    const url = new URL(cap.url!);
    expect(url.pathname).toBe("/api/query/events");
    expect(url.searchParams.get("symbols")).toBe("AAPL,MSFT");
    expect(url.searchParams.get("minVoices")).toBe("2");
    expect(url.searchParams.get("type")).toBe("article");
    expect(url.searchParams.get("orderBy")).toBe("-impactScore");

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.independentVoices).toBe(2);
    expect(result.pagination.total).toBe(1);
  });

  it("sends no filter params when none are given", async () => {
    const cap: { url?: string } = {};
    const client = clientWith(cap, {
      status: "success",
      data: { events: [], pagination: { limit: 20, total: 0, page: 1 }, query: {} },
    });
    await client.events.list();
    expect(new URL(cap.url!).search).toBe("");
  });
});

describe("events.get", () => {
  it("encodes the id and returns the voice grouping", async () => {
    const cap: { url?: string; headers?: Record<string, string> } = {};
    const client = clientWith(cap, {
      status: "success",
      data: {
        event: EVENT,
        voices: [
          { voiceKey: "wsj.com", outlets: ["Dow Jones", "Wall Street Journal"] },
          { voiceKey: "gurufocus", outlets: ["GuruFocus"] },
        ],
        memberCap: 200,
      },
    });

    const result = await client.events.get("evt/1");
    expect(cap.url).toContain("/api/query/events/evt%2F1");
    expect(cap.headers?.["X-API-Key"]).toBe("test-key");
    // Two mastheads, one voice — stated outright rather than inferred.
    expect(result.voices[0]?.outlets).toEqual(["Dow Jones", "Wall Street Journal"]);
    expect(result.memberCap).toBe(200);
  });
});
