# UC-03 backend test matrix

| AC / logic branch                                                          | Automated evidence                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| AC-01 normalize valid email and send one OTP                               | `auth.service.spec.ts` neutral eligible/ineligible contract  |
| AC-01 nonexistent, unverified, social-only do not enumerate or create/link | neutral contract parameter cases                             |
| AC-01 provider unavailable before lookup                                   | existing fail-closed adapter tests                           |
| AC-01 provider send failure after lookup                                   | recovery provider-failure privacy case                       |
| AC-02 correct OTP issues a 10-minute reset token                           | context-bound token case                                     |
| AC-02 wrong OTP attempts 1 through 5 cancel challenge                      | five-failure boundary case                                   |
| AC-02 expired, replaced, consumed, or raced OTP                            | expiry/replacement/replay and repository mutation tests      |
| AC-03 resend before/after 60 seconds and invalidation                      | cooldown/replacement case                                    |
| AC-03 email limit 5/15 minutes                                             | request-limit boundary case                                  |
| AC-03 IP/device signals and fallback key                                   | rate-limiter plus missing-metadata compatibility tests       |
| AC-04 password policy and confirmation                                     | `auth.dto.spec.ts` plus confirmation mismatch case           |
| AC-04 reject current password                                              | current-password reuse case                                  |
| AC-04 token expiry, replay, and device mismatch                            | reset failure matrix                                         |
| AC-04 atomic password update, token consume, all-session revoke            | reset/session test and PostgreSQL transaction implementation |
| AC-04 concurrent double submit                                             | `Promise.allSettled` reset race case                         |
| AC-06 no OTP/token/password in recovery audit/log output                   | audit assertions and delivery adapter test                   |
| Compatibility                                                              | full UC-01/UC-02 and legacy gated phone suite                |

Database integration uses the real PostgreSQL SQL contract through the TypeORM repository and the
additive migration spec. Review/staging migration smoke still requires the environment-managed Neon
connection; no database or Brevo secret is committed.
