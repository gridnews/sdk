import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridNewsError, GridNewsResearchError } from "../src/errors.js";
import { connectWebSocket, type WebSocketHandlers, type WebSocketLike } from "../src/streaming/websocket.js";
import type { ResearchFrame, StreamControlMessage, StreamSocketFilter, WirePayload } from "../src/types.js";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners: Record<string, Array<(event: any) => void>> = {};

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = ""): void {
    this.emit("close", { code, reason });
  }

  emit(type: string, event?: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  open(): void {
    this.emit("open");
  }

  push(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  sentOfType(type: string) {
    return this.sent.filter((message) => message.type === type);
  }
}

const latest = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;

function connect(filter?: StreamSocketFilter, handlers: Partial<WebSocketHandlers<WirePayload>> = {}) {
  const seen = {
    items: [] as WirePayload[],
    control: [] as StreamControlMessage[],
    research: [] as ResearchFrame[],
    errors: [] as unknown[],
  };
  const ws = connectWebSocket(
    { wsUrl: "wss://stream.test", apiKey: "key", webSocketImpl: FakeSocket, maxReconnects: 3, filter },
    {
      onMessage: (item) => seen.items.push(item),
      onControl: (message) => seen.control.push(message),
      onResearch: (frame) => seen.research.push(frame),
      onError: (error) => seen.errors.push(error),
      ...handlers,
    },
  );
  return { ws, seen };
}

const article = (id: string) => ({ id, title: `Story ${id}`, sourceUrl: "https://example.com", publishedAt: "", source: { id: "s", name: "S" }, symbols: [], sectors: [], industries: [] });

const accepted = (id: string, depth: "quick" | "deep" = "quick") => ({
  type: "research.accepted",
  id,
  seq: 0,
  depth,
  sources: 2,
  questions: 0,
  deadlineAt: "2026-09-29T12:01:30.000Z",
});

const source = (id: string, seq: number, sourceId: string, citation: number) => ({
  type: "research.source",
  id,
  seq,
  runId: "run-1",
  source: {
    sourceId,
    citation,
    url: `https://example.com/${sourceId}`,
    title: sourceId,
    domain: "example.com",
    publishedAt: null,
    dateBasis: "unknown",
    status: "retrieved",
    excerpts: [],
  },
});

const analysis = (id: string, seq: number, status: "pending" | "complete") => ({
  type: "research.analysis",
  id,
  seq,
  runId: "run-1",
  analysis: {
    analysisId: "a1",
    question: "What changed?",
    method: status === "pending" ? "extractive" : "generated",
    model: null,
    findings: [],
    connections: [],
    gaps: [],
    excerpts: [],
    generation: { status },
    warnings: [],
  },
});

const done = (id: string, seq: number) => ({
  type: "research.done",
  id,
  seq,
  runId: "run-1",
  status: "complete",
  counts: { sources: 2, retrieved: 2, failed: 0, clearing: 0, excerpts: 0, analyses: 0 },
  warnings: [],
  durationMs: 1200,
});

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebSocket routing", () => {
  it("keeps news items, filter replies and research frames apart", () => {
    const { ws, seen } = connect();
    latest().open();
    ws.research({ id: "r1", query: "chip export rules" });

    latest().push([article("a1"), article("a2")]);
    latest().push({ type: "subscribed", filter: { symbols: ["NVDA"] }, delay: 0 });
    latest().push(accepted("r1"));
    latest().push(article("a3"));
    latest().push(source("r1", 1, "s1", 1));

    expect(seen.items.map((item) => item.id)).toEqual(["a1", "a2", "a3"]);
    expect(seen.control).toEqual([{ type: "subscribed", filter: { symbols: ["NVDA"] }, delay: 0 }]);
    expect(seen.research.map((frame) => frame.type)).toEqual(["research.accepted", "research.source"]);
  });

  it("does not let a filter change touch a running research request", async () => {
    const { ws, seen } = connect({ symbols: ["AAPL"] });
    latest().open();
    const job = ws.research({ id: "r1", query: "chip export rules" });
    latest().push(accepted("r1"));

    ws.subscribe({ kind: "press_release", q: "nothing matches this" });
    latest().push({ type: "subscribed", filter: { kind: "press_release", q: "nothing matches this" }, delay: 0 });
    latest().push(source("r1", 1, "s1", 1));
    ws.unsubscribe();
    latest().push({ type: "unsubscribed" });
    latest().push(done("r1", 2));

    const result = await job.result;
    expect(result.sources.map((s) => s.sourceId)).toEqual(["s1"]);
    expect(seen.control.map((message) => message.type)).toEqual(["subscribed", "unsubscribed"]);
    // Filter messages carry no research fields, research messages no filter fields.
    expect(latest().sentOfType("subscribe")).toEqual([
      { type: "subscribe", filter: { kind: "press_release", q: "nothing matches this" } },
    ]);
    expect(latest().sentOfType("research")).toEqual([{ type: "research", id: "r1", query: "chip export rules" }]);
    expect(seen.items).toEqual([]);
  });
});

