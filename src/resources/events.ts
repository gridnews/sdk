import type { HttpClient } from "../http.js";
import type {
  ApiEnvelope,
  EventDetailResult,
  EventListParams,
  EventListResult,
} from "../types.js";

/**
 * Story clusters: the same event as covered by several outlets.
 *
 * The unit here is the story rather than the document, which is what makes
 * these different from `news.search`. The number that matters is
 * `independentVoices` — see the note on {@link EventListParams.minVoices}.
 */
export class EventsResource {
  constructor(private readonly http: HttpClient) {}

  /** Story clusters, most corroborated first. Requires an API key. */
  async list(params: EventListParams = {}): Promise<EventListResult> {
    const body = await this.http.get<ApiEnvelope<EventListResult>>("/api/query/events", {
      symbols: params.symbols,
      from: params.from,
      to: params.to,
      hours: params.hours,
      minVoices: params.minVoices,
      type: params.type,
      orderBy: params.orderBy,
      limit: params.limit,
      page: params.page,
    });
    return body.data;
  }

  /**
   * One cluster with every outlet that carried it, grouped by independent
   * voice. Requires an API key.
   *
   * Event ids are not permanent: clusters are derived from the article and
   * press-release tables and are rebuilt as the clustering rules change, so
   * a stored id can 404 later. Re-resolve from {@link list} rather than
   * persisting ids long-term.
   */
  async get(eventId: string): Promise<EventDetailResult> {
    const body = await this.http.get<ApiEnvelope<EventDetailResult>>(
      `/api/query/events/${encodeURIComponent(eventId)}`,
    );
    return body.data;
  }
}
