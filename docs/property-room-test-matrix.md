# GLI-43 Test Matrix

| Acceptance criterion         | Cases                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner CRUD and authorization | Owner creates/reads/updates/deletes own property and room; another owner receives not found; room must belong to its requested property.                                            |
| Status policy                | Property accepts draft/active/inactive and rejects suspended; room accepts available/maintenance/inactive and rejects reserved/occupied.                                            |
| Contract guard               | Available is rejected with an active contract and succeeds without one.                                                                                                             |
| Public and batch listings    | Only active, non-deleted property plus available, non-deleted room is exposed; batches reject empty, >10, duplicate, missing, mixed property, mixed owner, and report self-booking. |
| Events                       | Status and deletion payloads contain the room/property/owner snapshots required by Viewing without a repository dependency.                                                         |
| Media boundary               | Upload requires owning actor, retains provider-neutral metadata, and public reads return published assets only.                                                                     |
