# PsychicBook root dev healing feedback — 2026-08-08

## Initial baseline

Canonical `tests` hashes were captured before runtime work in
`/tmp/psychicbook-canonical-before.sha256` (15 tracked files).

The dev inventory was collected with `PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev`
and `TEST_ENV=dev`:

| File | Project | Collected tests |
|---|---|---:|
| `tests-dev/api/experts/expert-booking.spec.ts` | api | 1 |
| `tests-dev/api/experts/expert-lifecycle.spec.ts` | api | 1 |
| `tests-dev/api/users/delete-user.spec.ts` | api | 1 |
| `tests-dev/api/users/register-user.spec.ts` | api | 2 |
| `tests-dev/api/users/update-user.spec.ts` | api | 1 |
| `tests-dev/api/users/user-lifecycle.spec.ts` | api | 2 |
| `tests-dev/ui/articles/articles-tab.spec.ts` | ui | 1 |
| `tests-dev/ui/booking/book-with-article-author.spec.ts` | ui | 1 |
| `tests-dev/ui/chat/user-agent-chat.spec.ts` | ui | 1 |
| `tests-dev/ui/coupons/discount-lifecycle.spec.ts` | ui | 1 |
| `tests-dev/ui/horoscope/daily-horoscope.spec.ts` | ui | 1 |
| `tests-dev/ui/match-advisor/find-your-match.spec.ts` | ui | 2 |
| `tests-dev/ui/navigation/site-navigation.spec.ts` | ui | 4 |
| `tests-dev/ui/profile/profile-sections.spec.ts` | ui | 7 |
| `tests-dev/ui/sessions/my-sessions.spec.ts` | ui | 1 |

Totals: 8 API tests in 6 files; 19 UI tests in 9 files.

## Observed healer telemetry

