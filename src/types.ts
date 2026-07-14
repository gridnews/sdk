/** News source attribution. */
export interface NewsSource {
  id: string;
  name: string;
}

/** A market news article pushed over the realtime stream. */
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

/** Reduced article shape emitted by the public delayed briefs stream. */
export interface ArticleBrief {
  id: string;
  title: string;
  publishedAt: string;
  source: NewsSource;
  symbols: string[];
  sectors: string[];
  industries: string[];
  sourceUrl: string;
}

/** Recognized press-release wire providers. */
export type PressReleaseProvider = "prnewswire" | "globenewswire" | "businesswire" | "other";

/** A press release pushed over the realtime stream. */
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

/** Press-release shape emitted by the public delayed briefs stream. */
export interface PressReleaseBrief extends StreamPressRelease {
  sourceUrl?: string;
  isDelayed?: boolean;
  company_name?: string;
  provider?: PressReleaseProvider;
  contentHash?: string;
  createdAt?: string;
  updatedAt?: string;
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

/** Filters accepted by the authenticated realtime SSE streams. */
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

/** Response of `GET /api/sentiment?ticker=` (live analysis; no envelope). */
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
