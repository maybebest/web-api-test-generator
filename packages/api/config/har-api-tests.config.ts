import type { HarApiTestConfig } from '../src/types/config.js';

const config: Partial<HarApiTestConfig> = {
  responseTimeBudgetMs: 2000,
  filters: {
    ignoredDomains: [],
    // Project defaults so `npm run generate -- --har ./examples` reproduces the clean suite
    // without CLI flags. Edit these for other targets.
    firstPartyDomains: ['heartpace.dev'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    statuses: [],
    include: [],
    exclude: ['socket']
  },
  generation: {
    modes: ['smoke', 'extended'],
    inferenceLevel: 'balanced',
    inferredRunMode: 'mixed',
    negativeStatusPolicy: 'family',
    mutationPolicy: 'guarded',
    expectedStatuses: {
      negative: {},
      security: {}
    }
  }
};

export default config;