| File | Project | Baseline | Classification | Provider calls | Attempts | Applied diff | Verification | Final |
|---|---|---:|---|---:|---:|---|---|---|
| `tests-dev/api/experts/expert-booking.spec.ts` | api | 0/1 passed; 1 failed in 1.1s | authentication/shared-owner: agent authorization returned HTTP 400 in `api/facades/AgentFacade.ts` before the spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/api/experts/expert-lifecycle.spec.ts` | api | 0/1 passed; 1 failed in 1.1s | authentication/data/shared-owner: administrator lookup returned HTTP 400 in `api/facades/ExpertFacade.ts` before generation | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/api/users/delete-user.spec.ts` | api | 1/1 passed in 8.8s | already-green | 0 | 0 | none | no separate run; exact baseline passed | ALREADY GREEN |
| `tests-dev/api/users/register-user.spec.ts` | api | 1/2 passed; 1 failed in 1.3m | product/data: e-mail code submission returned HTTP 400 on a duplicate device database constraint; phone flow passed | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/api/users/update-user.spec.ts` | api | 1/1 passed in 44.4s | already-green | 0 | 0 | none | no separate run; exact baseline passed | ALREADY GREEN |
| `tests-dev/api/users/user-lifecycle.spec.ts` | api | 2/2 passed in 3.9s | already-green | 0 | 0 | none | no separate run; exact baseline passed | ALREADY GREEN |
| `tests-dev/ui/articles/articles-tab.spec.ts` | ui | 0/1 passed; 1 failed in 16.5s | product/data: both article APIs returned HTTP 200 with zero records, leaving the list empty | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/booking/book-with-article-author.spec.ts` | ui | 0/1 passed; 1 failed in 9.7s | authentication/shared-owner: agent authorization returned HTTP 400 in `api/facades/AgentFacade.ts` before the spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/chat/user-agent-chat.spec.ts` | ui | 0/1 passed; 1 failed in 10.0s | authentication/shared-owner: agent authorization returned HTTP 400 in `api/facades/AgentFacade.ts` before the spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/coupons/discount-lifecycle.spec.ts` | ui | 0/1 passed; 1 failed in 9.7s | authentication/shared-owner: agent authorization returned HTTP 400 in `api/facades/AgentFacade.ts` before the spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/horoscope/daily-horoscope.spec.ts` | ui | 0/1 passed; 1 failed in 17.1s | authentication/shared-owner: agent authorization returned HTTP 400 in `api/facades/AgentFacade.ts` before the spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/match-advisor/find-your-match.spec.ts` | ui | 2/2 passed in 15.6s | already-green | 0 | 0 | none | no separate run; exact baseline passed | ALREADY GREEN |
| `tests-dev/ui/navigation/site-navigation.spec.ts` | ui | 3/4 passed; 1 failed in 3.7m | product/data: the article scenario received HTTP 200 with zero article records; all menu and footer scenarios passed | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/profile/profile-sections.spec.ts` | ui | 6/7 passed; 1 failed in 5.3m | product/data/shared-owner: one e-mail login code submission returned HTTP 400 on a duplicate device database constraint before the Terms spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |
| `tests-dev/ui/sessions/my-sessions.spec.ts` | ui | 0/1 passed; 1 failed in 10.6s | authentication/shared-owner: agent authorization returned HTTP 400 in `api/facades/AgentFacade.ts` before the spec body | 0 | 0 | none | not run; failure is outside the repairable boundary | NON-TEST BLOCKER |

### `tests-dev/api/experts/expert-booking.spec.ts`

The exact one-worker, zero-retry baseline exited 1. The retained trace records
`POST /profile/agent/authorization` as HTTP 400 `Bad Request`; its redacted-safe
response fields carry domain status `3022` and the detail `Login or password is
not correct`. The stack is owned by `api/facades/AgentFacade.ts:37` through the
shared `onlineAgents` fixture, and the failure occurs before the spec body.
This is authentication/shared-owner evidence, not locator drift or
synchronization owned by the test. The healer was therefore not invoked, no
provider call or attempt occurred, and no test file changed.

### `tests-dev/api/experts/expert-lifecycle.spec.ts`

The exact one-worker, zero-retry baseline exited 1. The retained trace records
the redacted administrator UUID lookup as HTTP 400 `Bad Request`; its
redacted-safe response fields carry domain status `13002`, say that the admin
does not exist, and describe the credentials as incorrect. The assertion is
owned by `api/facades/ExpertFacade.ts:80`, before the generation service is
called. This is authentication/data/shared-owner evidence, not a repairable
spec failure. The healer was not invoked, no provider call or attempt
occurred, and no test file changed.

### `tests-dev/api/users/delete-user.spec.ts`

The exact one-worker, zero-retry baseline exited 0 with 1/1 passing in 8.8
seconds. It completed account creation, profile completion, API deletion,
browser re-login, and both cleanup deletions. Playwright's last-run result is
`passed` with no failed test IDs. There was no failure to heal, so the healer
was not invoked, no provider call or attempt occurred, and no test file
changed.

### `tests-dev/api/users/register-user.spec.ts`

The refreshed exact one-worker, zero-retry Task 6 baseline exited 1 with 1/2
passing in 1.3 minutes. The phone registration and browser-login case passed
in 11.2 seconds. The e-mail case timed out at the spec-owned `/psychics` URL
wait after the page visibly reported a registration error. The retained
network trace identifies the earlier divergence: `POST
/profile/user/web/registration/code` returned HTTP 400 because the dev backend
attempted to insert a duplicate `(device_id, brand)` pair and violated its
unique database constraint. Cleanup deleted the created e-mail account. This
is product/data evidence, not synchronization drift, so the healer was not
invoked, no provider call or attempt occurred, and no test file changed. This
Task 6 result supersedes the earlier factual 2/2 green observation.

### `tests-dev/api/users/update-user.spec.ts`

The exact one-worker, zero-retry baseline exited 0 with 1/1 passing in 44.4
seconds. It completed API profile creation, update and read-back assertions,
browser login and header assertions, the About Me assertions, and fixture
cleanup. Playwright's last-run result is `passed` with no failed test IDs.
There was no failure to heal, so the healer was not invoked, no provider call
or attempt occurred, and no test file changed.

### `tests-dev/api/users/user-lifecycle.spec.ts`

The exact one-worker, zero-retry baseline exited 0 with 2/2 passing in 3.9
seconds. The e-mail lifecycle passed in 1.7 seconds and the phone lifecycle,
including its expected invalid-update domain-code assertion, passed in 1.9
seconds. Both cases completed deletion checks and after-hook cleanup.
Playwright's last-run result is `passed` with no failed test IDs. There was no
failure to heal, so the healer was not invoked, no provider call or attempt
occurred, and no test file changed.

## Complete API project

The required final one-worker, zero-retry `api` project run collected all 8
tests and exited 1 with 6 passing and 2 failing in 56.5 seconds. The two
failures were the same expert identity boundaries already classified above:
agent authorization returned HTTP 400 through `api/facades/AgentFacade.ts`,
and the administrator UUID lookup returned HTTP 400 through
`api/facades/ExpertFacade.ts`. Both registration cases passed in this complete
run (e-mail in 6.6 seconds and phone in 9.4 seconds), as did the other four
user tests. Playwright's last-run result names exactly the two expert test IDs
as failed. No locator-drift or synchronization failure appeared, no healer or
provider call was made, and no test file changed.

## UI file baselines and healing

### `tests-dev/ui/articles/articles-tab.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 0/1 passing in 16.5
seconds. User creation, profile completion, card attachment, login, navigation
to `/articles/`, the page-title assertion, and cleanup all completed. The next
spec-owned assertion could not find the `Popular Articles` heading. The
retained screenshot and accessibility snapshot show the Articles heading and
footer with an otherwise empty content area. Redacted-safe trace inspection
shows `GET /api/articles/popular/` returned HTTP 200 with an empty array and
`GET /api/articles/` returned HTTP 200 with `data` as an empty array. This is a
dev product/data blocker, not locator drift or synchronization owned by the
test. The healer was therefore not invoked, no provider call or attempt
occurred, and no test file changed. Playwright also emitted the non-actionable
runtime warning that `NO_COLOR` was ignored because `FORCE_COLOR` was set.

