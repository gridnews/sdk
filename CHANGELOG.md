# Changelog

## 0.2.0

- Add `events` resource: `list()` and `get()` over story clusters
- Clusters report `sourcesCount` (reach) and `independentVoices`
  (corroboration) separately; only the second is evidence, since outlets
  that redistribute each other collapse into one voice
- Each `sources` entry carries the `voiceKey` it resolved to and the signal
  that matched it, so a caller can see why N outlets counted as M voices

## 0.1.1

- Broaden npm keywords for search discoverability
- Add README badges (npm version, downloads, CI, license)

## 0.1.0

Initial release.

- REST: article search, symbol news, press releases, sentiment, quality analytics, sources, topics, usage
- Streaming: SSE article and press-release streams, broadcast WebSocket
- Typed errors with rate-limit info, retries, automatic stream reconnection
- Zero runtime dependencies; ESM + CJS; Node 18+ and browsers
