# PostgreSQL baseline

The first migration owns the complete GLI-12 baseline. Application startup never uses
`synchronize`; every schema change must be a reviewed migration.

```mermaid
erDiagram
  USERS ||--o{ USER_ROLES : receives
  ROLES ||--o{ USER_ROLES : grants
  USERS ||--o| OWNER_PROFILES : has
  USERS ||--o| RENTER_PROFILES : has
  USERS ||--o{ PROPERTIES : owns
  PROPERTIES ||--o{ ROOMS : contains
  ROOMS ||--o{ BOOKINGS : requested_for
  USERS ||--o{ BOOKINGS : renter
  BOOKINGS ||--o| CONTRACTS : creates
  ROOMS ||--o{ CONTRACTS : assigned_to
  CONTRACTS ||--o{ INVOICES : bills
  INVOICES ||--|{ INVOICE_ITEMS : contains
  INVOICES ||--o{ PAYMENTS : payment_intent
  PAYMENTS ||--o{ PAYMENT_EVENTS : receives
  INVOICES ||--o{ PAYMENT_ALLOCATIONS : receives
  PAYMENTS ||--o{ PAYMENT_ALLOCATIONS : allocates
  PROPERTIES ||--o{ MAINTENANCE_REPORTS : has
  USERS ||--o{ NOTIFICATIONS : receives
  USERS ||--o{ MEDIA_FILES : uploads
```

## Booking and contract support

Bookings retain renter, owner, room and viewing-window snapshots through foreign keys and indexed
schedule fields. The schema permits the approved flow while leaving conflict-resolution policy to
the booking feature issue. One booking can produce at most one contract, and one room can have at
most one `active` contract. Signed timestamps and immutable `terms_snapshot` support the proposed
contract flow and later PDF generation.

## Billing and payment support

Invoices own debt state and expose a generated outstanding amount. Payments own gateway state,
unique idempotency keys and unique provider references. `payment_events` is the idempotent webhook
inbox; `payment_allocations` is billing-owned evidence that a verified successful payment was
applied to an invoice. An invoice cannot be marked paid merely because a browser redirect succeeds.

```mermaid
stateDiagram-v2
  [*] --> created
  created --> pending_gateway
  pending_gateway --> success: verified provider result
  pending_gateway --> failed
  pending_gateway --> expired
  success --> refund_pending
  refund_pending --> refunded
```

## Migration and seed policy

1. Migrations are immutable after merge and execute transactionally.
2. `synchronize` stays disabled in every environment.
3. Deployment runs migration, idempotent seed and schema verification before application rollout.
4. Rollback uses `db:migration:revert`; data migrations require an explicit recovery plan.
5. Reference roles (`renter`, `owner`, `admin`) are seeded separately so migrations remain schema-focused.
