# GridNews SDK

[![npm version](https://img.shields.io/npm/v/@gridnews/sdk.svg)](https://www.npmjs.com/package/@gridnews/sdk)
[![npm downloads](https://img.shields.io/npm/dm/@gridnews/sdk.svg)](https://www.npmjs.com/package/@gridnews/sdk)
[![CI](https://github.com/gridnews/sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/gridnews/sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/@gridnews/sdk.svg)](LICENSE)

The official TypeScript SDK for the [GridNews](https://gridnews.io) API. Fully-typed access to the latest market news articles, press releases, sentiment analysis, and streaming.

## Features

- Article search with symbol, source, date, sentiment, and quality filters
- Press-release listing by symbol, provider, or company
- Symbol sentiment and on-demand ticker analysis
- Breaking articles and press releases streamed via Server-Sent Events and WebSocket, filtered on the server
- Grid AI research over the WebSocket: sources, cited excerpts and analysis as they are ready
- Built-in retries and automatic stream reconnection
- API key authentication with typed rate-limit errors
- Strong TypeScript types, zero runtime dependencies, works in Node 18+ and browsers

## Installation

```bash
npm install @gridnews/sdk
```

## Quick Start

```ts
import { GridNews } from "@gridnews/sdk";

const client = new GridNews({ apiKey: "your-api-key" });

const { articles, pagination } = await client.news.search({
  query: "earnings",
  symbols: ["AAPL", "TSLA"],
  limit: 10,
});

console.log(pagination.total, articles);
```

Get an API key at [gridnews.io](https://gridnews.io).

## REST API

### Search articles

```ts
const result = await client.news.search({
  query: "acquisition",        // Free-text query (max 200 chars)
  symbols: ["NVDA"],           // Ticker filter (basic tier+)
  sources: ["prnewswire"],     // Source filter (basic tier+)
  from: "2026-01-01",          // Date range (basic tier+)
  to: "2026-06-30",
  sentiment: "positive",       // Sentiment filter (pro tier+)
  minQuality: 0.5,             // Quality score bounds (0–1)
  limit: 20,                   // Clamped to your tier's max
  page: 1,
  includePressReleases: true,
});
```

Note: `pagination.total` is an estimate for text searches. The server clamps `limit` to your tier's maximum — read back `pagination.limit` for the applied value.

### News for a symbol

```ts
const { articles, sentiment } = await client.news.bySymbol("AAPL", {
  limit: 10,
  sentiment: "positive", // pro tier+
});
```

### Story clusters (events)

An event is one story as covered by several outlets, rather than a single
document.

```ts
const { events } = await gridnews.events.list({
  minVoices: 2,      // corroborated stories only
  hours: 24,
  limit: 10,
});

for (const e of events) {
  console.log(`${e.independentVoices} voices (${e.sourcesCount} outlets): ${e.summary}`);
}

const detail = await gridnews.events.get(events[0].id);
for (const v of detail.voices) {
  console.log(`${v.voiceKey}: ${v.outlets.join(", ")}`);
}
```

**`sourcesCount` is reach. `independentVoices` is corroboration.** They are
different numbers and only the second is evidence. Outlets that redistribute
each other collapse into one voice, so a story carried by five outlets that
are all running the same wire copy reports one voice, not five. Each entry in
`sources` carries the `voiceKey` it resolved to, so you can see why.

A `press_release` event is one issuer's announcement carried by N
distributors; it always reports a single voice however wide its reach.

There is no `minVoices` default. Single-voice clusters are real distribution
records and are not hidden — they simply sort last, because `impactScore` is
driven by `log2(1 + independentVoices)`.

Event ids are not permanent. Clusters are derived and get rebuilt as the
clustering rules change, so re-resolve from `list()` rather than storing ids
long-term.

### Press releases

```ts
const { pressReleases } = await client.pressReleases.list({
  symbols: ["MSFT"],
  providers: ["businesswire"],
  from: "2026-06-01",
});
```

### Sentiment

```ts
// Aggregated sentiment over a timeframe (pro tier+)
const daily = await client.sentiment.bySymbol("TSLA", { timeframe: "24h" });

// On-demand analysis (pro tier+; slower — analyzes news at request time)
const analysis = await client.sentiment.forTicker("TSLA");

// AI sector summaries (basic tier+)
const sectors = await client.sentiment.sectorBreakdowns();
```

### Quality analytics

```ts
const stats = await client.quality.stats({ days: 7 });          // basic tier+
const high = await client.quality.articles("high", { limit: 10, offset: 0 }); // basic tier+
const detail = await client.quality.breakdown("article-id");    // pro tier+
```

### Sources, topics, usage

```ts
const { sources } = await client.news.sources({ limit: 50 });
const { topics } = await client.news.topics();   // works without an API key
const usage = await client.usage();              // your tier, limits, usage today
```

## Streaming

### SSE article stream (pro tier+)

```ts
const subscription = client.stream.articles(
  { symbols: ["AAPL", "NVDA"], search: "earnings" },
  {
    onConnected: (info) => console.log("Connected:", info.tier),
    onArticle: (article) => console.log("Breaking:", article.title),
    onError: (error) => console.error(error),
  },
);

// Later:
subscription.stop();
```

### SSE press-release stream (pro tier+)

```ts
client.stream.pressReleases(
  { providers: ["prnewswire"] },
  { onPressRelease: (pr) => console.log(pr.title) },
);
```

### WebSocket (pro tier+)

The WebSocket carries articles and press releases as they are published. Give it a filter and the server applies it from the first item; change it at any time without reconnecting:

```ts
const ws = client.stream.websocket(
  {
    onMessage: (item) => console.log(item.title),
    onControl: (reply) => console.log(reply.type), // "subscribed", "unsubscribed" or "error"
    onClose: (code, reason) => console.log("Closed:", code, reason),
  },
  { filter: { symbols: ["AAPL", "NVDA"], kind: "article" } },
);

ws.subscribe({ symbols: ["TSLA"], q: "recall", delay: 30000 }); // replaces the filter
ws.unsubscribe();                                                // back to every item

// Later:
ws.stop();
```

Filters take `providers`, `symbols`, `q` (free text), `window` (hours), `kind` (`"article"` or `"press_release"`) and `delay` (milliseconds; left out of a `subscribe()`, the current delay is kept). After a reconnect the SDK opens the new connection with the filter you last asked for.

### Grid AI research over the WebSocket (pro tier+)

The same connection runs Grid AI research: send a question, or up to 8 document URLs, and the sources, cited excerpts and analysis come back on the socket as they are ready.

```ts
const job = ws.research(
  { query: "Why did the chip export rules change?", depth: "deep", sources: 6 },
  { onFrame: (frame) => console.log(frame.type) },
);

const result = await job.result;
for (const source of result.sources) console.log(source.citation, source.title, source.url);
for (const analysis of result.analyses) {
  for (const finding of analysis.findings) console.log(finding.kind, finding.text);
}
```

- `depth: "quick"` (default) reads the sources and returns excerpts. `depth: "deep"` also compares them and answers up to 3 `questions`; it needs at least 3 sources, or 2 different `urls`, and a deep request that does not reach enough evidence ends with `analysisSkipped` rather than a thin answer.
- Research never reaches `onMessage`, and the filter and delay do not apply to it. Frames go to the request's `onFrame` and to the connection's `onResearch` handler, in order and once each.
- If the connection drops mid-request, the SDK reconnects and reads the request's frames back until it finishes; nothing is sent twice.
- `job.cancel()` stops a request. `ws.getResearch(id)` returns the frames of any request this API key made in the last hour.
- A request that ends without a result rejects with `GridNewsResearchError`. Its `code` is the server's (`busy`, `rate_limited`, `invalid_request`, `cancelled`, ...) or `timeout`, `stopped` or `connection_closed`, and `retryAfter` says how long to wait when the server said. Sources that arrived before the end are kept on the error.

Each API key may run 2 requests at once on Pro and 4 on Business, and send 10 a minute. Research also counts against the key's Grid AI allowance.

On Node 18–21 (no global `WebSocket`), pass an implementation:

```ts
import { WebSocket } from "ws";

const client = new GridNews({ apiKey: "key", webSocketImpl: WebSocket });
```

## Configuration

```ts
const client = new GridNews({
  apiKey: "your-api-key",                  // Optional; public endpoints work without it
  baseUrl: "https://api.gridnews.io",      // REST base URL
  streamUrl: "https://stream.gridnews.io", // SSE base URL
  wsUrl: "wss://stream.gridnews.io",       // WebSocket URL
  timeoutMs: 15000,                        // Per-request timeout
  retries: 2,                              // Retries on network errors / 429 / 5xx
  maxStreamReconnects: 10,                 // Stream reconnect attempts
});
```

## Error Handling

All API errors are typed subclasses of `GridNewsError`:

```ts
import {
  GridNewsAuthenticationError, // 401 — missing/invalid API key
  GridNewsPermissionError,     // 403 — endpoint needs a higher tier
  GridNewsRateLimitError,      // 429 — rate limit exceeded
  GridNewsAPIError,            // any other non-2xx
  GridNewsConnectionError,     // network failure / timeout
  GridNewsResearchError,       // a WebSocket research request ended without a result
} from "@gridnews/sdk";

try {
  await client.news.search({ query: "fed" });
} catch (error) {
  if (error instanceof GridNewsRateLimitError) {
    console.log("Resets at:", error.rateLimit.reset);
  } else if (error instanceof GridNewsPermissionError) {
    console.log("Upgrade required:", error.body);
  } else {
    throw error;
  }
}
```

Rate-limit state is also available on every `GridNewsAPIError` via `error.rateLimit` (`limit`, `remaining`, `reset`, `tier`), parsed from the `X-RateLimit-*` response headers.

## Tier Requirements

| Capability | Tier |
| --- | --- |
| Topics, health/status | No key required |
| Article search, symbol news, sources, press releases, usage | Any key |
| Advanced search filters (symbols/sources/dates) | Basic+ |
| Quality stats & quality-band articles, sector breakdowns | Basic+ |
| Sentiment (all endpoints), quality breakdown | Pro+ |
| Breaking-news SSE streams & WebSocket | Pro+ |
| Grid AI research over the WebSocket | Pro+ |

## Support

- Bug reports: [github.com/gridnews/issues](https://github.com/gridnews/issues)

## License

MIT
