# Email authentication, recovery, and role access

GLI-50 aligns the shared identity boundary with SmartTro UC-01 and UC-02. Normalized email
(`trim` then lowercase) is the unique MVP login identifier. Phone is optional, non-unique contact
data for new accounts and is never accepted by the production sign-in path.

## Sign-up contract

The production flow has three explicit steps and never auto-logs in:

1. `POST /auth/signup/otp/request` accepts an email and returns a generic `202` response. The same
   response shape is used when the email already has an account.
2. `POST /auth/signup/otp/verify` accepts the email, attempt ID and six-digit code. Its response
   confirms verification without returning an OTP, password, or token.
3. `POST /auth/signup/complete` resubmits the in-memory OTP with a valid password, atomically creates
   an active renter account, and returns `{ "created": true, "next": "sign_in" }`. It returns no JWT.

The optional phone on the completion request is stored as contact data. Concurrent completion or
duplicate-email races create at most one user and return the generic `SIGNUP_UNAVAILABLE` error.

## Sign-in and sessions

`POST /auth/login` accepts email and password only. Unknown email and wrong password both return
`INVALID_CREDENTIALS`. A correct password for a pending account returns `ACCOUNT_UNVERIFIED`; other
non-active states return `ACCOUNT_INACTIVE`. Happy-path sign-in never requires OTP.

Access tokens default to 15 minutes and refresh tokens to 30 days. Refresh tokens are persisted only
as SHA-256 hashes and rotate on every refresh. Reusing a rotated token revokes the token family.
`POST /auth/logout` revokes the current refresh-token session, while authenticated
`POST /auth/logout/all` revokes all sessions for the actor.

## OTP and abuse controls

| Rule                            |                            Default |
| ------------------------------- | ---------------------------------: |
| OTP digits                      |                                  6 |
| OTP lifetime                    |                         10 minutes |
| Wrong codes per challenge       |                                  5 |
| Resend cooldown                 |                         60 seconds |
| Requests per email              |                             5/hour |
| Requests per IP                 |                            20/hour |
| Requests per device             |                            20/hour |
| Password failures per email     |  5/15 minutes, then 15-minute lock |
| Password failures per IP/device | 20/15 minutes, then 15-minute lock |

OTP codes, passwords, access tokens and refresh tokens are never returned by the OTP request endpoint
or written to production application logs. OTPs are stored only as HMAC-SHA256 digests.
`X-Device-Id` is the preferred device abuse-control key; when
it is absent the service derives a bounded fallback from IP and user agent.

## Delivery adapters

`EmailDeliveryPort` isolates the email provider. `EMAIL_DELIVERY_MODE=console` is allowed only for
local development. Production and disabled mode fail closed with `OTP_PROVIDER_UNAVAILABLE` until a
real provider adapter is configured.

The GLI-11 phone registration, passwordless OTP login and phone recovery routes remain available
only for compatibility and are disabled by default with `LEGACY_PHONE_FLOWS_ENABLED=false`. They are
outside UC-01/UC-02 and must not be enabled in production pending UC-03 and a supported provider.

## Configuration

JWT and OTP secrets are required and must contain at least 32 characters. Policy settings are:

- `JWT_ACCESS_TTL_SECONDS=900`
- `JWT_REFRESH_TTL_SECONDS=2592000`
- `OTP_TTL_SECONDS=600`
- `OTP_MAX_ATTEMPTS=5`
- `OTP_RESEND_COOLDOWN_SECONDS=60`
- `OTP_REQUEST_LIMIT_PER_HOUR=5`
- `OTP_IP_LIMIT_PER_HOUR=20`
- `OTP_DEVICE_LIMIT_PER_HOUR=20`
- `LOGIN_FAILURE_LIMIT=5`
- `LOGIN_ABUSE_LIMIT=20`
- `LOGIN_WINDOW_SECONDS=900`
- `LOGIN_LOCK_SECONDS=900`
- `EMAIL_DELIVERY_MODE=disabled|console|brevo`
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME` are required when
  `EMAIL_DELIVERY_MODE=brevo`. Store the API key only in the deployment secret store.
- `LEGACY_PHONE_FLOWS_ENABLED=false`

The machine-readable contract is [OpenAPI](openapi.yaml).

## UC-03 password recovery

Password recovery uses three independent endpoints:

1. `POST /auth/password/recovery/request` always returns the neutral Vietnamese message plus an
   opaque challenge ID. Only active accounts with a password receive an email. Unknown, pending,
   disabled, and social-only accounts are not created or linked.
2. `POST /auth/password/recovery/verify` consumes a valid six-digit OTP and returns a random reset
   token. The token is stored only as an HMAC digest, expires after 10 minutes, and is bound to the
   requesting `X-Device-Id` (or the bounded IP/user-agent fallback).
3. `POST /auth/password/recovery/reset` validates password confirmation and the UC-01 policy,
   rejects the current password, atomically consumes the token, changes the password, and revokes
   every access/refresh session. It does not create a new session.

Recovery request throttles default to 5 requests per 15 minutes per normalized email and 20 per
hour per IP/device. A new challenge invalidates the old challenge; five wrong OTPs cancel the
challenge. Recovery audit rows contain an immutable user ID when one is known and a masked email,
never an OTP, reset token, or password.

Migration `1700000003000-password-recovery` is additive. Its rollback drops only
`password_reset_tokens`; rolling it back invalidates outstanding reset tokens but does not modify
users, passwords, OTP history, or sessions.

## Acceptance-criteria test map

| Requirement                                          | Automated coverage                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Email normalization and password validation          | `auth.dto.spec.ts`                                                  |
| Request, verify, complete, no auto-login             | `auth.service.spec.ts` full signup case                             |
| Generic existing-account and credential responses    | generic request/login cases                                         |
| 10-minute expiry, five wrong codes, 60-second resend | OTP boundary cases                                                  |
| Email/IP/device request throttles                    | request limit and rate-limiter tests                                |
| Five login failures and 15-minute lock               | login lockout case                                                  |
| Completion concurrency and token single use          | completion race case                                                |
| Access/refresh rotation and logout current/all       | session lifecycle case                                              |
| Provider fail-closed behavior                        | `otp-delivery.port.spec.ts`                                         |
| Additive migration contract                          | `1700000002000-email-identity-auth.spec.ts` plus DB migration smoke |
