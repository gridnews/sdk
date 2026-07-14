# GridNews SDK

The official TypeScript SDK for the [GridNews](https://gridnews.io) API. Fully-typed access to market news articles, press releases, sentiment analysis, and real-time streaming.

## Features

- 🔎 Article search with symbol, source, date, sentiment, and quality filters
- 📰 Press-release listing by symbol, provider, or company
- 📈 Symbol sentiment and live ticker analysis
- 🔌 Real-time streaming via Server-Sent Events and WebSocket
- 🔁 Built-in retries and automatic stream reconnection
- 🔐 API key authentication with typed rate-limit errors
- ✅ Strong TypeScript types, zero runtime dependencies, works in Node 18+ and browsers

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

// Live on-demand analysis (pro tier+; slower — analyzes news at request time)
const live = await client.sentiment.forTicker("TSLA");

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

## Real-Time Streaming

### SSE article stream (pro tier+)

```ts
const subscription = client.stream.articles(
  { symbols: ["AAPL", "NVDA"], search: "earnings" },
  {
    onConnected: (info) => console.log("Connected:", info.tier),
    onArticle: (article) => console.log("Live:", article.title),
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

The WebSocket is a broadcast feed — every article and press release as it is published, with no server-side filtering (filter client-side):

```ts
const ws = client.stream.websocket({
  onMessage: (payload) => console.log(payload.title),
  onClose: (code, reason) => console.log("Closed:", code, reason),
});

// Later:
ws.stop();
```

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
| Real-time SSE streams & WebSocket | Pro+ |

## Support

- Bug reports: [github.com/gridnews/issues](https://github.com/gridnews/issues)

## License

MIT