describe("WebSocket filters", () => {
  it("applies the filter when the connection opens and again after a reconnect", () => {
    const { ws } = connect({ symbols: ["AAPL", "MSFT"], delay: 500 });
    const first = new URL(latest().url);
    expect(first.searchParams.getAll("symbols")).toEqual(["AAPL", "MSFT"]);
    expect(first.searchParams.get("delay")).toBe("500");
    expect(first.searchParams.get("apiKey")).toBe("key");

    latest().open();
    expect(latest().sent).toEqual([]);
    ws.subscribe({ kind: "press_release" });
    // The delay was left out, so the current one is kept.
    expect(latest().sent).toEqual([{ type: "subscribe", filter: { kind: "press_release" }, delay: 500 }]);

    latest().close(1006, "gone");
    vi.advanceTimersByTime(1000);
    const second = new URL(latest().url);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(second.searchParams.get("kind")).toBe("press_release");
    expect(second.searchParams.get("delay")).toBe("500");
    expect(second.searchParams.has("symbols")).toBe(false);
    latest().open();
    expect(latest().sent).toEqual([]);
  });

  it("sends a filter changed while the connection was opening", () => {
    const { ws } = connect();
    ws.subscribe({ symbols: ["TSLA"] });
    latest().open();
    expect(latest().sent).toEqual([{ type: "subscribe", filter: { symbols: ["TSLA"] } }]);

    ws.unsubscribe();
    expect(latest().sent[1]).toEqual({ type: "unsubscribe" });
    latest().close(1006, "");
    vi.advanceTimersByTime(1000);
    expect(new URL(latest().url).search).toBe("?apiKey=key");
  });

  it("refuses a malformed filter before sending it", () => {
    const { ws } = connect();
    latest().open();
    expect(() => ws.subscribe({ kind: "tweet" as never })).toThrow(GridNewsError);
    expect(() => ws.subscribe({ window: 0 })).toThrow(GridNewsError);
    expect(() => ws.subscribe({ symbols: "AAPL" as never })).toThrow(GridNewsError);
    expect(latest().sent).toEqual([]);
  });
});

