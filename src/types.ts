/** News source attribution. */
export interface NewsSource {
  id: string;
  name: string;
}

/** A market news article pushed over the news stream. */
export interface StreamArticle {
  id: string;
  title: string;
  description?: string;
  sourceUrl: string;
  contentHash?: string;
  publishedAt: string;
  source: NewsSource;
  symbols: string[];
  sectors: string[];
  industries: string[];
  aiProcessingUsed?: boolean;
  qualityScore?: number;
}

/** Recognized press-release wire providers. */
export type PressReleaseProvider = "prnewswire" | "globenewswire" | "businesswire" | "other";

/** A press release pushed over the news stream. */
export interface StreamPressRelease {
  id: string;
  title: string;
  content?: string;
  link?: string;
  date?: string;
  publishedAt?: string;
  source: NewsSource | string;
  symbols: string[];
  sectors: string[];
  industries: string[];
  aiProcessingUsed?: boolean;
  qualityScore?: number;
  event?: "press_release";
}

/** Any payload the broadcast WebSocket can push. */
export type WirePayload = StreamArticle | StreamPressRelease;

/** First event emitted after an authenticated SSE stream connects. */
export interface StreamConnectedEvent {
  message: string;
  tier: string;
  delay: number;
  filters: {
    providers?: string[];
    symbols?: string[];
    search?: string;
  };
}

/** Filters accepted by the authenticated SSE streams. */
export interface StreamFilterParams {
  /** Match against source ids/names, e.g. `["prnewswire"]`. */
  providers?: string[];
  /** Ticker symbols, e.g. `["AAPL", "TSLA"]`. */
  symbols?: string[];
  /** Free-text search over title/description. */
  search?: string;
  /** Artificial delay in milliseconds before events are delivered. */
  delay?: number;
}

/**
 * What the WebSocket delivers: applied when the connection opens (so nothing
 * arrives unfiltered first), changed with `subscribe()`, cleared with
 * `unsubscribe()`, and re-applied after a reconnect.
 */
export interface StreamSocketFilter {
  /** Match against source ids/names, e.g. `["prnewswire"]`. */
  providers?: string[];
  /** Ticker symbols, e.g. `["AAPL", "TSLA"]`. */
  symbols?: string[];
  /** Free-text search over title/description. */
  q?: string;
  /** Only items published within this many hours. */
  window?: number;
  /** Only articles or only press releases. Omit for both. */
  kind?: "article" | "press_release";
  /**
   * Delivery delay in milliseconds. Left out of a `subscribe()`, the current
   * delay is kept.
   */
  delay?: number;
}

/** The server's answers to `subscribe()` and `unsubscribe()`. */
export type StreamControlMessage =
  | {
      type: "subscribed";
      /** The filter as the server normalized it. */
      filter: Omit<StreamSocketFilter, "delay">;
      delay: number;
    }
  | { type: "unsubscribed" }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Grid AI research over the WebSocket
// ---------------------------------------------------------------------------

/**
 * A Grid AI research request (pro tier+). Give `urls` to read those
 * documents, or leave them out to search. `depth: "deep"` compares the
 * documents and answers `questions`; it needs at least 3 sources (or 2
 * different URLs) and takes longer.
 */
export interface ResearchRequest {
  /**
   * Your id for the request: 1-64 letters, digits, `.`, `_`, `:` or `-`,
   * unique per API key for an hour. Generated when omitted.
   */
  id?: string;
  /** What to research, 3-300 characters. */
  query: string;
  /** Up to 8 public http(s) document URLs to read instead of searching. */
  urls?: string[];
  /** Search the web or news. Default `"web"`. */
  mode?: "web" | "news";
  /** Up to 5 domains to search within, e.g. `["sec.gov"]`. */
  domains?: string[];
  /** How many search results to read, 1-8. Default 4 (quick) or 6 (deep). */
  sources?: number;
  /** Default `"quick"`. */
  depth?: "quick" | "deep";
  /** Up to 3 questions for a deep request. Default: the query. */
  questions?: string[];
}

export interface ResearchExcerpt {
  excerptId: string;
  quote: string;
  /** Character offsets of the quote in the retrieved document. */
  start: number;
  end: number;
  score: number;
}

export interface ResearchSource {
  sourceId: string;
  citation: number;
  url: string;
  title: string;
  domain: string;
  publishedAt: string | null;
  dateBasis: "archive" | "provider" | "page" | "unknown";
  /** `"clearing"`: an access check was still being worked on when the source was sent. */
  status: "retrieved" | "failed" | "duplicate" | "clearing" | "discovered";
  failure?: string;
  kind?: "release";
  retrievedAt?: string;
  contentHash?: string;
  truncated?: boolean;
  duplicateOf?: string;
  excerpts: ResearchExcerpt[];
}

