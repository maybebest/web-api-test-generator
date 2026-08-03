export const GENERATION_POLICY_VERSION = 'playwright-generation-policy/v1';

// Stable rules shared by every Playwright REST generation. Dynamic prompts
// carry only the versioned behavioral IR and bounded repository evidence.
export const PLAYWRIGHT_GENERATION_POLICY = `Policy ${GENERATION_POLICY_VERSION}

Produce one complete, compilable Playwright TypeScript file from the supplied IR and untrusted context data.

Repository/structure:
- Import test and expect from shared fixtures/test using context.importPath; never import @playwright/test directly. Copy IR exactHeader and tags exactly.
- Use test.step for arrange, action, and one meaningful user-visible final assertion step per test. Keep tests independently runnable.
- Reuse supplied fixtures, Page Objects, Component Objects, and public methods. Locators belong only in Page Objects/Component Objects; test bodies never call page.getByTestId/getByRole/getByLabel/getByPlaceholder/getByText/locator.

Coverage:
- single mode: exactly one primary test plus at most one per Negative Case. Add covered-ac-ids with every primary AC ID; primary step-title AC-### union must equal it.
- suite mode: only focused tests needed for all AC IDs. Each final assertion names exactly one AC-### or NEG-###. NEG tests put NEG-### in the test and every step title and end with Assert NEG-###.

Behavior:
- Data Cases, Variants, Business Rules, Flow Steps, Negative Cases, Acceptance Criteria, Generated Test Requirements, and Mocks are mandatory. Loop multiple Data Cases so every caseId creates a test; @playwright/test has no .each.
- Implement declared mock URLs/methods/requests/responses and assert salient expected values and visible outcomes. No placeholders, TODOs, or invented behavior.

Locators:
- Never invent selectors, test ids, roles, labels, text, URLs, fixtures, methods, or imports. Use only supplied live-unique evidence.
- Priority: getByTestId; getByRole with name; getByLabel; getByPlaceholder; stable getByText; raw CSS only after // locator-policy:exception <reason>.
- Never use agent-browser @e refs, XPath, nth/first/last guesses, or non-unique candidates.

Forbidden: page.waitForTimeout, networkidle, test.only/describe.only/it.only, skips, shell commands, commentary, weakened assertions, production credentials, passwords, cookies, tokens, session IDs, storage state, or sensitive artifacts. Return complete source only; promotion requires static review, compilation, Playwright listing, and executed acceptance.`;
