import type { HttpClient } from "../http.js";
import type { ApiEnvelope, PressReleaseListParams, PressReleaseListResult } from "../types.js";

export class PressReleasesResource {
  constructor(private readonly http: HttpClient) {}

  /** List press releases with optional symbol/provider/company filters. Requires an API key. */
  async list(params: PressReleaseListParams = {}): Promise<PressReleaseListResult> {
    const body = await this.http.get<ApiEnvelope<PressReleaseListResult>>("/api/query/press-releases", {
      symbols: params.symbols,
      providers: params.providers,
      companies: params.companies,
      from: params.from,
      to: params.to,
      limit: params.limit,
      page: params.page,
    });
    return body.data;
  }
}
