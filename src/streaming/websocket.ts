import { GridNewsError, GridNewsResearchError } from "../errors.js";
import type {
  ResearchAnalysis,
  ResearchFrame,
  ResearchRequest,
  ResearchResult,
  ResearchSource,
  StreamControlMessage,
  StreamSocketFilter,
  WirePayload,
} from "../types.js";

/** Structural subset of the WHATWG WebSocket interface the SDK relies on. */
export interface WebSocketLike {
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

/** Close code the server uses for missing/invalid keys and insufficient tier. */
const CLOSE_UNAUTHORIZED = 4001;

const RESEARCH_ID = /^[A-Za-z0-9._:-]{1,64}$/;
/** The server's limit on one research message. */
const MAX_RESEARCH_MESSAGE_CHARS = 16_384;
/** The server ends a request by these deadlines; past them and the grace, the SDK gives up. */
const RESEARCH_DEADLINE_MS = { quick: 90_000, deep: 240_000 } as const;
const RESEARCH_GRACE_MS = 60_000;
/** How often running requests are checked. */
const WATCH_MS = 2_000;
/**
 * The server sends a request's frames to the connection that sent it. After a
 * reconnect they are read back instead, this often.
 */
const ORPHAN_READ_MS = 6_000;
/** A missing frame is read back, at most this often. */
const GAP_READ_MS = 3_000;
/** Without a frame for this long, the frames so far are read back in case one was lost. */
const STALL_MS = 20_000;

export interface WebSocketConnectOptions {
  wsUrl: string;
  apiKey: string;
  webSocketImpl?: WebSocketConstructor;
  maxReconnects: number;
  /** Applied when the connection opens, so nothing arrives unfiltered first. */
  filter?: StreamSocketFilter;
}

export interface WebSocketHandlers<T> {
  /** News items: articles and press releases. Filter replies and research never arrive here. */
  onMessage(payload: T): void;
  /** The server's answers to `subscribe()` and `unsubscribe()`, and filter errors. */
  onControl?(message: StreamControlMessage): void;
  /** Every frame of every research request on this connection, in order, once each. */
  onResearch?(frame: ResearchFrame): void;
  onOpen?(): void;
  onError?(error: unknown): void;
  onClose?(code: number, reason: string): void;
}

export interface ResearchOptions {
  /** Called with each frame of this request, in order, once each. */
  onFrame?(frame: ResearchFrame): void;
}

export interface ResearchHandle {
  id: string;
  /** Resolves on `research.done`; rejects with a `GridNewsResearchError`. */
  result: Promise<ResearchResult>;
  /** Asks the server to stop the request; `result` then rejects with code `cancelled`. */
  cancel(): void;
}

export interface WebSocketSubscription {
  /**
   * Replaces the filter. A `delay` left out keeps the current one. The
   * server answers through `onControl`; the filter is re-applied after a
   * reconnect.
   */
  subscribe(filter: StreamSocketFilter): void;
  /** Back to every item, with no delay. */
  unsubscribe(): void;
  /**
   * Starts a Grid AI research request (pro tier+). Its frames go to
   * `options.onFrame` and `onResearch`, never to `onMessage`, and the filter
   * does not apply to them.
   */
  research(request: ResearchRequest, options?: ResearchOptions): ResearchHandle;
  /** The frames the server holds for a request made with this API key in the last hour. */
  getResearch(id: string): Promise<ResearchFrame[]>;
  /** Closes the connection and disables reconnection. Safe to call more than once. */
  stop(): void;
}

interface PendingResearch {
  id: string;
  message: string;
  depth: "quick" | "deep";
  onFrame?: (frame: ResearchFrame) => void;
  resolve(result: ResearchResult): void;
  reject(error: GridNewsResearchError): void;
  /** The connection the request went out on; 0 until it has. */
  sentOn: number;
  /** Sent again after a reconnect, when a read-back found nothing. */
  resubmitted: boolean;
  /** Admitted, but not by this connection's message: frames are read back, never pushed. */
  foreign: boolean;
  submitOutstanding: boolean;
  readOutstanding: boolean;
  accepted: boolean;
  cancelRequested: boolean;
  cancelSent: boolean;
  nextSeq: number;
  early: Map<number, ResearchFrame>;
  sources: Map<string, ResearchSource>;
  analyses: Map<string, ResearchAnalysis>;
  lastProgress: number;
  lastRead: number;
  nextReadAt: number;
  giveUpAt: number;
}

interface ReadWaiter {
  resolve(frames: ResearchFrame[]): void;
  reject(error: GridNewsResearchError): void;
}

/**
 * Connects to the GridNews streaming WebSocket. The server pushes article and
 * press-release payloads as JSON text frames; the client may send
 * `subscribe`/`unsubscribe` to change what it receives and `research` to run
 * Grid AI over the same connection. Requires a pro or enterprise API key.
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

  let filter = options.filter ? checkFilter(options.filter) : undefined;
  let openedWith = "";
  let stopped = false;
  let reconnects = 0;
  let generation = 0;
  let open = false;
  let socket: WebSocketLike | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  const pending = new Map<string, PendingResearch>();
  const reads = new Map<string, ReadWaiter[]>();
  const queuedReads = new Set<string>();

  const sendText = (text: string): boolean => {
    if (!open || !socket) return false;
    try {
      socket.send(text);
      return true;
    } catch (error) {
      handlers.onError?.(error);
      return false;
    }
  };

  const guarded = (call: () => void) => {
    try {
      call();
    } catch (error) {
      handlers.onError?.(error);
    }
  };

  // ------------------------------------------------------------- research

  const stopWatch = () => {
    if (watch) clearInterval(watch);
    watch = undefined;
  };

  const ensureWatch = () => {
    if (watch) return;
    watch = setInterval(tick, WATCH_MS);
    (watch as { unref?: () => void }).unref?.();
  };

  const orderedSources = (p: PendingResearch) =>
    [...p.sources.values()].sort((a, b) => a.citation - b.citation);

  const fail = (p: PendingResearch, code: string, message: string, retryAfter?: number) => {
    if (!pending.delete(p.id)) return;
    p.reject(
      new GridNewsResearchError(code, message, {
        id: p.id,
        retryAfter,
        sources: orderedSources(p),
        analyses: [...p.analyses.values()],
      }),
    );
    if (!pending.size) stopWatch();
  };

  const submit = (p: PendingResearch, again = false) => {
    if (!sendText(p.message)) return;
    const now = Date.now();
    p.sentOn = generation;
    p.submitOutstanding = true;
    p.resubmitted ||= again;
    p.lastProgress = now;
    if (p.giveUpAt === Infinity) p.giveUpAt = now + RESEARCH_DEADLINE_MS[p.depth] + RESEARCH_GRACE_MS;
  };

  const readBack = (p: PendingResearch, now: number) => {
    if (!sendText(JSON.stringify({ type: "research.get", id: p.id }))) return;
    p.readOutstanding = true;
    p.lastRead = now;
  };

  /** Sends whatever a request needs next on the open connection, if anything. */
  const advance = (p: PendingResearch, now = Date.now()) => {
    if (!open || !pending.has(p.id)) return;
    if (p.sentOn === 0) {
      submit(p);
      return;
    }
    if (p.submitOutstanding || p.readOutstanding) return;
    if (p.cancelRequested && !p.cancelSent && p.accepted) {
      p.cancelSent = sendText(JSON.stringify({ type: "research.cancel", id: p.id }));
    }
    if (now < p.nextReadAt) return;
    const pushed = p.sentOn === generation && !p.foreign;
    if (!pushed) {
      // Sent on an earlier connection: first find out whether it got through, then poll.
      if (!p.accepted || now - p.lastRead >= ORPHAN_READ_MS) readBack(p, now);
      return;
    }
    const gap = p.early.size > 0 && now - p.lastRead >= GAP_READ_MS;
    const stalled = now - p.lastProgress >= STALL_MS && now - p.lastRead >= STALL_MS;
    if (gap || stalled) readBack(p, now);
  };

