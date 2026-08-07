import eslint from '@eslint/js';
import playwright from 'eslint-plugin-playwright';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.ai-runs/**',
      'allure-report/**',
      'allure-results/**',
      'node_modules/**',
      'performance/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['fixtures/test.ts'],
    rules: {
      // Playwright requires fixture dependency parameters to be object destructuring patterns,
      // including the intentionally dependency-free `{}` form.
      'no-empty-pattern': 'off'
    }
  },
  {
    ...playwright.configs['flat/recommended'],
    files: ['tests/**/*.ts', 'tests-dev/**/*.ts'],
    settings: {
      playwright: {
        assertFunctionNames: ['assertCaseOutcome']
      }
    },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      'playwright/expect-expect': ['error', { assertFunctionNames: ['assertCaseOutcome'] }],
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      'playwright/no-wait-for-timeout': 'error'
    }
  }
);