### `tests-dev/ui/booking/book-with-article-author.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 0/1 passing in 9.7
seconds. User creation, profile completion, card attachment, browser login, and
cleanup completed, but the shared `onlineAgents` fixture failed before the
spec body while logging in the first agent in its pool. The retained stack is
owned by `api/facades/AgentFacade.ts:37` through `fixtures/api-test.ts:142`.
Redacted-safe trace inspection shows `POST /profile/agent/authorization`
returned HTTP 400 with domain status `3022` and the detail `Login or password
is not correct`; the screenshot shows the already signed-in user page and does
not contradict that API boundary. This is an authentication/shared-owner
blocker, not test-owned locator drift or synchronization. The healer was not
invoked, no provider call or attempt occurred, and no test file changed.
Playwright again emitted the non-actionable `NO_COLOR`/`FORCE_COLOR` runtime
warning.

### `tests-dev/ui/chat/user-agent-chat.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 0/1 passing in 10.0
seconds. User setup, card attachment, browser login, and cleanup completed, but
the shared `onlineAgents` fixture failed before the booking step while logging
in the first agent in the pool. The retained stack again leads through
`api/facades/AgentFacade.ts:37` and `fixtures/api-test.ts:142`. Redacted-safe
trace inspection records `POST /profile/agent/authorization` as HTTP 400 with
domain status `3022` and the detail `Login or password is not correct`; the
screenshot shows the signed-in user page in its loading state. This is an
authentication/shared-owner blocker, not test-owned locator drift or
synchronization. The healer was not invoked, no provider call or attempt
occurred, and no test file changed. The only runtime warning was the same
non-actionable `NO_COLOR`/`FORCE_COLOR` notice.

