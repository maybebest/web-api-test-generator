# Locator Policy

## Preferred Locator Order

1. `this.page.getByTestId(...)` when a meaningful `data-testid` exists and is stable.
2. `this.page.getByRole(...)` with accessible name.
3. `this.page.getByLabel(...)`.
4. `this.page.getByPlaceholder(...)`.
5. `this.page.getByText(...)` only for stable visible copy.
6. Raw CSS only with `// locator-policy:exception <reason>` on the previous line.

Generated tests must access those locators through Page Objects or Component Objects. They must not create direct `page.getBy*` or `page.locator(...)` locators in test bodies.

## agent-browser Discovery

- `agent-browser` can collect current DOM/accessibility evidence before generation.
- `agent-browser` refs such as `@e1` and `@e2` are session-only handles and must never appear in generated Playwright tests.
- Discovery artifacts provide selector candidates; the framework selector policy chooses final Playwright locators.

## Chrome Recorder Selectors

- Chrome DevTools Recorder JSON is a generation contract for recorded tests, but its selectors are still selector evidence that must be translated into Playwright locators.
- Prefer Recorder `data-testid` selectors when they are meaningful and stable.
- Prefer Recorder ARIA role/name selectors that can become `getByRole` when no stable `data-testid` exists.
- Prefer stable text selectors only when the text is user-visible and not dynamic.
- Reject recordings whose only selector candidates are XPath, `:nth-child` chains, or unstable raw CSS.
- Raw CSS generated from a recording is allowed only when no policy-preferred locator exists and the generated test includes `// locator-policy:exception <reason>` on the previous line.

## Forbidden

- XPath.
- `nth-child` chains.
- Positional locator picks — `.first()`, `.last()`, `.nth(<numeric>)` chained on a locator — without `// locator-policy:exception <reason>` on the previous line. They encode DOM order instead of element identity.
- Selector arguments that do not fold to a static string (dynamic expressions, unresolvable variables) without `// locator-policy:exception <reason>` on the previous line. The reviewer fails closed on selectors it cannot classify.
- String-selector action APIs — `page.click('css...')`, `page.fill('css...', value)`, `page.waitForSelector(...)`, `page.$`/`page.$$` and similar selector-string calls. Actions are called on locator objects only; `page.keyboard.press(...)` stays allowed.
- Random generated CSS classes.
- Text that changes by locale unless the test controls locale.
- Hard waits for element readiness.

## Notes

Prefer stable, meaningful `data-testid` locators when they exist. When they do not, prefer locators that describe how users perceive and operate the page. If no policy-preferred locator is available, record the limitation and consider adding accessible names or stable test ids in application code.

## Static Review Enforcement

Enforcement scope: the static reviewers (`ai:test:review`, `ai:recording:review`) run on generated and recorded test bodies under `tests/`. Page Objects and Component Objects under `pages/` and `components/` carry the same `// locator-policy:exception <reason>` comment convention by policy — every positional pick or raw CSS fallback in a POM must have the comment on the previous line — but POMs are enforced through human code review, not the static reviewers. A repo self-test (`npm run ai:test:self`) additionally pins that committed POMs carry the comment.

- Static generated-test review fails XPath and `nth-child` selector chains, including selectors held in variables, reassigned variables, and parameter default values (the reviewer folds them before classifying).
- Static generated-test review fails persisted `agent-browser` refs.
- CSS selectors in generated tests fail unless the previous line contains `// locator-policy:exception <reason>`.
- Selector arguments the reviewer cannot fold to a static string fail unless the previous line contains `// locator-policy:exception <reason>`.
- Positional picks `.first()`, `.last()`, and `.nth(<numeric>)` on locator-like expressions (page locators, locator variables, Page Object locator fields) fail unless the previous line contains `// locator-policy:exception <reason>`.
- String-selector action APIs fail outright in both generated and recorded tests — there is no exception comment for them; move the locator into a Page Object and call the action on the locator object.
- The recorded-test review applies the same fail-closed selector rules as the generated path: unfoldable selector arguments and uncommented positional picks fail.
- Direct `page.getBy*` and `page.locator(...)` usage fails in generated tests unless the locator is owned by a Page Object or Component Object.
- Prefer moving CSS selector fallbacks into Page Objects with a comment explaining why policy-preferred locators are impossible.
- Prefer stable `data-testid`, then accessible role/name and labels before any fallback selector.
