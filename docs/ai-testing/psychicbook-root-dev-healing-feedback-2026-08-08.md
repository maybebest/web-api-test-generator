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
| `tests-dev/api/users/register-user.spec.ts` | api | 2/2 passed | already-green | 0 | 0 | none | 2/2 passed in 17.5s | ALREADY GREEN |

No baseline or healer result has been recorded here for the remaining inventory files.