### `tests-dev/ui/coupons/discount-lifecycle.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 0/1 passing in 9.7
seconds. The run completed user setup, card attachment, browser login, and
cleanup, but stopped before any booking, session, price, message, or coupon
step. Its shared `onlineAgents` fixture failed while logging in the first pool
agent, with the stack at `api/facades/AgentFacade.ts:37` through
`fixtures/api-test.ts:142`. Redacted-safe trace inspection records `POST
/profile/agent/authorization` as HTTP 400 with domain status `3022` and the
detail `Login or password is not correct`; the screenshot shows only the
signed-in user page loading. This is an authentication/shared-owner blocker,
not test-owned locator drift or synchronization. The healer was not invoked,
no provider call or attempt occurred, and no test file changed. The only
runtime warning was the non-actionable `NO_COLOR`/`FORCE_COLOR` notice.

### `tests-dev/ui/horoscope/daily-horoscope.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 0/1 passing in 17.1
seconds. User setup, card attachment, browser login, and cleanup completed, but
the run stopped before the first horoscope step because the shared
`onlineAgents` fixture could not log in its first pool agent. The stack is at
`api/facades/AgentFacade.ts:37` through `fixtures/api-test.ts:142`.
Redacted-safe trace inspection records `POST /profile/agent/authorization` as
HTTP 400 with domain status `3022` and the detail `Login or password is not
correct`; the screenshot shows the signed-in user page still loading. This is
an authentication/shared-owner blocker, not test-owned locator drift or
synchronization. The healer was not invoked, no provider call or attempt
occurred, and no test file changed. The only runtime warning was the same
non-actionable `NO_COLOR`/`FORCE_COLOR` notice.

### `tests-dev/ui/match-advisor/find-your-match.spec.ts`

The exact one-worker, zero-retry baseline exited 0 with 2/2 passing in 15.6
seconds. The signed-in flow navigated from Psychics to the home page, submitted
the match question, reached `/match-advisor/`, and asserted the breadcrumb in
11.5 seconds. The independent e-mail flow created a user, submitted the known
wrong code, remained on the verification-code screen, and confirmed it did
not reach `/psychics/` in 3.6 seconds. Both cases completed cleanup. There was
no failure to heal, so the healer was not invoked, no provider call or attempt
occurred, and no test file changed. Playwright emitted only the non-actionable
`NO_COLOR`/`FORCE_COLOR` runtime warning.

### `tests-dev/ui/navigation/site-navigation.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 3/4 passing in 3.7
minutes. The Psychics-menu scenario passed all ten destinations in 56.1
seconds, the Horoscope-menu scenario passed all sixteen destinations in 1.7
minutes, and the footer scenario passed all eighteen links and content-heading
checks in 28.0 seconds. The article scenario reached `/articles/`, asserted its
heading and title, then timed out after 20 seconds waiting for the first card
to exist. Its retained screenshot and accessibility snapshot show the
Articles heading and footer with no article cards. Redacted-safe trace
inspection shows both article requests completed at the transport layer:
`GET /api/articles/popular/` returned HTTP 200 with an empty array, and `GET
/api/articles/` returned HTTP 200 with `data` as an empty array. This is the
same dev product/data blocker observed in `articles-tab`, not locator drift or
synchronization owned by this test. The healer was therefore not invoked, no
provider call or attempt occurred, and no test file changed. Playwright
emitted the non-actionable `NO_COLOR`/`FORCE_COLOR` warning, including after
the worker restarted for the fourth scenario.

