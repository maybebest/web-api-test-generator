import type { ApiClient, ApiResult } from '../http/ApiClient';
import type { HoroscopeDataRequestDto, UpdateUserRequestDto, UserProfileDto } from '../dto/user.dto';
import type { UserCategoriesDto } from '../dto/booking.dto';

/**
 * The user's own profile endpoints. Construct with a token-bound client
 * (`api.withToken(user.accessToken)`).
 */
export class UserApi {
  constructor(private readonly client: ApiClient) {}

  getProfile(): Promise<ApiResult<UserProfileDto>> {
    return this.client.get('/profile/user');
  }

  updateProfile(body: UpdateUserRequestDto): Promise<ApiResult<UserProfileDto>> {
    return this.client.put('/profile/user', { data: body });
  }

  submitHoroscopeData(body: HoroscopeDataRequestDto): Promise<ApiResult<void>> {
    return this.client.post('/profile/horoscope/data/user', { data: body });
  }

  /** Questionnaire reference data used when the user chooses an expert. */
  getCategories(): Promise<ApiResult<UserCategoriesDto>> {
    return this.client.get('/profile/user/categories');
  }

  /**
   * DELETE /profile/user/delete — this exact path; the guessable
   * /profile/user/{uuid} answers 405. Deletion is proven only by the
   * follow-up GET /profile/user → 400 with domain code 3060.
   */
  deleteAccount(): Promise<ApiResult<void>> {
    return this.client.delete('/profile/user/delete');
  }
}
