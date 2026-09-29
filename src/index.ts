export { GridNews, type GridNewsOptions } from "./client.js";
export { EventsResource } from "./resources/events.js";
export {
  GridNewsError,
  GridNewsAPIError,
  GridNewsAuthenticationError,
  GridNewsPermissionError,
  GridNewsRateLimitError,
  GridNewsConnectionError,
  GridNewsResearchError,
  type RateLimitInfo,
} from "./errors.js";
export type { SseSubscription } from "./streaming/sse.js";
export type {
  WebSocketSubscription,
  WebSocketConstructor,
  WebSocketHandlers,
  WebSocketLike,
  ResearchHandle,
  ResearchOptions,
} from "./streaming/websocket.js";
export type {
  ArticleStreamHandlers,
  PressReleaseStreamHandlers,
} from "./streaming/streams.js";
export * from "./types.js";

import { GridNews } from "./client.js";
export default GridNews;