### `tests-dev/ui/profile/profile-sections.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 6/7 passing in 5.3
minutes. About Me passed its exact zero-balance checks in 44.0 seconds, Privacy
Policy passed all heading and copy checks in 43.4 seconds, Customer Support
passed both iframe checks in 44.9 seconds, Coupons passed its empty-state check
in 27.3 seconds, Payments passed both history checks in 42.7 seconds, and FAQ
passed the full closed/open/closed animation sequence in 47.7 seconds. The
Terms case failed during its shared `signedInEmailUser` setup, before the spec
body. The screenshot and accessibility snapshot show the verification-code
screen with all four expected digits entered and the visible message `An error
occurred while registration by code.` Redacted-safe trace inspection shows
`POST /profile/user/web/registration/code` returned HTTP 400 because the dev
backend attempted to insert a duplicate `(device_id, brand)` pair and violated
its unique database constraint. The later `/psychics` URL wait in
`fixtures/ui-test.ts:138` was only the final symptom. This is a
product/data/shared-owner blocker, not test-owned locator drift or
synchronization. The healer was not invoked, no provider call or attempt
occurred, and no test file changed. Playwright emitted the non-actionable
`NO_COLOR`/`FORCE_COLOR` warning, including when the worker restarted after the
failed Terms setup.

### `tests-dev/ui/sessions/my-sessions.spec.ts`

The exact one-worker, zero-retry baseline exited 1 with 0/1 passing in 10.6
seconds. User setup, card attachment, browser login, and cleanup completed, but
the run stopped before creating any of its three bookings. The shared
`onlineAgents` fixture failed while logging in the first pool agent, with the
stack at `api/facades/AgentFacade.ts:37` through `fixtures/api-test.ts:142`.
Redacted-safe trace inspection records `POST /profile/agent/authorization` as
HTTP 400 with domain status `3022` and the detail `Login or password is not
correct`; the screenshot shows the signed-in user page still loading. This is
an authentication/shared-owner blocker, not test-owned locator drift or
synchronization. The healer was not invoked, no provider call or attempt
occurred, and no test file changed. The only runtime warning was the
non-actionable `NO_COLOR`/`FORCE_COLOR` notice.

## Complete UI project

The required final one-worker, zero-retry `ui` project run collected all 19
tests and exited 1 with 11 passing and 8 failing in 9.4 minutes. The two match
tests, the Horoscope-menu and footer-navigation tests, and all seven profile
tests passed. In particular, the Terms case that hit the duplicate-device
backend error in its isolated file run completed its real assertions in this
project run, confirming that the earlier failure was intermittent dev data
state rather than a test synchronization defect.

