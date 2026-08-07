import type { ApiClient, ApiResult } from '../http/ApiClient';
import type {
  AdminTherapistDetailDto,
  AdminTherapistPageDto,
  AdminTherapistUpdateDto,
  BrandDetailsDto,
  PublicExpertCardDto
} from '../dto/expert.dto';

/**
 * Published experts, as the administrator sees them. Construct with a client
 * bound to the administrator token (public catalog reads work without it).
 */
export class AdminExpertApi {
  constructor(private readonly client: ApiClient) {}

  /** Reference data of the generation form (genders, categories, ...). */
  dataForGenerate(brand: string): Promise<ApiResult<BrandDetailsDto>> {
    return this.client.get('/admin-v3/profile/therapist/data-for-generate', {
      params: { brand }
    });
  }

  /**
   * Text search across the expert list. `searchUser` matches names and
   * uuids; field filters like `firstName.contains` look supported but are
   * silently ignored by the service, so this is the one to use.
   */
  search(text: string, quiet = false): Promise<ApiResult<AdminTherapistPageDto>> {
    return this.client.get('/admin-v3/profile/therapist/all', {
      params: { searchUser: text, page: 0, size: 10 },
      quiet
    });
  }

  getTherapist(uuid: string): Promise<ApiResult<AdminTherapistDetailDto>> {
    return this.client.get(`/admin-v3/profile/therapist/${uuid}`);
  }

  /**
   * Edits a published expert (name, price, ...). A successful answer is a
   * bare 200 with an empty body, so the change must be proven by reading the
   * profile again.
   */
  updateTherapist(uuid: string, body: AdminTherapistUpdateDto): Promise<ApiResult<void>> {
    return this.client.patch(`/admin-v3/profile/therapist/${uuid}`, { data: body });
  }

  /** Soft-deletes experts (their status becomes DELETED). */
  deleteTherapists(uuids: string[], cause: string): Promise<ApiResult<void>> {
    return this.client.delete('/admin-v3/profile/therapist/delete', {
      data: { uuids, cause }
    });
  }

  /**
   * Rebuilds the public expert catalog. The catalog the site shows is a
   * cache that does NOT pick up published or deleted experts on its own —
   * without this call a new expert stays invisible to users.
   */
  refreshPublicCatalog(quiet = false): Promise<ApiResult<void>> {
    return this.client.post('/admin-v3/cache/refresh', {
      params: { req: 'search_expert_all' },
      quiet
    });
  }

  /**
   * Copies the given experts' profile data into the search/catalog tables.
   * A freshly published expert has no row there yet, and the catalog
   * rebuild reads from these tables — so without this call the rebuild
   * produces a catalog without the newcomer.
   */
  syncExpertDetail(uuids: string[], quiet = false): Promise<ApiResult<void>> {
    return this.client.post('/admin-v3/sync/expert-detail', {
      data: uuids,
      quiet
    });
  }

  /** Public list of the user-facing catalog cache. */
  publicCatalog(quiet = false): Promise<ApiResult<PublicExpertCardDto[]>> {
    return this.client.get('/profile/cache/experts/all', {
      params: { locale: 'en' },
      quiet
    });
  }
}