export interface ResearchAnalysis {
  analysisId: string;
  question: string;
  method: "extractive" | "generated";
  model: string | null;
  findings: Array<{ id: string; kind: "observation" | "inference"; text: string; excerptIds: string[] }>;
  connections: Array<{
    id: string;
    relationship: "agreement" | "tension" | "dependency" | "context";
    text: string;
    excerptIds: string[];
  }>;
  gaps: string[];
  /** The passages the findings and connections cite, and only those. */
  excerpts: Array<ResearchExcerpt & { sourceId: string }>;
  /** `"pending"` is followed by another analysis frame with the same `analysisId`. */
  generation?: { status: "pending" | "complete" | "failed" | "superseded" | "expired"; reason?: string };
  support?: { threshold: number; checked: number; removed: number };
  warnings: string[];
}

export interface ResearchCounts {
  sources: number;
  retrieved: number;
  failed: number;
  clearing: number;
  excerpts: number;
  analyses: number;
}

interface ResearchFrameBase {
  id: string;
  /** Position in the request's frames, from 0. The SDK delivers them in order, once each. */
  seq: number;
}

export type ResearchAcceptedFrame = ResearchFrameBase & {
  type: "research.accepted";
  depth: "quick" | "deep";
  sources: number;
  questions: number;
  deadlineAt: string;
};

export type ResearchSourceFrame = ResearchFrameBase & {
  type: "research.source";
  runId: string;
  source: ResearchSource;
};

export type ResearchAnalysisFrame = ResearchFrameBase & {
  type: "research.analysis";
  runId: string;
  analysis: ResearchAnalysis;
};

export type ResearchDoneFrame = ResearchFrameBase & {
  type: "research.done";
  runId: string | null;
  /** `"partial"`: the deadline or a failure ended it early; what was sent stands. */
  status: "complete" | "partial";
  counts: ResearchCounts;
  /** Set when a deep request did not reach its minimums and no analysis was attempted. */
  analysis?: { status: "skipped"; reason: "insufficient_evidence" };
  warnings: string[];
  durationMs: number;
};

export type ResearchErrorFrame = ResearchFrameBase & {
  type: "research.error";
  code: string;
  message: string;
  retryAfter?: number;
  terminal: boolean;
};

/** One step of a research request, as the server sends it. */
export type ResearchFrame =
  | ResearchAcceptedFrame
  | ResearchSourceFrame
  | ResearchAnalysisFrame
  | ResearchDoneFrame
  | ResearchErrorFrame;

/** A finished research request: every source and the latest version of every analysis. */
export interface ResearchResult {
  id: string;
  runId: string | null;
  status: "complete" | "partial";
  depth: "quick" | "deep";
  /** In citation order. */
  sources: ResearchSource[];
  analyses: ResearchAnalysis[];
  counts: ResearchCounts;
  /** Set when a deep request did not reach its minimums and no analysis was attempted. */
  analysisSkipped?: { status: "skipped"; reason: "insufficient_evidence" };
  warnings: string[];
  durationMs: number;
}

/** Response of `GET /api/health` on either service. */
export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

