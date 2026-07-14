import type { HttpClient } from "../http.js";
import type {
  ApiEnvelope,
  SectorBreakdownsResult,
  SymbolSentimentParams,
  SymbolSentimentResult,
  TickerSentimentResult,
} from "../types.js";

export class SentimentResource {
  constructor(private readonly http: HttpClient) {}

  /** Aggregated sentiment for a symbol over a timeframe. Requires pro tier or above. */
  async bySymbol(symbol: string, params: SymbolSentimentParams = {}): Promise<SymbolSentimentResult> {
    const body = await this.http.get<ApiEnvelope<SymbolSentimentResult>>(
      `/api/query/sentiment/${encodeURIComponent(symbol)}`,
      {
        timeframe: params.timeframe,
        includeAnalysis: params.includeAnalysis,
      },
    );
    return body.data;
  }

  /**
   * Live sentiment analysis for a ticker. Requires pro tier or above.
   * This endpoint analyzes news on demand and can take noticeably longer
   * than other calls — consider raising `timeoutMs` if you use it.
   */
  async forTicker(ticker: string): Promise<TickerSentimentResult> {
    return this.http.get<TickerSentimentResult>("/api/sentiment", { ticker });
  }

  /** AI-generated per-sector market summaries. Requires basic tier or above. */
  async sectorBreakdowns(): Promise<SectorBreakdownsResult> {
    const body = await this.http.get<ApiEnvelope<SectorBreakdownsResult>>("/api/query/sector-breakdowns");
    return body.data;
  }
}
