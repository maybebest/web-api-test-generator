import type { ApiClient, ApiResult } from '../http/ApiClient';

export type AttachedCardDto = {
  pmId?: string;
  last4?: string;
  brand?: string;
  default?: boolean;
};

/**
 * Payment methods of the current user (token-bound client). A raw PAN cannot
 * be tokenized against api.stripe.com from here; the working path is
 * attaching Stripe's own test payment method `pm_card_visa` (same 4242 test
 * card the UI form uses).
 */
export class PaymentApi {
  constructor(private readonly client: ApiClient) {}

  attachCard(pmId = 'pm_card_visa'): Promise<ApiResult<unknown>> {
    return this.client.put('/payment/card/attach', {
      data: { default: true, pmId }
    });
  }

  listCards(): Promise<ApiResult<AttachedCardDto[] | AttachedCardDto>> {
    return this.client.get('/payment/card');
  }

  /**
   * Charges the attached card. `amount` is the missing part of the session
   * price (price minus balance); a fresh account has a zero balance, so it
   * pays the full package price. A successful charge lands on the balance.
   */
  purchase(userUuid: string, amount: number, pmId = 'pm_card_visa'): Promise<ApiResult<PurchaseResponseDto>> {
    return this.client.post('/payment/card/purchase', {
      data: { userUuid, apiVersion: '2020-03-02', pmId, amount }
    });
  }

  /** The user's balance. NB: `ballance` is the server's own spelling. */
  getBalance(): Promise<ApiResult<BalanceDto>> {
    return this.client.get('/payment/balance');
  }
}

export type PurchaseResponseDto = {
  status?: string;
  paymentIntentId?: string;
  customerId?: string;
};

export type BalanceDto = {
  ballance: number;
  currency?: string;
};
