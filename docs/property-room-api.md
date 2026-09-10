# Property/Room API and boundaries

Owner API (`owner-api`, Bearer session with `owner` role): `POST/GET /properties`, `GET/PATCH/DELETE /properties/:propertyId`, `PATCH /properties/:propertyId/status`, and equivalent nested room operations at `/properties/:propertyId/rooms` and `/properties/rooms/:roomId`. Cross-owner identifiers return `PROPERTY_NOT_FOUND` or `ROOM_NOT_FOUND`.

Owner property status input is `draft|active|inactive`; `suspended` is rejected. Owner room status input is `available|maintenance|inactive`; `reserved|occupied` is rejected. An active contract rejects transition to `available` with `ROOM_ACTIVE_CONTRACT`.

`PropertyQueryService.getViewingRoomsSnapshot(roomIds, renterId)` accepts 1-10 unique IDs and returns one property/owner batch plus per-room property/room status, deletion flags, `bookable`, and `renterIsOwner`. Mixed owner/property is `MIXED_ROOM_BATCH`; missing IDs are `ROOM_NOT_FOUND`.

Events are typed `PropertyDomainEvent`: `RoomStatusChanged` and `PropertyStatusChanged` contain identity and old/new status; `RoomDeleted` and `PropertyDeleted` contain identity plus the deletion-time status. Consumers do not import Property repositories or entities.

Listing assets use `ListingAssetService`: callers authenticate as the owner, ownership is checked via `ListingAssetSubjectAuthorizer`, and storage is delegated to `ListingAssetStorage` with provider/bucket/object-key metadata. Only `ready` and `published` assets are available through `listPublic`; private reads and publication require ownership, and non-ready assets cannot be published.