  /** Handles one frame in order; returns false once the request has ended. */
  const deliver = (p: PendingResearch, frame: ResearchFrame): boolean => {
    if (p.onFrame) guarded(() => p.onFrame!(frame));
    if (handlers.onResearch) guarded(() => handlers.onResearch!(frame));
    switch (frame.type) {
      case "research.accepted":
        p.accepted = true;
        p.depth = frame.depth;
        if (p.cancelRequested) advance(p);
        return true;
      case "research.source":
        p.sources.set(frame.source.sourceId, frame.source);
        return true;
      case "research.analysis":
        // A pending generation is followed by the same analysis again; the last one stands.
        p.analyses.set(frame.analysis.analysisId, frame.analysis);
        return true;
      case "research.done":
        pending.delete(p.id);
        if (!pending.size) stopWatch();
        p.resolve({
          id: p.id,
          runId: frame.runId,
          status: frame.status,
          depth: p.depth,
          sources: orderedSources(p),
          analyses: [...p.analyses.values()],
          counts: frame.counts,
          ...(frame.analysis ? { analysisSkipped: frame.analysis } : {}),
          warnings: frame.warnings ?? [],
          durationMs: frame.durationMs,
        });
        return false;
      case "research.error":
        if (frame.terminal === false) return true;
        fail(p, frame.code, frame.message, frame.retryAfter);
        return false;
      default:
        return true;
    }
  };

