import type { HttpClient } from "../http.js";
import type {
  ApiEnvelope,
  SearchParams,
  SearchResult,
  SourcesResult,
  SymbolNewsParams,
  SymbolNewsResult,
  TopicsResult,
} from "../types.js";

export class NewsResource {
  constructor(private readonly http: HttpClient) {}

  /** Search articles (and optionally press releases). Requires an API key. */
  async search(params: SearchParams = {}): Promise<SearchResult> {
    const body = await this.http.get<ApiEnvelope<SearchResult>>("/api/query/search", {
      q: params.query,
      symbols: params.symbols,
      sources: params.sources,
      from: params.from,
      to: params.to,
      sentiment: params.sentiment,
      minQuality: params.minQuality,
      maxQuality: params.maxQuality,
      limit: params.limit,
      page: params.page,
      includePressReleases: params.includePressReleases,
    });
    return body.data;
  }

  /** News for a single ticker symbol. Requires an API key. */
  async bySymbol(symbol: string, params: SymbolNewsParams = {}): Promise<SymbolNewsResult> {
    const body = await this.http.get<ApiEnvelope<SymbolNewsResult>>(
      `/api/query/symbols/${encodeURIComponent(symbol)}`,
      {
        limit: params.limit,
        page: params.page,
        sentiment: params.sentiment,
        includePressReleases: params.includePressReleases,
      },
    );
    return body.data;
  }

  /** List available news sources. Requires an API key. */
  async sources(params: { limit?: number; page?: number } = {}): Promise<SourcesResult> {
    const body = await this.http.get<ApiEnvelope<SourcesResult>>("/api/query/sources", {
      limit: params.limit,
      page: params.page,
    });
    return body.data;
  }

  /** Trending topics. Works without an API key. */
  async topics(params: { limit?: number } = {}): Promise<TopicsResult> {
    const body = await this.http.get<ApiEnvelope<TopicsResult>>("/api/topics", {
      limit: params.limit,
    });
    return body.data;
  }
}
