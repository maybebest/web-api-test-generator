import type { ApiClient, ApiResult } from '../http/ApiClient';
import type {
  GeneratedExpertDto,
  GeneratedExpertsPageDto,
  GenerateExpertsRequestDto,
  GeneratedExpertUpdateDto,
  GenerationStateDto
} from '../dto/expert.dto';
import { environment } from '../../config/environments';

const API_VERSION = 'v2025-03-12';

/**
 * The expert generation service. It lives on its own host
 * (`environment.generationApiUrl`), so every path here is absolute; the
 * administrator bearer token from the main gateway is accepted as is.
 *
 * Trailing slashes are part of the contract: a request without one gets a
 * 301 redirect on which a DELETE silently does nothing.
 */
export class ExpertGenerationApi {
  constructor(private readonly client: ApiClient) {}

  private url(path: string): string {
    return `${environment.generationApiUrl}/${API_VERSION}${path}`;
  }

  /** Shared batch state: ready / in_process / completed. */
  state(quiet = false): Promise<ApiResult<GenerationStateDto>> {
    return this.client.get(this.url('/expert/state/'), { quiet });
  }

  /** Drafts waiting to be published. */
  list(quiet = false): Promise<ApiResult<GeneratedExpertsPageDto>> {
    return this.client.get(this.url('/expert/'), { quiet });
  }

  /** Starts a generation batch. A successful answer is a bare 201. */
  generate(body: GenerateExpertsRequestDto): Promise<ApiResult<void>> {
    return this.client.post(this.url('/expert/'), { data: body });
  }

  /** Edits a draft. Answers with the updated draft. */
  update(id: number | string, body: GeneratedExpertUpdateDto): Promise<ApiResult<GeneratedExpertDto>> {
    return this.client.patch(this.url(`/expert/${id}/`), { data: body });
  }

  /**
   * Turns drafts into live experts. The body key is literally `experts`.
   * A successful answer is a bare 200; the published drafts leave the list.
   */
  publish(ids: Array<number | string>): Promise<ApiResult<void>> {
    return this.client.post(this.url('/expert/publish/'), {
      data: { experts: ids }
    });
  }

  /** Deletes a draft that was never published. Answers 204. */
  remove(id: number | string): Promise<ApiResult<void>> {
    return this.client.delete(this.url(`/expert/${id}/`));
  }
}
