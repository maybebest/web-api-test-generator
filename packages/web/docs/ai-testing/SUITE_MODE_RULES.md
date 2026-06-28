# Suite-mode authoring rules (digest)

`Generation Mode | suite` is harder to author than single mode. These are the
exact rules the static reviewer (`scripts/ai/review-generated-test.mjs`) enforces,
distilled so a human or the AI generator can author pass-by-construction. The
worked reference is
[`tests/regression/media-planner-booking-deadline.authenticated.spec.ts`](../../tests/regression/media-planner-booking-deadline.authenticated.spec.ts).

## Per-test shape
- Every `test()` must use `test.step` and end with **exactly one** assertion step
  (the last step) — the only step containing `expect(...)`.
- The assertion step title must start with `Assert ` and name **exactly one**
  `AC-###` or `NEG-###` id, e.g. `Assert AC-004: ...`.

## Coverage
- **Every AC** in the spec needs a dedicated `Assert AC-###` step with a real
  `expect` on a Page/Page-Object locator → in practice, **one test per AC**.
- **Every NEG case** needs a step whose title contains its `NEG-###` id plus an
  `expect` → **one test per NEG**.
- A step that names AC ids must name **at most one** (combined-AC steps are
  rejected in suite mode).

## The data-loop tension (important)
- Specs with **>1 data case** must enumerate them with a real loop
  (`for...of` / `forEach` / `map`) whose body defines `test(...)`.
- BUT step titles are read as **static string literals** — a templated title like
  `` `Assert ${id}: ...` `` resolves to empty, so looped tests **cannot** carry
  per-iteration AC ids in their step titles.
- **Reconcile by:** looping one group of data rows that share the *same* AC (its
  `Assert AC-###` title stays static across iterations), and hand-writing the rest
  as static-titled tests. One qualifying loop satisfies the enumeration rule for
  the whole file.
- `caseId`s count when they appear as string literals **anywhere** — test titles
  or a data array's literals.

## Salient values & matchers
- Assert the spec's declared salient values as **live string literals**. One
  `toContainText('at least 2 days from today')` covers `at least`, `2 days`, and
  `days from today` at once.
- `toBeVisible` is fine on a specific Page-Object locator; it's only rejected on a
  generic `body`/`html`/`main` fallback.

## Variable naming gotcha (all modes)
- The reviewer only treats a value as a Page Object if its **variable name ends in
  `Page`/`Component`/`Object`** (e.g. `planningPage`, not `planning`). Otherwise
  every POM call and `expect(pom.x())` is rejected.

## Misc
- `Parallel Safe = no` ⇒ wrap tests in `test.describe.serial(...)`.
- Declare the spec `Tags` exactly via the `{ tag: [...] }` option (on the describe
  or each test); the array must be inline string literals.
- The spec header `sha256` must match the spec's behavioral hash — stamp it with
  `npm run ai:spec:stamp -- <test>` after editing the spec.
