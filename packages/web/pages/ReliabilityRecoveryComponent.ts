import type { Locator, Page, Route } from '@playwright/test';

type ChatFault = {
  message?: string;
  status?: number;
  failures?: number;
};

type ChatRequest = {
  operationName?: unknown;
  query?: unknown;
  variables?: { message?: unknown };
};

// The SPA and direct API helper currently use slightly different GraphQL URL
// shapes. Route every request, then fail closed in isTargetChat() by inspecting
// the GraphQL document + exact message; all non-target traffic continues untouched.
const GRAPHQL_ROUTE = '**/*';

/**
 * Browser-side fault controller for the Nectar AI GraphQL transport.
 *
 * It only intercepts planningAI_chat calls whose message equals the requested
 * value. Catalogue/configuration reads and every other GraphQL operation continue
 * untouched. The counter is observable so an E2E can prove that recovery is
 * once-effective instead of merely checking that a button rendered.
 */
export class ReliabilityRecoveryComponent {
  private readonly page: Page;
  private matchedCalls = 0;
  private injectedFailures = 0;
  private expectedFailures = 0;
  private failureDeliveredResolve: (() => void) | undefined;
  private failureDeliveredPromise: Promise<void> = Promise.resolve();

  constructor(page: Page) {
    this.page = page;
  }

  async injectChatFault(fault: ChatFault = {}): Promise<void> {
    const status = fault.status ?? 503;
    const failures = fault.failures ?? 1;
    const exactMessage = fault.message;

    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`ReliabilityRecoveryComponent: injected status must be an integer from 400 to 599, got ${status}.`);
    }
    if (!Number.isInteger(failures) || failures < 1 || failures > 5) {
      throw new Error(`ReliabilityRecoveryComponent: failures must be an integer from 1 to 5, got ${failures}.`);
    }

    this.matchedCalls = 0;
    this.injectedFailures = 0;
    this.expectedFailures = failures;
    this.failureDeliveredPromise = new Promise<void>((resolve) => {
      this.failureDeliveredResolve = resolve;
    });

    await this.page.route(GRAPHQL_ROUTE, async (route) => {
      if (!this.isTargetChat(route, exactMessage)) {
        await route.continue();
        return;
      }

      this.matchedCalls += 1;
      if (this.injectedFailures >= failures) {
        await route.continue();
        return;
      }

      this.injectedFailures += 1;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          errors: [{ message: 'Run-scoped E2E injected transient planningAI_chat failure.' }]
        })
      });
      if (this.injectedFailures === this.expectedFailures) {
        this.failureDeliveredResolve?.();
        this.failureDeliveredResolve = undefined;
      }
    });
  }

  private isTargetChat(route: Route, exactMessage: string | undefined): boolean {
    const request = route.request();
    let body: ChatRequest;
    try {
      const parsed: unknown = request.postDataJSON();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return false;
      }
      body = parsed as ChatRequest;
    } catch {
      return false;
    }
    const operation = new URL(request.url()).searchParams.get('op') ?? body.operationName;
    const mutationDocument = typeof body.query === 'string' ? body.query : '';
    const isChatMutation =
      operation === 'planningAI_chat' ||
      operation === 'PlanningAIChat' ||
      /\bplanningAI_chat\s*\(/.test(mutationDocument);
    if (!isChatMutation || /\bplanningAI_chatHistory\s*\(/.test(mutationDocument)) {
      return false;
    }
    return exactMessage === undefined || body.variables?.message === exactMessage;
  }

  async waitForInjectedFailure(timeoutMs = 90_000): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.failureDeliveredPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('ReliabilityRecoveryComponent: target planningAI_chat request was not observed in time.')),
            timeoutMs
          );
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async removeFault(): Promise<void> {
    await this.page.unroute(GRAPHQL_ROUTE);
  }

  matchedRequestCount(): number {
    return this.matchedCalls;
  }

  injectedFailureCount(): number {
    return this.injectedFailures;
  }

  errorAlert(): Locator {
    const semanticAlert = this.page.getByRole('alert');
    const visibleFailureCopy = this.page.getByText(
      /something went wrong|unable to (?:continue|complete|load)|request failed|try again|temporary error/i
    );
    // locator-policy:exception either an ARIA alert or the documented visible error copy is a valid error surface
    return semanticAlert.filter({ visible: true }).or(visibleFailureCopy.filter({ visible: true })).first();
  }

  retryButton(): Locator {
    // The recovery contract accepts either product wording while keeping an accessible button oracle.
    // locator-policy:exception recovery copy is supplied by the product and may use either accepted label
    return this.page.getByRole('button', { name: /retry|try again/i }).filter({ visible: true }).first();
  }

  cancelButton(): Locator {
    // locator-policy:exception only the currently visible recovery action belongs to the failed request
    return this.page.getByRole('button', { name: /cancel/i }).filter({ visible: true }).first();
  }

  async retry(): Promise<void> {
    await this.retryButton().click();
  }
}
