# GLI-261 re-review evidence

PR: https://github.com/GLIGHTERR/smart-platform-services/pull/26 (target `master`).
This evidence applies to the commit containing this document. No merge or deployment is claimed.

PM escalated the Terra implementation after GLI-265 found credential overwrite,
refresh/revocation races, missing confirmation, and unmeasured repository coverage.
Rework continues the existing PR from `7c38a98675f512af650445f26ca4d64debb99f45`.
Canonical input: SmartTro UC-06 at smart-platform
`0262b446a94c2883c3eaeaac1655e60bf2f83128`, with G1C PO PASS recorded at
`ecaea3f8db357ebf05fe5a96b9826573dbb23051`.

## Changes

- Require `confirmPassword` and exact equality without trimming or normalization.
- Lock the user before the current session, outcome, password update, revocation,
  and audit. Atomically require the verified `expectedPasswordHash`; a stale
  verification returns `409 PASSWORD_CHANGE_CONFLICT` and rolls back its outcome.
- Refresh rotation takes the same user lock before its session lock. A completed
  rotation's replacement is visible to subsequent revocation under READ COMMITTED;
  refresh after revocation cannot produce a live replacement.
- Preserve the authenticated current session; revoke all others. UC-03 retains
  its existing all-session revocation behavior. No new tokens appear in UC-06 responses.
- Set `private, no-store` before authentication as well as on normal responses.
  Two HTTP regression cases reproduced missing headers on 401 before this fix.

## Test matrix

| AC / decision | Cases and evidence |
| --- | --- |
| AC-06-01, subject/session boundary | Real Nest HTTP rejects absent/invalid bearer and injected userId; PostgreSQL rejects missing/inactive/deleted/passwordless user and expired/revoked/missing/wrong-subject current session. No mutation/outcome survives. |
| AC-06-02, D01 | DTO validates 8/128 and 7/129 boundaries, each character class, type/missing/empty confirmation; preserves whitespace exactly. Service rejects mismatch, missing/non-exact confirmation and password reuse before mutation. |
| AC-06-03, D02/D05/D07 | Existing AuthService tests cover wrong current password, 5-failure throttle, missing account/password, audit and safe responses. Existing real scrypt tests cover salted hashing/verification and incompatible formats; no algorithm migration. |
| AC-06-04, D03/D04 | PostgreSQL commits password/outcome/audit, preserves current session and revokes other session. Service integration verifies current token usability, other-token rejection, and acknowledgement `next: profile`. UC-03 regression stays in the full suite. |
| AC-06-05, D06 | Real PostgreSQL user-lock barrier queues two distinct keys that verified one hash: exactly one success, one safe conflict, one final password/outcome/audit. Same-key concurrency replays. Paused refresh plus observed database blocking proves replacement revocation; reverse ordering rejects refresh. |
| AC-06-05, rollback | Invalid audit inet and trigger-injected revocation SQL failure roll back password, outcome and session changes. Migration down/up preserves user/session data. |
| AC-06-06, privacy | HTTP success/400/401/409 have no-store; success/error bodies and normal request logs omit fixture passwords/access token. Subject binding and parameterized SQL reviewed. No production accounts or secrets used. |
| Refresh compatibility | Missing user/session, wrong token/family/replacement subject/family, expiry and reuse branches execute against PostgreSQL 17. |

Fixtures: generated UUIDs, `example.invalid` accounts, synthetic hashes in database
transaction tests; real password hashing and renter role in service tests. HTTP
tests use an isolated Nest application with authentication/service boundary stubs;
PostgreSQL tests use the production repository and actual migrations, not SQL mocks.
No deployed upstream or production data is used.

## Validation and coverage

Node 24.14.0; repository lockfile dependencies; PostgreSQL `postgres:17-alpine` on
loopback port 55461, disposable database `gli261_test`. Integration tests assert
server major 17 and explicitly require `GLI261_POSTGRES_TEST=1` (otherwise skipped).
The pre-existing task-owned container is `gli261-rework-postgres`.