describe("WebSocket research", () => {
  it("delivers frames in order, once each, and reads back a missing one", async () => {
    const { ws, seen } = connect();
    latest().open();
    const frames: ResearchFrame[] = [];
    const job = ws.research({ id: "r1", query: "chip export rules", urls: ["https://a.test/1", "https://b.test/2"] }, {
      onFrame: (frame) => frames.push(frame),
    });
    expect(latest().sentOfType("research")[0]).toMatchObject({ id: "r1", urls: ["https://a.test/1", "https://b.test/2"] });

    latest().push(accepted("r1"));
    latest().push(source("r1", 2, "s2", 2));
    // seq 1 is missing: nothing past it is delivered, and the frames are read back.
    expect(frames.map((frame) => frame.seq)).toEqual([0]);
    expect(latest().sentOfType("research.get")).toEqual([{ type: "research.get", id: "r1" }]);

    latest().push({ type: "research.frames", id: "r1", frames: [accepted("r1"), source("r1", 1, "s1", 1), source("r1", 2, "s2", 2)] });
    latest().push(source("r1", 2, "s2", 2));
    latest().push(done("r1", 3));

    expect(frames.map((frame) => frame.seq)).toEqual([0, 1, 2, 3]);
    expect(seen.research).toHaveLength(4);
    const result = await job.result;
    expect(result).toMatchObject({ id: "r1", runId: "run-1", status: "complete", depth: "quick", durationMs: 1200 });
    expect(result.sources.map((s) => s.sourceId)).toEqual(["s1", "s2"]);
  });

  it("keeps the last version of an analysis", async () => {
    const { ws } = connect();
    latest().open();
    const job = ws.research({ id: "r1", query: "chip export rules", depth: "deep" });
    latest().push({ ...accepted("r1", "deep"), questions: 1 });
    latest().push(analysis("r1", 1, "pending"));
    latest().push(analysis("r1", 2, "complete"));
    latest().push(done("r1", 3));

    const result = await job.result;
    expect(result.depth).toBe("deep");
    expect(result.analyses).toHaveLength(1);
    expect(result.analyses[0]!.generation?.status).toBe("complete");
  });

  it("rejects with the server's code, keeping what arrived", async () => {
    const { ws } = connect();
    latest().open();
    const busy = ws.research({ id: "r1", query: "chip export rules" });
    latest().push({ type: "research.error", id: "r1", code: "busy", message: "Too many.", retryAfter: 10, terminal: true });
    await expect(busy.result).rejects.toMatchObject({ code: "busy", retryAfter: 10, id: "r1" });

    const cut = ws.research({ id: "r2", query: "chip export rules" });
    latest().push(accepted("r2"));
    latest().push(source("r2", 1, "s1", 1));
    latest().push({ type: "research.error", id: "r2", seq: 2, code: "interrupted", message: "Stopped.", terminal: true });
    const error = await cut.result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GridNewsResearchError);
    expect((error as GridNewsResearchError).code).toBe("interrupted");
    expect((error as GridNewsResearchError).sources.map((s) => s.sourceId)).toEqual(["s1"]);
  });

  it("reads frames back after a reconnect instead of sending the request again", async () => {
    const { ws } = connect();
    latest().open();
    const job = ws.research({ id: "r1", query: "chip export rules" });
    latest().push(accepted("r1"));
    latest().push(source("r1", 1, "s1", 1));
    latest().close(1006, "");

    vi.advanceTimersByTime(1000);
    latest().open();
    expect(latest().sentOfType("research")).toEqual([]);
    expect(latest().sentOfType("research.get")).toEqual([{ type: "research.get", id: "r1" }]);

    latest().push({
      type: "research.frames",
      id: "r1",
      frames: [accepted("r1"), source("r1", 1, "s1", 1), source("r1", 2, "s2", 2)],
    });
    // Not finished yet: the frames go on being read back.
    vi.advanceTimersByTime(8000);
    expect(latest().sentOfType("research.get")).toHaveLength(2);
    latest().push({
      type: "research.frames",
      id: "r1",
      frames: [accepted("r1"), source("r1", 1, "s1", 1), source("r1", 2, "s2", 2), done("r1", 3)],
    });

    const result = await job.result;
    expect(result.sources.map((s) => s.sourceId)).toEqual(["s1", "s2"]);
  });

  it("sends a request again when it never got through before a reconnect", () => {
    const { ws } = connect();
    latest().open();
    ws.research({ id: "r1", query: "chip export rules" });
    latest().close(1006, "");
    vi.advanceTimersByTime(1000);
    latest().open();
    expect(latest().sentOfType("research.get")).toHaveLength(1);

    latest().push({ type: "research.error", id: "r1", code: "not_found", message: "No request.", terminal: true });
    expect(latest().sentOfType("research")).toEqual([{ type: "research", id: "r1", query: "chip export rules" }]);
  });

  it("asks the server to cancel once the request is accepted", async () => {
    const { ws } = connect();
    latest().open();
    const job = ws.research({ id: "r1", query: "chip export rules" });
    job.cancel();
    expect(latest().sentOfType("research.cancel")).toEqual([]);

    latest().push(accepted("r1"));
    expect(latest().sentOfType("research.cancel")).toEqual([{ type: "research.cancel", id: "r1" }]);
    latest().push({ type: "research.ack", id: "r1", op: "cancel" });
    latest().push({ type: "research.error", id: "r1", seq: 1, code: "cancelled", message: "Cancelled.", terminal: true });
    await expect(job.result).rejects.toMatchObject({ code: "cancelled" });
  });

  it("cancels a request that was never sent without sending anything", async () => {
    const { ws } = connect();
    const job = ws.research({ id: "r1", query: "chip export rules" });
    job.cancel();
    await expect(job.result).rejects.toMatchObject({ code: "cancelled" });
    latest().open();
    expect(latest().sent).toEqual([]);
  });

  it("gives up after the deadline and the grace", async () => {
    const { ws } = connect();
    latest().open();
    const job = ws.research({ id: "r1", query: "chip export rules" });
    latest().push(accepted("r1"));
    vi.advanceTimersByTime(90_000 + 60_000 + 2_000);
    await expect(job.result).rejects.toMatchObject({ code: "timeout" });
  });

  it("ends running requests when stopped or refused", async () => {
    const stopped = connect();
    latest().open();
    const first = stopped.ws.research({ query: "chip export rules" });
    // Nobody awaits this one: stopping must not leave an unhandled rejection.
    stopped.ws.research({ query: "chip export rules" });
    stopped.ws.stop();
    await expect(first.result).rejects.toMatchObject({ code: "stopped" });

    const refused = connect();
    latest().open();
    const second = refused.ws.research({ query: "chip export rules" });
    latest().close(4001, "Invalid API key");
    await expect(second.result).rejects.toMatchObject({ code: "connection_closed" });
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("generates ids and refuses bad ones and oversized requests", () => {
    const { ws } = connect();
    latest().open();
    const job = ws.research({ query: "chip export rules" });
    expect(job.id).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    expect(() => ws.research({ id: "has space", query: "chip export rules" })).toThrow(GridNewsError);
    expect(() => ws.research({ id: job.id, query: "chip export rules" })).toThrow(/already running/);
    expect(() => ws.research({ query: "x".repeat(17_000) })).toThrow(/at most/);
  });

  it("reads a request's frames by id", async () => {
    const { ws } = connect();
    const read = ws.getResearch("old-1");
    latest().open();
    expect(latest().sentOfType("research.get")).toEqual([{ type: "research.get", id: "old-1" }]);
    latest().push({ type: "research.frames", id: "old-1", frames: [accepted("old-1"), done("old-1", 1)] });
    expect((await read).map((frame) => frame.type)).toEqual(["research.accepted", "research.done"]);

    const missing = ws.getResearch("old-2");
    latest().push({ type: "research.error", id: "old-2", code: "not_found", message: "Expired.", terminal: true });
    await expect(missing).rejects.toMatchObject({ code: "not_found" });
  });
});