  /** Frames arrive pushed, read back, or both: each is delivered once, in sequence. */
  const intake = (p: PendingResearch, frame: ResearchFrame) => {
    if (!pending.has(p.id) || !Number.isInteger(frame.seq)) return;
    if (frame.seq < p.nextSeq || p.early.has(frame.seq)) return;
    p.early.set(frame.seq, frame);
    for (let next = p.early.get(p.nextSeq); next; next = p.early.get(p.nextSeq)) {
      p.early.delete(p.nextSeq);
      p.nextSeq += 1;
      p.lastProgress = Date.now();
      if (!deliver(p, next)) return;
    }
    if (p.early.size > 0) advance(p);
  };

  const settleReads = (id: string, outcome: { frames: ResearchFrame[] } | { error: GridNewsResearchError }) => {
    const waiting = reads.get(id);
    if (!waiting) return;
    reads.delete(id);
    queuedReads.delete(id);
    for (const waiter of waiting) {
      if ("frames" in outcome) waiter.resolve(outcome.frames);
      else waiter.reject(outcome.error);
    }
  };

  const onResearchReply = (reply: Record<string, unknown>) => {
    const id = typeof reply.id === "string" ? reply.id : undefined;
    const p = id ? pending.get(id) : undefined;

    if (reply.type === "research.frames") {
      const frames = (Array.isArray(reply.frames) ? reply.frames : []) as ResearchFrame[];
      if (p) {
        p.readOutstanding = false;
        for (const frame of frames) intake(p, frame);
      }
      if (id) settleReads(id, { frames });
      return;
    }
    if (reply.type === "research.ack") return;
    if (reply.type === "research.error" && !Number.isInteger(reply.seq)) {
      onImmediateError(p, id, reply);
      return;
    }
    if (p) {
      if (reply.type === "research.accepted") p.submitOutstanding = false;
      intake(p, reply as unknown as ResearchFrame);
    }
  };

  /** An error the stream core answered a message with, rather than one the run sent. */
  const onImmediateError = (p: PendingResearch | undefined, id: string | undefined, reply: Record<string, unknown>) => {
    const code = typeof reply.code === "string" ? reply.code : "error";
    const message = typeof reply.message === "string" ? reply.message : "Research request failed.";
    const retryAfter = typeof reply.retryAfter === "number" ? reply.retryAfter : undefined;
    const error = new GridNewsResearchError(code, message, { id, retryAfter });

    if (p?.submitOutstanding) {
      p.submitOutstanding = false;
      if (code === "duplicate_id" && p.resubmitted) {
        // The first send got through after all; its frames went to the old connection.
        p.foreign = true;
        p.accepted = true;
        p.nextReadAt = 0;
        advance(p);
        return;
      }
      fail(p, code, message, retryAfter);
      return;
    }
    if (p?.readOutstanding) {
      p.readOutstanding = false;
      if (code === "not_found" && !p.accepted && p.nextSeq === 0) {
        // Sent just before a reconnect and never admitted: send it again.
        submit(p, true);
      } else if (code === "not_found") {
        fail(p, code, message);
      } else {
        p.nextReadAt = Date.now() + (retryAfter ?? 5) * 1000;
      }
      if (id) settleReads(id, { error });
      return;
    }
    if (id && reads.has(id)) {
      settleReads(id, { error });
      return;
    }
    // A cancel for a request that has already ended needs nothing; an error with no request is reported.
    if (!p) handlers.onError?.(error);
  };

  function tick() {
    const now = Date.now();
    for (const p of [...pending.values()]) {
      if (now >= p.giveUpAt) {
        fail(p, "timeout", "No result arrived by the request's deadline.");
        continue;
      }
      advance(p, now);
    }
    if (!pending.size) stopWatch();
  }