```sh
# Only synthetic environment values; never source a deployed environment.
export CORS_ORIGINS=http://localhost:3000 DATABASE_HOST=127.0.0.1
export DATABASE_NAME=gli261_test DATABASE_USER=postgres DATABASE_PASSWORD=synthetic-test-only
export JWT_ACCESS_SECRET=synthetic-access-secret-at-least-32-chars
export JWT_REFRESH_SECRET=synthetic-refresh-secret-at-least-32-chars
export OTP_HASH_SECRET=synthetic-otp-secret-at-least-32-chars
GLI261_POSTGRES_TEST=1 npm run test:cov -- --coverageReporters=json --coverageReporters=text
npm run lint
npm run build
npx tsc --noEmit
npx jest --runInBand libs/identity/src/http/auth.controller.spec.ts --coverage \
  --collectCoverageFrom=libs/identity/src/http/auth.controller.ts \
  --coverageDirectory=coverage-http --coverageReporters=json --coverageReporters=text \
  --coverageThreshold='{}'
```

- Full suite: **35 suites / 234 tests PASS**, including 24 PostgreSQL tests.
- Lint, typecheck, all four application builds and diff whitespace check: PASS.
- Focused HTTP: 7 tests PASS. Its reporting-only invocation measures the controller;
  the changed `changePassword` method is separately checked at 100%, not exempted.
- Full AuthService: 100% statements/lines/branches/functions.
- Changed methods, including transaction callbacks: **64/64 lines, 12/12 functions,
  43/43 branches** across service changePassword/key helpers, repository
  changePasswordForCurrentSession/findPasswordChangeOutcome/rotateSession, controller
  changePassword, PrivateNoStoreGuard.canActivate and migration up/down.
- New guard and migration files: 100% coverage. DTO decorators execute in validation
  tests; type-only repository interfaces have no executable business logic.
- Bootstrap/config-only additions: migration registration and schema-verifier table
  list. Registration is tested; no critical business logic is exempted.

| Same measurement scope | Base `dff03a7a49186e7c8ba82efbac9e21fa16910a6b` | Rework |
| --- | --- | --- |
| Expanded full: statements / branches / functions / lines | 85.81 / 83.10 / 81.70 / 84.98 | 88.17 / 86.06 / 84.36 / 87.47 |
| Original configured file cohort: statements / branches / functions / lines | 97.97 / 95.72 / 99.41 / 97.82 | 98.00 / 96.06 / 99.42 / 97.86 |

Base was tested in a separate detached checkout with the expanded coverage selection
(180 tests PASS). No repository coverage regression on either comparable scope.
Expanded selection exposes previously unmeasured legacy persistence: the whole
repository file is 46.26% lines, **not** 100%; its changed methods above are 100%.
The whole controller is also not 100%; unchanged endpoints remain outside this
task's changed-code gate. Initial parallel baseline/rework execution hit one service
test timeout; sequential final runs pass with the normal timeout unchanged.

## Security review and release limits

Focused source-first, read-only self-review covered the diff, guards, access-session
validation, password hasher, transaction lock order, SQL parameters, audit payloads,
HTTP logging, and migration. Attack cases: subject injection, revoked/foreign session,
missing/mismatched confirmation, stale verified hash, concurrent keys, refresh escape,
SQL/audit rollback, and secret echo/cache behavior. The no-store gap was reproduced,
fixed in a subsequent development iteration, and rechecked. No unresolved confirmed
finding remains in this scope. Tests above ran in the development phase; no target
code or deployed probes ran during the read-only review.

Migration `PasswordChange1700000007000` is additive; no new migration in rework and
no feature flag. Up/down round-trip passed on PostgreSQL. Down drops idempotency
history and must be coordinated with application rollback. Apply the migration
before new code; deploy all refresh/change handlers together so every replica uses
the shared locking protocol. Mixed old/new versions do not enforce that protocol.

PM must arrange fresh exact-head independent review and a non-author formal GitHub
review, then authorized merge and staging SHA verification. No merge SHA, deployment,
QA readiness or UAT is claimed. PR auto-linking is still unverified: Multica returns
an empty linked-PR list despite the existing GLI-261 title and registered repository;
the CLI exposes no manual link write. PM/workspace owner must repair the integration
or manually link PR #26 in the issue UI before the next gate.
