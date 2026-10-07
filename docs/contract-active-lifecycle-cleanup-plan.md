# Contract active lifecycle cleanup plan

## Audit result

At commit `5d130cb1949e4dc867e86fa94f96f9b2303846ce`, this repository has no Contract
create, update, owner-sign, renter-sign, activation controller/service, Contract seed, fixture,
or importer. The only active-Contract write guard was the partial unique room index. Therefore a
database constraint is the compatible enforcement point: it protects every present and future SQL,
administrative, seed, fixture, and import path without inventing the not-yet-approved GLI-18 command
contract. It is atomic with the attempted INSERT or UPDATE, so a rejected transition cannot persist
a partial active lifecycle write.

The additive `chk_contracts_active_lifecycle` constraint requires an `active` Contract to have
`owner_signed_at`, `renter_signed_at`, `activated_at`, and `ends_on`. Existing column constraints
already require the approved numeric, date, billing-day, and object-shaped term fields. `NOT VALID`
does not inspect or change existing rows during deployment, but PostgreSQL enforces the invariant on
all later INSERTs and UPDATEs. Cleanup remains a separately approved operation.

## Read-only inventory / dry run

Run only after the PM identifies an explicitly approved non-production environment. Do not run this
against production. The query emits technical Contract IDs, lifecycle columns, and a provenance
classification candidate only; it deliberately contains no user, room, property, signature payload,
or token data.

```sql
SELECT
  c.id AS contract_id,
  c.status,
  (c.owner_signed_at IS NOT NULL) AS has_owner_signature,
  (c.renter_signed_at IS NOT NULL) AS has_renter_signature,
  (c.activated_at IS NOT NULL) AS has_activated_at,
  (c.ends_on IS NOT NULL) AS has_expires_at,
  CASE
    WHEN c.owner_signed_at IS NULL OR c.renter_signed_at IS NULL
      OR c.activated_at IS NULL OR c.ends_on IS NULL THEN 'requires_provenance_review'
    ELSE 'lifecycle_complete'
  END AS provenance_classification
FROM contracts c
WHERE c.status = 'active'
  AND (
    c.owner_signed_at IS NULL OR c.renter_signed_at IS NULL
    OR c.activated_at IS NULL OR c.ends_on IS NULL
  )
ORDER BY c.id;

SELECT
  count(*) AS invalid_active_contract_count
FROM contracts c
WHERE c.status = 'active'
  AND (
    c.owner_signed_at IS NULL OR c.renter_signed_at IS NULL
    OR c.activated_at IS NULL OR c.ends_on IS NULL
  );
```

Null lifecycle fields are only a candidate signal. Before any cleanup, an approved operator must
classify each technical ID from authoritative environment provenance; no target may be inferred from
the query alone.

## Approval gate, backup, and rollback

1. PM/PO approves the environment identifier, the exact technical IDs, record count, and provenance.
2. In one read-only transaction, export only the approved Contract rows to an access-controlled backup
   location, record its checksum and the query count, and confirm the backup can be restored.
3. A separately reviewed cleanup script must target only the approved ID list, run in one transaction,
   and emit before/after counts without PII. This task neither provides nor executes that script.
4. If validation fails, roll back the transaction. If a completed cleanup must be reversed, restore the
   approved backup using a separately reviewed transaction and re-run the dry-run count.

## Test matrix

| Acceptance criterion | Coverage                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-01                | Migration test verifies the database-level atomic active-state guard for missing owner signature, renter signature, activation time, and expiry; it applies to create/update/import paths.                                     |
| AC-02                | Repository SQL excludes invalid active rows; query service independently filters each missing prerequisite and emits one count-only diagnostic.                                                                                |
| AC-03                | This document supplies the PII-free, read-only inventory query, aggregate query, approval gate, backup procedure, and rollback procedure. No environment credentials are included in the repository.                           |
| AC-04                | Tests cover a valid fully signed active record, each invalid lifecycle prerequisite, malformed active relation, SQL predicate, migration registration, and migration rollback. No Contract seed/fixture path exists to update. |