/** Response of `GET /api/status`. */
export interface StatusResponse {
  status: string;
  service: string;
  version?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// REST API (api.gridnews.io)
// ---------------------------------------------------------------------------

export type Tier = "free" | "basic" | "pro" | "enterprise";

export type Sentiment = "positive" | "negative" | "neutral";

/** An article row returned by the REST query endpoints. */
export interface Article {
  id: string;
  title: string;
  description?: string;
  sourceUrl: string;
  sourceId?: string;
  sourceName: string;
  publishedAt: string;
  symbols: string[];
  sectors?: string[];
  industries?: string[];
  qualityScore?: number;
  sentiment?: string;
}

/** Page-based pagination block returned by most list endpoints. */
export interface Pagination {
  limit: number;
  /** Estimated for text search; exact for sources/press-releases. */
  total: number;
  page: number;
  pages?: number;
}

/** Date-history caps applied by the server for the key's tier. */
export interface HistoryLimits {
  maxHistoryDays?: number;
  appliedDateFilter?: { from?: string; to?: string } | null;
}

export interface SearchParams {
  /** Free-text query, max 200 characters. */
  query?: string;
  /** Ticker symbols. Requires basic tier or above. */
  symbols?: string[];
  /** Source ids/names. Requires basic tier or above. */
  sources?: string[];
  /** ISO date lower bound. Requires basic tier or above. */
  from?: string;
  /** ISO date upper bound. Requires basic tier or above. */
  to?: string;
  /** Sentiment filter. Requires pro tier or above. */
  sentiment?: Sentiment;
  /** Minimum quality score, 0–1. */
  minQuality?: number;
  /** Maximum quality score, 0–1. */
  maxQuality?: number;
  /** Results per page. Silently clamped to the tier maximum by the server. */
  limit?: number;
  page?: number;
  /** Include press releases in results (default true). */
  includePressReleases?: boolean;
}

export interface SearchResult {
  articles: Article[];
  pagination: Pagination;
  query: Record<string, unknown>;
  tier?: Tier;
  features?: string[];
  historyLimits?: HistoryLimits;
}

export interface SymbolNewsParams {
  limit?: number;
  page?: number;
  /** Requires pro tier or above. */
  sentiment?: Sentiment;
  includePressReleases?: boolean;
}

export interface SentimentBreakdown {
  positive: number;
  negative: number;
  neutral: number;
}

export interface SymbolNewsResult {
  symbol: string;
  articles: Article[];
  pagination: Pagination;
  sentiment?: {
    overall: string;
    score: number;
    confidence: number;
    breakdown: SentimentBreakdown;
  };
  includePressReleases?: boolean;
  historyLimits?: HistoryLimits;
}

export interface SymbolSentimentParams {
  /** e.g. "24h". Defaults to "24h" server-side. */
  timeframe?: string;
  includeAnalysis?: boolean;
}

export interface SymbolSentimentResult {
  symbol: string;
  sentiment: unknown;
  breakdown?: SentimentBreakdown;
  analysis?: unknown;
  metadata?: {
    timeframe?: string;
    articlesAnalyzed?: number;
    relevantArticles?: number;
    sources?: string[];
    lastUpdated?: string;
    insufficientData?: boolean;
    message?: string;
  };
}

export interface SourceInfo {
  id: string;
  name: string;
  category?: string;
  type?: "article" | "press_release" | "both";
  description?: string;
}

export interface SourcesResult {
  sources: SourceInfo[];
  pagination: Pagination;
}

export interface UsageResult {
  tier: Tier;
  limits: {
    dailyRequests: number;
    requestsPerSecond: number;
    features: string[];
  };
  usage: {
    requestsToday: number;
    remainingToday: number;
    resetTime: string | number;
  };
}

export interface SectorBreakdownsResult {
  sectors: Record<string, string>;
  marketSession?: string;
  generatedAt?: string;
  cached?: boolean;
  cacheAge?: number;
  stale?: boolean;
}

export interface PressReleaseListParams {
  symbols?: string[];
  providers?: string[];
  /** Company-name filters; each must be at least 3 characters. */
  companies?: string[];
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}

/** A press-release row returned by the REST list endpoint. */
export interface PressRelease {
  id: string;
  title: string;
  content?: string;
  link?: string;
  date?: string;
  publishedAt?: string;
  source?: string | NewsSource;
  symbols?: string[];
  sectors?: string[];
  industries?: string[];
  company_name?: string;
  provider?: PressReleaseProvider;
  qualityScore?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PressReleaseListResult {
  pressReleases: PressRelease[];
  pagination: Pagination;
  query?: Record<string, unknown>;
}

export type QualityRange = "high" | "medium" | "low" | "very_low";

export interface QualityStatsResult {
  period?: string;
  overall?: {
    totalArticles: number;
    averageQuality: number;
    minQuality: number;
    maxQuality: number;
  };
  qualityDistribution?: Array<{ range: string; count: number }>;
  aiProcessing?: { withAI: number; withoutAI: number };
  sourceQuality?: Array<{ source: string; averageQuality: number; articleCount: number }>;
  trends?: Array<{ date: string; averageQuality: number; articleCount: number }>;
}

export interface QualityArticlesResult {
  articles: Array<{
    id: string;
    title: string;
    sourceName: string;
    publishedAt: string;
    qualityScore: number;
    qualityReasons?: string[];
    aiProcessingUsed?: boolean;
    symbols?: string[];
  }>;
  pagination: {
    total: number;
    limit: number;
    offset: number;
    qualityRange?: { min: number; max: number; label: string };
  };
}

export interface QualityBreakdownResult {
  article: {
    id: string;
    title: string;
    description?: string;
    sourceName?: string;
    sourceId?: string;
    publishedAt?: string;
    symbols?: string[];
    sectors?: string[];
    industries?: string[];
    isPressRelease?: boolean;
  };
  qualityAnalysis: {
    overall: number;
    breakdown?: Record<string, number>;
    reasons?: string[];
    aiProcessingUsed?: boolean;
  };
}

/** Response of `GET /api/sentiment?ticker=` (on-demand analysis; no envelope). */
export interface TickerSentimentResult {
  sentiment: { label: string; score: number };
  marketSentiment?: { bias: string; confidence: number; breakdown?: SentimentBreakdown };
  newsAnalysis?: Array<{
    title: string;
    summary?: string;
    relevanceScore?: number;
    sentiment?: string;
    date?: string;
    source?: string;
  }>;
  sources?: string[];
  totalArticles?: number;
  relevantArticles?: number;
  companyInfo?: { name: string; symbol: string; sector?: string; industry?: string } | null;
}

export interface TopicsResult {
  topics: unknown[];
  generatedAt?: string;
  message?: string;
}

/** Standard envelope on `/api/query/*`, `/api/quality/*`, and `/api/topics`. */
export interface ApiEnvelope<T> {
  status: string;
  data: T;
  tier?: Tier;
  features?: string[];
}

// ---------------------------------------------------------------------------
// Story clusters (events)
// ---------------------------------------------------------------------------

/** How a member outlet was matched into a cluster. */
export type EventJoinReason =
  | "seed"
  | "content_hash"
  | "title_similarity"
  | "semantic_similarity";

/** One outlet's coverage of an event. */
export interface EventSource {
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string;
  /**
   * The independent voice this outlet speaks with. Equal to `sourceId`
   * unless it was carrying another member's copy — which is what lets you
   * see *why* five outlets counted as two voices.
   */
  voiceKey: string;
  /**
   * Which signal attached this outlet. A cluster built from `content_hash`
   * matches is a stronger claim than one built from headline similarity.
   */
  joinedVia: EventJoinReason;
  articleId?: string;
  pressReleaseId?: string;
}

/** A story, as covered by one or more outlets. */
export interface NewsEvent {
  id: string;
  summary: string;
  description?: string;
  /**
   * `press_release` clusters are one issuer's announcement carried by N
   * distributors, so they always report a single voice however wide their
   * reach.
   */
  type: "article" | "press_release";
  /** Id of the article or press release the cluster was seeded from. */
  rootId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Member documents, including repeat filings from one outlet. */
  entriesCount: number;
  /** Distinct outlets. This is reach, not evidence. */
  sourcesCount: number;
  /**
   * Distinct outlets that were not redistributing each other. THIS is the
   * corroboration signal. On a typical corpus only a small minority of
   * clusters exceed 1, so treating `sourcesCount` as confirmation
   * overstates it badly.
   */
  independentVoices: number;
  /** log2(1 + independentVoices) x source reputation. Not time-decayed. */
  impactScore: number;
  /** Mean reputation of the member outlets, 0-1. */
  sourceReputation: number;
  symbols: string[];
  sectors: string[];
  industries: string[];
  /** Member outlets. Truncated to a preview in list responses. */
  sources: EventSource[];
}

export interface EventListParams {
  /** Ticker symbols. Requires basic tier or above. */
  symbols?: string[];
  /** ISO date lower bound on `lastSeenAt`. Requires basic tier or above. */
  from?: string;
  /** ISO date upper bound on `lastSeenAt`. Requires basic tier or above. */
  to?: string;
  /** Convenience window in hours, applied on top of any `from`. */
  hours?: number;
  /**
   * Minimum independent voices. There is no default: single-voice clusters
   * are real distribution records and are not hidden, they simply sort last
   * because impact is driven by voice count. Pass 2 for corroborated
   * stories only.
   */
  minVoices?: number;
  /** Restrict to journalism or to wire releases. Default: all. */
  type?: "all" | "article" | "press_release";
  /**
   * Sort field, `-` prefix for descending. Default `-impactScore`.
   * Restricted to indexed columns.
   */
  orderBy?:
    | "impactScore"
    | "-impactScore"
    | "lastSeenAt"
    | "-lastSeenAt"
    | "firstSeenAt"
    | "-firstSeenAt"
    | "sourcesCount"
    | "-sourcesCount"
    | "independentVoices"
    | "-independentVoices";
  limit?: number;
  page?: number;
}

export interface EventListResult {
  events: NewsEvent[];
  /** Unlike the article endpoints, `total` here is exact. */
  pagination: Pagination;
  query: Record<string, unknown>;
  tier?: Tier;
  historyLimits?: HistoryLimits;
}

/** Outlets grouped by the independent voice they speak with. */
export interface EventVoice {
  voiceKey: string;
  outlets: string[];
}

export interface EventDetailResult {
  event: NewsEvent;
  voices: EventVoice[];
  /** Maximum members the detail endpoint will return. */
  memberCap: number;
}