Seven failures reproduced already documented non-test boundaries: the two
article scenarios again had no article cards, and the five booking/chat/session
flows again stopped on HTTP 400 agent authorization in the shared fixture. One
additional navigation failure appeared only in the complete run. Its retained
screenshot and accessibility snapshot show the product's `Application error:
a client-side exception has occurred` page instead of a header. Redacted-safe
trace inspection shows the `/articles/` document returned HTTP 200 but four
required `/_next/static/chunks/...` requests returned HTTP 503, so the later
wait for the `Psychics` button was only the final symptom. This is a live
product/network availability failure, not locator drift or synchronization
owned by the test.

No complete-run failure entered the repairable boundary, so the healer was not
invoked, provider calls and attempts remained zero, no diff was proposed or
applied, and all nine UI specs remained unchanged. Playwright repeatedly
emitted the non-actionable warning that `NO_COLOR` was ignored because
`FORCE_COLOR` was set; there were no healer policy warnings because there were
no eligible healer cycles.

## Final verification and healer feedback

### Static verification

The three Task 8 static commands were run exactly as specified on the final
tree:

| Check | Exit | Observed result |
|---|---:|---|
| Node configuration, environment-gate, and healer-contract tests | 0 | 22 passed, 0 failed in 1.9 seconds |
| `npx tsc --noEmit` | 0 | No diagnostics in 1.3 seconds |
| Required root ESLint command with `--max-warnings=0` | 1 | 59 findings: 41 errors and 18 warnings in 1.4 seconds |

The lint result is a concrete framework/static-policy defect, not a green
gate. Seven `no-undef` errors show that the root policy does not provide Node
globals to the supported `config/*.mjs` runtime files. The remaining findings
are duplicated across the canonical and dev-mirror suites: each tree has 17
unused-fixture/value errors and 9 Playwright style warnings. The exact final
lint command therefore cannot pass against the copied suite it is required to
check. Task 8 did not change either test tree to hide these findings.

### Complete 27-test dev run

The exact final command used `PLAYWRIGHT_TEST_SUITE_ROOT=tests-dev`,
`TEST_ENV=dev`, one worker, and zero retries. It collected all 27 tests and
exited 1 with 15 passing and 12 failing in 13.3 minutes. The API project was
6/8; the UI project was 9/19.

| Final-run class | Tests | Evidence-backed disposition |
|---|---:|---|
| API authentication/shared-owner | 1 | Agent authorization returned HTTP 400 before the booking body |
| API authentication/data/shared-owner | 1 | Administrator lookup returned HTTP 400 before expert generation |
| UI authentication/shared-owner | 5 | Booking, chat, coupons, horoscope, and sessions stopped at the same HTTP 400 agent authorization fixture boundary |
| UI product/data | 2 | Both article scenarios rendered an empty list; the popular endpoint returned HTTP 200 with an empty array and the list endpoint returned HTTP 200 with `data` as an empty array |
| UI product/data/shared-owner | 3 | About Me, Customer Support, and Payments remained on e-mail verification; each code submission returned HTTP 400 with a duplicate `device_id`/`brand` unique-constraint data error |

The three profile failures stopped in `signedInEmailUser` setup before their
spec bodies. Their screenshots show all four code digits plus `An error
occurred while registration by code.` The `/psychics` wait at
`fixtures/ui-test.ts:138` is the final symptom, not synchronization drift. The
earlier full-UI Next.js chunk-503 blocker did not reproduce: the Psychics-menu
scenario passed all ten destinations in this final run. No final failure was
locator drift or test-owned synchronization, so no final healer call was
warranted.

### Canonical integrity

The fresh `/tmp/psychicbook-canonical-after.sha256` snapshot contains the same
15 tracked canonical files as the pre-runtime snapshot. The required checksum
diff exited 0 with no output, and `git diff --name-only -- tests` also returned
no paths. No canonical test changed. The dev mirrors likewise received no
manual or healer-authored change during the campaign.

### Observed healer quality, cost, and improvement points

- The only real healer invocation in this campaign was Task 4's
  `tests-dev/api/users/register-user.spec.ts` baseline. It correctly returned
  `already-green` after 2/2 tests passed in 17.5 seconds. It made zero provider
  calls, consumed zero repair attempts, produced no proposal, and applied no
  diff. The later intermittent duplicate-device backend failures do not make
  that time-specific green classification incorrect.
- No incorrect healer classification was observed. The failing API and UI
  cases were classified from runtime evidence before healer invocation, so
  automated healer classification quality on those classes was not exercised.
  There were no unnecessary provider calls or repair attempts anywhere in the
  campaign.
- No healer policy warning, provider timeout, or promotion warning occurred.
  Playwright repeatedly warned that `NO_COLOR` was ignored because
  `FORCE_COLOR` was set; that warning did not affect outcomes and was not
  actionable for this campaign. The 59 lint findings are actionable framework
  debt, but fixing canonical/dev test style or root lint configuration is
  outside this evidence-only task.
- The final unified runtime cost was 13.3 minutes, compared with 56.5 seconds
  for the earlier complete API project and 9.4 minutes for the earlier complete
  UI project. The three static checks together took about 4.5 seconds. Most
  runtime cost came from serial live UI navigation/profile setup and the three
  60-second e-mail-login timeouts. Readiness preflights for agent/admin identity,
  article seed data, and duplicate-device state would make these external
  blockers fail earlier without weakening tests.
- Safe healer-applied test changes: none. Provider calls: zero. Repair
  attempts: zero. Proposed or promoted diffs: none. The campaign correctly
  excluded authentication, product, data, network, and shared-fixture-owner
  failures instead of modifying copied tests around them.
- No additional real healer defect was observed. For the remaining cycles the
  campaign enforced the framework's repair boundary correctly by excluding
  non-repairable blockers before invocation. Repair-generation quality was not
  exercised because no failure met the locator-drift or synchronization
  boundary.
