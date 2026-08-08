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
