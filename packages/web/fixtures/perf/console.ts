// Console + uncaught page-error collector. Registers page listeners at fixture setup and tallies
// console.error/warn/log counts plus captured uncaught exceptions (a health signal for a run).
// Only error MESSAGES are kept (truncated), never arbitrary args, to avoid leaking page data.
// Web-only — no packages/api import.
import type { ConsoleMessage, Page } from '@playwright/test';
import type { ConsoleBlock } from './types';
import { redactSecrets } from './redact';

const MAX_PAGE_ERRORS = 20;
const MESSAGE_MAX = 300;

export type ConsoleCollector = {
  finalize(): ConsoleBlock;
};

export function emptyConsoleBlock(): ConsoleBlock {
  return { errors: 0, warnings: 0, logs: 0, pageErrors: [] };
}

export function createConsoleCollector(page: Page): ConsoleCollector {
  let errors = 0;
  let warnings = 0;
  let logs = 0;
  const pageErrors: Array<{ message: string }> = [];

  const onConsole = (message: ConsoleMessage): void => {
    const type = message.type();
    if (type === 'error') {
      errors += 1;
    } else if (type === 'warning') {
      warnings += 1;
    } else {
      logs += 1;
    }
  };
  const onPageError = (error: Error): void => {
    if (pageErrors.length < MAX_PAGE_ERRORS) {
      // An uncaught error message may embed a token/PII — scrub before persisting.
      pageErrors.push({ message: redactSecrets(String(error.message ?? error)).slice(0, MESSAGE_MAX) });
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  return {
    finalize(): ConsoleBlock {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      return { errors, warnings, logs, pageErrors };
    }
  };
}
