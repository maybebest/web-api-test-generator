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
| `tests-dev/api/users/register-user.spec.ts` | api | 2/2 passed | already-green | 0 | 0 | none | 2/2 passed in 17.5s | ALREADY GREEN |

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

No Task 6 baseline or result has been recorded here yet for the other three
unlisted inventory files. The existing `register-user.spec.ts` row remains
the previously observed factual no-op healer result and will be refreshed
during its Task 6 turn.