  const finish = (code: string, message: string) => {
    for (const p of [...pending.values()]) fail(p, code, message);
    for (const id of [...reads.keys()]) settleReads(id, { error: new GridNewsResearchError(code, message, { id }) });
    queuedReads.clear();
    stopWatch();
  };

  // ------------------------------------------------------------- connection

  const receive = (data: unknown) => {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      const type = item && typeof item === "object" ? (item as { type?: unknown }).type : undefined;
      // News items never carry a `type`; everything the server says back to the client does.
      if (typeof type !== "string") handlers.onMessage(item as T);
      else if (type.startsWith("research.")) onResearchReply(item as Record<string, unknown>);
      else handlers.onControl?.(item as StreamControlMessage);
    }
  };

  const onOpen = () => {
    // The filter changed while the connection was opening: send the one wanted now.
    if (filterKey(filter) !== openedWith) sendText(JSON.stringify(filterMessage(filter)));
    for (const p of [...pending.values()]) advance(p);
    for (const id of queuedReads) sendText(JSON.stringify({ type: "research.get", id }));
    queuedReads.clear();
  };

  const connect = () => {
    if (stopped) return;
    generation += 1;
    const current = generation;
    const url = new URL(options.wsUrl);
    // Browsers cannot set headers on WebSocket connections, so the key travels
    // as a query parameter on both platforms.
    url.searchParams.set("apiKey", options.apiKey);
    writeFilterParams(url, filter);
    openedWith = filterKey(filter);
    const ws = new WebSocketImpl(url.toString());
    socket = ws;

    ws.addEventListener("open", () => {
      if (current !== generation) return;
      open = true;
      reconnects = 0;
      handlers.onOpen?.();
      onOpen();
    });

    ws.addEventListener("message", (event) => {
      if (current !== generation) return;
      receive(event.data);
    });

    ws.addEventListener("error", (event) => {
      handlers.onError?.(event);
    });

    ws.addEventListener("close", ({ code, reason }) => {
      if (current !== generation) return;
      open = false;
      socket = undefined;
      for (const p of pending.values()) {
        p.submitOutstanding = false;
        p.readOutstanding = false;
        p.cancelSent = false;
      }
      for (const id of reads.keys()) queuedReads.add(id);
      handlers.onClose?.(code, reason);
      if (stopped) return;
      if (code === CLOSE_UNAUTHORIZED || reconnects >= options.maxReconnects) {
        finish("connection_closed", `The WebSocket closed (${code}${reason ? `: ${reason}` : ""}) and will not reconnect.`);
        return;
      }
      reconnects += 1;
      setTimeout(connect, Math.min(1000 * 2 ** (reconnects - 1), 10000));
    });
  };

  connect();

  return {
    subscribe(next) {
      if (stopped) throw new GridNewsError("This WebSocket was stopped.");
      const checked = checkFilter(next);
      // As on the server: a subscribe without a delay keeps the current one.
      filter = { ...checked, ...(checked.delay === undefined && filter?.delay !== undefined ? { delay: filter.delay } : {}) };
      sendText(JSON.stringify(filterMessage(filter)));
    },

    unsubscribe() {
      if (stopped) throw new GridNewsError("This WebSocket was stopped.");
      filter = undefined;
      sendText(JSON.stringify(filterMessage(undefined)));
    },

    research(request, researchOptions = {}) {
      if (stopped) throw new GridNewsError("This WebSocket was stopped.");
      const id = request.id ?? newResearchId();
      if (!RESEARCH_ID.test(id)) {
        throw new GridNewsError("A research id is 1-64 letters, digits, '.', '_', ':' or '-'.");
      }
      if (pending.has(id)) throw new GridNewsError(`Research request "${id}" is already running on this connection.`);
      const message = JSON.stringify({
        type: "research",
        id,
        query: request.query,
        urls: request.urls,
        mode: request.mode,
        domains: request.domains,
        sources: request.sources,
        depth: request.depth,
        questions: request.questions,
      });
      if (message.length > MAX_RESEARCH_MESSAGE_CHARS) {
        throw new GridNewsError(`A research request is at most ${MAX_RESEARCH_MESSAGE_CHARS} characters of JSON.`);
      }

      let resolve!: (result: ResearchResult) => void;
      let reject!: (error: GridNewsResearchError) => void;
      const result = new Promise<ResearchResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // Callers who only use onFrame must not see an unhandled rejection.
      result.catch(() => {});

      const p: PendingResearch = {
        id,
        message,
        depth: request.depth ?? "quick",
        onFrame: researchOptions.onFrame,
        resolve,
        reject,
        sentOn: 0,
        resubmitted: false,
        foreign: false,
        submitOutstanding: false,
        readOutstanding: false,
        accepted: false,
        cancelRequested: false,
        cancelSent: false,
        nextSeq: 0,
        early: new Map(),
        sources: new Map(),
        analyses: new Map(),
        lastProgress: Date.now(),
        lastRead: 0,
        nextReadAt: 0,
        giveUpAt: Infinity,
      };
      pending.set(id, p);
      ensureWatch();
      advance(p);

      return {
        id,
        result,
        cancel() {
          if (!pending.has(id) || p.cancelRequested) return;
          p.cancelRequested = true;
          if (p.sentOn === 0) {
            fail(p, "cancelled", "The request was cancelled before it was sent.");
            return;
          }
          advance(p);
        },
      };
    },

    getResearch(id) {
      if (stopped) return Promise.reject(new GridNewsError("This WebSocket was stopped."));
      if (!RESEARCH_ID.test(id)) {
        return Promise.reject(new GridNewsError("A research id is 1-64 letters, digits, '.', '_', ':' or '-'."));
      }
      return new Promise<ResearchFrame[]>((resolve, reject) => {
        const waiting = reads.get(id) ?? [];
        waiting.push({ resolve, reject });
        reads.set(id, waiting);
        // One read answers everyone waiting on it.
        if (waiting.length > 1) return;
        if (!sendText(JSON.stringify({ type: "research.get", id }))) queuedReads.add(id);
      });
    },

    stop() {
      if (!stopped) {
        stopped = true;
        finish("stopped", "The WebSocket was stopped.");
      }
      socket?.close(1000, "client stopped");
    },
  };
}

