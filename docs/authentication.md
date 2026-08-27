# Authentication, OTP and role access

GLI-11 implements one identity boundary shared by SmartTrọ, SmartChủ and SmartAdmin. Phone numbers
must use E.164 format. Public registration can grant only `renter` or `owner`; `admin` remains an
operationally provisioned role.

## HTTP contract

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create a pending phone/password renter or owner and send registration OTP |
| `POST` | `/auth/login` | Create a session with phone and password |
| `POST` | `/auth/otp/request` | Send an OTP for pending registration or passwordless login |
| `POST` | `/auth/otp/verify` | Activate registration or complete passwordless login |
| `POST` | `/auth/password/forgot` | Start password reset; always returns the same accepted response |
| `POST` | `/auth/password/reset` | Consume reset OTP, replace password and revoke all old sessions |
| `POST` | `/auth/password/change` | Verify current password, replace it and return a new sole session |
| `POST` | `/auth/token/refresh` | Rotate a refresh token and issue a new token pair |
| `POST` | `/auth/logout` | Revoke the session identified by a refresh token; idempotent |
| `POST` | `/auth/oauth/:provider` | Google/Facebook/Apple verifier hook |
| `GET` | `/auth/me` | Read the authenticated actor |
| `GET` | `/session/me` | Role-specific boundary in each renter, owner and admin API |

Password and OTP responses never return an OTP. `OTP_DELIVERY_MODE=console` exists only for local
development; production fails closed unless the application replaces `OtpDeliveryPort` with an SMS
adapter. Social endpoints similarly fail closed until a provider-specific
`SocialIdentityVerifier` validates the provider credential.

## Session behavior

Access tokens use HS256, have a 15-minute default TTL and are accepted only while their persisted
session and account remain active. Refresh tokens have a 30-day default TTL, are stored only as
SHA-256 hashes and rotate on every refresh. Reusing a rotated refresh token revokes its entire token
family. Logout, password change/reset, suspension and disabling therefore invalidate protected
requests immediately, not merely when an access token expires.

Each application applies `JwtAuthGuard` followed by `RolesGuard`. SmartTrọ accepts `renter`,
SmartChủ accepts `owner`, and SmartAdmin accepts `admin` on `/session/me`; an authenticated actor
with a different role receives `403 ROLE_FORBIDDEN`.

GLI-11 defines role checks only. `IdentityAccessService.assertPermission` remains fail-closed until
a later requirement defines a granular permission catalog; it never derives an unstated permission
from a role name.

## Conservative MVP abuse controls

These values are explicit GLI-11 assumptions because no product-specific thresholds were supplied:

| Operation | Key | Limit and lock |
| --- | --- | --- |
| Password login | normalized phone | 5 failures per 15 minutes, then 15-minute lock |
| Password login | source IP | 20 failures per 15 minutes, then 15-minute lock |
| OTP request | normalized phone | 3 requests per 15 minutes, then 15-minute lock |
| OTP request | source IP | 20 requests per hour, then 1-hour lock |
| OTP verification | normalized phone/source IP | 10 failures per 15 minutes, then 15-minute lock |
| One OTP challenge | challenge | 5 wrong codes maximum |

OTP codes are six digits, expire after five minutes, are single-use, and are stored only as an
HMAC-SHA256 digest. Forgot-password responses are neutral for known and unknown phones.

## Identity-linking and irreversible state assumptions

- A verified social provider subject may log in only through its existing provider link.
- A first social login may create a renter or owner only when the verifier supplies a verified
  email. It never auto-links to an existing account with the same email; that returns
  `EXPLICIT_IDENTITY_LINK_REQUIRED` for a future authenticated linking flow.
- Registration activation and password reset consume the OTP before changing account state. If a
  later infrastructure write fails, the user must request a new OTP; a consumed code is never made
  reusable.
- No endpoint grants `admin`, merges two identities, deletes an account, or silently changes roles.

## Configuration

`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `OTP_HASH_SECRET` are required and must each contain at
least 32 characters. Secrets must be unique per environment and managed outside source control.
TTL settings are `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` and `OTP_TTL_SECONDS`.

## Acceptance-criteria test map

| Acceptance criterion | Automated coverage |
| --- | --- |
| Phone register/login and OTP verification | `auth.service.spec.ts` registration and passwordless-login cases |
| Forgot/change password | `auth.service.spec.ts` reset and change cases |
| JWT refresh/logout behavior | refresh rotation, reuse and immediate logout case |
| Protected access and wrong-role rejection | `auth-guards.spec.ts` |
| OTP failure paths | five-failure lock and single-use cases |
| Lockout/rate limits | five failed password attempts case plus persisted throttle policy |
| Public identity access contracts | `identity-query.service.spec.ts` |

`npm run test:cov` enforces the repository thresholds and includes identity services and guards.
