# Smart Platform Services

Shared backend for SmartTro, SmartChu and SmartAdmin. The repository is a NestJS modular
monorepo with four independently deployable entrypoints:

| Entrypoint   | Default port | Purpose                                            |
| ------------ | -----------: | -------------------------------------------------- |
| `renter-api` |         3001 | SmartTro APIs                                      |
| `owner-api`  |         3002 | SmartChu APIs                                      |
| `admin-api`  |         3003 | SmartAdmin APIs                                    |
| `worker`     |          N/A | Outbox, notification and scheduled background work |

## Architecture

The core domains are `identity`, `property`, `booking`, `contract`, `billing`, `payment`
and `audit`. Supporting table owners are `maintenance`, `notification` and `media`.

Domain code must not import another domain's repository, entity, schema or table. Cross-domain
reads use public query/policy contracts, writes use public command contracts or events, and
query results are immutable snapshots. See [module boundaries](docs/module-boundaries.md).

## Local setup

Requirements: Node.js 22+, npm 10+ and Docker with Compose.

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run db:migration:run
npm run db:seed
npm run db:verify
npm run start:renter
```

Use a local-only database password in `.env`; never commit real credentials. Migrations run
separately from application startup so releases can apply and verify schema changes before
new processes receive traffic. `db:seed` is idempotent and safely updates the three base role
descriptions on repeated runs.

## Health endpoints

Each API exposes:

- `GET /health/live`: process liveness without downstream checks.
- `GET /health` and `GET /health/ready`: readiness including PostgreSQL connectivity.

## API errors and logs

All uncaught HTTP errors use one response envelope:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Request validation failed",
    "details": ["email must be an email"],
    "requestId": "7f23f410-e25c-4868-a1fe-dd2339b95983",
    "timestamp": "2026-08-27T00:00:00.000Z",
    "path": "/example"
  }
}
```

The same request ID is returned in `x-request-id` and included in structured JSON request logs.
Unexpected errors are logged server-side without exposing their internal message to clients.

## Production email OTP

Production email OTP uses Brevo transactional email with `EMAIL_DELIVERY_MODE=brevo`. Configure
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL` and `BREVO_SENDER_NAME` in the deployment environment; never
commit provider credentials. Console delivery remains development-only and fails closed in
production.

## Quality commands

```bash
npm run lint
npm run format:check
npm test
npm run test:cov
npm run build
```

The initial PostgreSQL model and state rationale are documented in
[database ERD](docs/database-erd.md).

Email authentication, OTP, rotating JWT sessions, OAuth hooks and role guards are documented in
[authentication and role access](docs/authentication.md).
