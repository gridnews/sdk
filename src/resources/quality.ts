import type { HttpClient } from "../http.js";
import type {
  ApiEnvelope,
  QualityArticlesResult,
  QualityBreakdownResult,
  QualityRange,
  QualityStatsResult,
} from "../types.js";

export class QualityResource {
  constructor(private readonly http: HttpClient) {}

  /** Aggregate quality statistics. Requires basic tier or above. */
  async stats(params: { days?: number } = {}): Promise<QualityStatsResult> {
    const body = await this.http.get<ApiEnvelope<QualityStatsResult>>("/api/quality/stats", {
      days: params.days,
    });
    return body.data;
  }

  /**
   * Articles in a quality band. Requires basic tier or above.
   * Note: this endpoint paginates with `offset`, not `page`.
   */
  async articles(
    range: QualityRange,
    params: { limit?: number; offset?: number } = {},
  ): Promise<QualityArticlesResult> {
    const body = await this.http.get<ApiEnvelope<QualityArticlesResult>>(
      `/api/quality/articles/${encodeURIComponent(range)}`,
      { limit: params.limit, offset: params.offset },
    );
    return body.data;
  }

  /** Full quality analysis for one article or press release. Requires pro tier or above. */
  async breakdown(articleId: string): Promise<QualityBreakdownResult> {
    const body = await this.http.get<ApiEnvelope<QualityBreakdownResult>>(
      `/api/quality/breakdown/${encodeURIComponent(articleId)}`,
    );
    return body.data;
  }
}
