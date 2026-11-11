# GLI-261 PORT deployment fix

Base: `efed4e228c95aade7dbe10fbc32773bf8b9fd688`. Scope authorized by the
2026-11-11 DELIVERY_DECISION: repair the independently confirmed PORT configuration
defect without waiting for failed-deploy startup logs. Astra continues the escalated
UC-06 delivery; this fix does not change authentication or password/session behavior.

## Behavior and regression matrix

All three independent APIs now select `PORT > service-specific port > default`.
PORT is optional, but when set must be an integer in 1..65535. Local users leave
PORT unset to retain separate renter/owner/admin ports. The worker opens no listener.

| Requirement / branch | Evidence |
| --- | --- |
| PORT alone and PORT with competing service values | Config regression and each API bootstrap select 10000 |
| No PORT, explicit service port | Config preserves 3101/3102/3103; bootstrap binds service value |
| Neither port supplied | Validated defaults and raw factory defaults preserve 3001/3002/3003 |
| Invalid PORT | Empty, zero, negative, >65535, fractional, NaN, socket-like string fail validation |
| PORT boundaries | 1 and 65535 accepted and converted to numbers |
| Bootstrap exception/state | Migration failure prevents listen; bind failure prevents success log; migration precedes listener |
| Readiness compatibility | Existing health tests retain PostgreSQL ping; actual built APIs return database up |
| UC-06 concurrency/idempotency | Full existing suite including 24 PostgreSQL transaction tests passes |
| Security boundary | Deployment environment to numeric network listener; validation rejects non-port input; no new request/auth/tenant/data boundary |

Before implementation, focused config regression: 11 failures / 11 passes,
including PORT=10000 resolving to 3001/3002/3003 and lack of PORT validation.
After implementation: focused config/bootstrap/health 36 tests PASS.

## Technical gates

Tests use synthetic environment values and the existing disposable PostgreSQL 17
fixture on loopback 55461 (`gli261_test`), never deployment credentials.
The baseline suite initially rejected missing required environment fields; rerun
with synthetic valid configuration passed, and the identical environment was used
for the final suite.

- `GLI261_POSTGRES_TEST=1 npm run test:cov -- --coverageReporters=json-summary --coverageReporters=json`:
  baseline 35 suites / 234 tests; final 36 suites / 259 tests, all PASS.
- Same-scope repository coverage: lines 894/1022 (87.47%) unchanged;
  functions 205/243 (84.36%) unchanged; branches 531/617 (86.06%) to
  536/620 (86.45%). No coverage decrease or coverage configuration changes.
- Entire changed config file: 12/12 lines, 13/13 statements, 5/5 functions,
  67/67 branch arms (100% each), including all three port selection expressions.
- `npm run lint`, `npx tsc --noEmit`, `npm run build` (all four apps),
  `git diff --check`: PASS.
- The unchanged bootstrap remains excluded by existing coverage configuration;
  it now has 11 boundary tests. No changed logic is exempted from coverage.

On 2026-11-11 04:03:02-03 UTC, each compiled API was started sequentially via
`node dist/apps/<app>-api/main.js` with PORT=10000, competing service port=3100,
and the local PostgreSQL fixture. Each emitted `application_started.port=10000`.
All six GET checks (`/health/live`, `/health/ready` for renter, owner, admin) returned
200; readiness reported `database.status=up`. Processes were stopped after checks.
Local fixture ledger `migrations` contains `PasswordChange1700000007000`.
The production ledger is named `platform_migrations`; local fixture evidence does
not verify that remote ledger or prove a deployed revision.

## Focused security self-review

After implementation and verification, source-only review of the diff and affected
configuration/bootstrap/health path found no confirmed unresolved finding. No target
code or live probes ran during the audit phase. PORT is trusted deployment input,
validated before bootstrap; numeric conversion cannot select a socket path. Binding
address remains 0.0.0.0. PostgreSQL readiness, migrations, auth, tenant isolation,
secret handling and dependencies are unchanged. Regression covers invalid input,
failure-before-listen and failure-before-success-log cases.

Residual: setting a shared PORT for multiple API processes on one host can cause a
bind conflict, so README documents independent process deployment and leaving PORT
unset locally. npm ci reported existing dependency advisories; no dependency was
changed by this fix. Remote service revision, terminal Render deploy status and
production migration ledger require deployment control-plane evidence, not inference
from revisionless public health responses.