function newResearchId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return `sdk-${uuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`}`;
}

function checkFilter(filter: StreamSocketFilter): StreamSocketFilter {
  const list = (name: string, value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw new GridNewsError(`${name} must be an array of strings.`);
    }
    return value.length ? [...value] : undefined;
  };
  const { q, window, kind, delay } = filter;
  if (q !== undefined && typeof q !== "string") throw new GridNewsError("q must be a string.");
  if (window !== undefined && !(typeof window === "number" && Number.isFinite(window) && window > 0)) {
    throw new GridNewsError("window must be a positive number of hours.");
  }
  if (kind !== undefined && kind !== "article" && kind !== "press_release") {
    throw new GridNewsError('kind must be "article" or "press_release".');
  }
  if (delay !== undefined && !(typeof delay === "number" && Number.isFinite(delay) && delay >= 0)) {
    throw new GridNewsError("delay must be a non-negative number of milliseconds.");
  }
  const checked: StreamSocketFilter = {
    providers: list("providers", filter.providers),
    symbols: list("symbols", filter.symbols),
    q: q?.trim() || undefined,
    window,
    kind,
    delay,
  };
  for (const key of Object.keys(checked) as Array<keyof StreamSocketFilter>) {
    if (checked[key] === undefined) delete checked[key];
  }
  return checked;
}

function filterKey(filter: StreamSocketFilter | undefined): string {
  if (!filter) return "";
  const { providers, symbols, q, window, kind, delay } = filter;
  return JSON.stringify([providers, symbols, q, window, kind, delay]);
}

function filterMessage(filter: StreamSocketFilter | undefined): Record<string, unknown> {
  if (!filter) return { type: "unsubscribe" };
  const { delay, ...fields } = filter;
  return { type: "subscribe", filter: fields, ...(delay !== undefined ? { delay } : {}) };
}

/** The same filter as connect-time query parameters, so the first item is already filtered. */
function writeFilterParams(url: URL, filter: StreamSocketFilter | undefined) {
  if (!filter) return;
  for (const provider of filter.providers ?? []) url.searchParams.append("providers", provider);
  for (const symbol of filter.symbols ?? []) url.searchParams.append("symbols", symbol);
  if (filter.q !== undefined) url.searchParams.set("q", filter.q);
  if (filter.window !== undefined) url.searchParams.set("window", String(filter.window));
  if (filter.kind !== undefined) url.searchParams.set("kind", filter.kind);
  if (filter.delay !== undefined) url.searchParams.set("delay", String(filter.delay));
}
