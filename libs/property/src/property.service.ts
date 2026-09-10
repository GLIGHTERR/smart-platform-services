import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type OwnerPropertyStatus,
  type OwnerRoomStatus,
  type CreatePropertyInput,
  type CreateRoomInput,
  type PropertyRecord,
  PropertyEventPublisher,
  PropertyPolicyService,
  PropertyQueryService,
  type RoomBillingSnapshot,
  type RoomBookableSnapshot,
  type RoomContractSnapshot,
  type RoomRecord,
  type UpdatePropertyInput,
  type UpdateRoomInput,
  type ViewingRoomsSnapshot,
} from './public/property.contracts';
import { PropertyRepository } from './property.repository';

@Injectable()
export class DefaultPropertyService extends PropertyQueryService implements PropertyPolicyService {
  public constructor(
    private readonly repository: PropertyRepository,
    private readonly events: PropertyEventPublisher,
  ) {
    super();
  }
  public listPublicRooms(): Promise<readonly RoomRecord[]> { return this.repository.listPublicRooms(); }

  public async createProperty(ownerId: string, input: CreatePropertyInput): Promise<PropertyRecord> {
    return this.repository.createProperty({
      ownerId,
      name: input.name,
      description: input.description ?? null,
      address: input.address,
      status: 'draft',
    });
  }
  public async listProperties(ownerId: string): Promise<readonly PropertyRecord[]> {
    return this.repository.listPropertiesByOwner(ownerId);
  }
  public async getProperty(ownerId: string, propertyId: string): Promise<PropertyRecord> {
    return this.ownedProperty(ownerId, propertyId);
  }
  public async updateProperty(
    ownerId: string,
    propertyId: string,
    input: UpdatePropertyInput,
  ): Promise<PropertyRecord> {
    const property = await this.ownedProperty(ownerId, propertyId);
    return this.repository.saveProperty({ ...property, ...input });
  }
  public async createRoom(
    ownerId: string,
    propertyId: string,
    input: CreateRoomInput,
  ): Promise<RoomRecord> {
    await this.ownedProperty(ownerId, propertyId);
    return this.repository.createRoom({
      propertyId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      monthlyRent: input.monthlyRent,
      depositAmount: input.depositAmount ?? '0',
      currency: input.currency ?? 'VND',
      status: 'available',
    });
  }
  public async listRooms(ownerId: string, propertyId: string): Promise<readonly RoomRecord[]> {
    await this.ownedProperty(ownerId, propertyId);
    return this.repository.listRoomsByProperty(propertyId);
  }
  public async getRoom(ownerId: string, roomId: string): Promise<RoomRecord> {
    const room = await this.requireRoom(roomId);
    await this.assertOwnerOwnsRoom(ownerId, roomId);
    return room;
  }
  public async updateRoom(ownerId: string, roomId: string, input: UpdateRoomInput): Promise<RoomRecord> {
    const room = await this.getRoom(ownerId, roomId);
    return this.repository.saveRoom({ ...room, ...input });
  }

  public async getRoomBookableSnapshot(roomId: string): Promise<RoomBookableSnapshot | null> {
    const room = await this.repository.findRoom(roomId);
    return room && !room.deletedAt ? this.bookableSnapshot(room) : null;
  }
  public async getRoomContractSnapshot(roomId: string): Promise<RoomContractSnapshot | null> {
    const room = await this.repository.findRoom(roomId);
    if (!room || room.deletedAt) return null;
    const property = await this.repository.findProperty(room.propertyId);
    if (!property || property.deletedAt) return null;
    return { ...this.bookableSnapshot(room), propertyAddress: property.address };
  }
  public async getRoomBillingSnapshot(roomId: string): Promise<RoomBillingSnapshot | null> {
    const room = await this.repository.findRoom(roomId);
    return room && !room.deletedAt
      ? { roomId: room.id, propertyId: room.propertyId, ownerId: room.ownerId, roomCode: room.code }
      : null;
  }
  public async getViewingRoomsSnapshot(
    roomIds: readonly string[],
    renterId: string,
  ): Promise<ViewingRoomsSnapshot> {
    if (roomIds.length < 1 || roomIds.length > 10 || new Set(roomIds).size !== roomIds.length)
      throw new BadRequestException({
        code: 'INVALID_ROOM_BATCH',
        message: 'Provide 1-10 unique room IDs',
      });
    const rooms = await this.repository.findRooms(roomIds);
    if (rooms.length !== roomIds.length)
      throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'A room was not found' });
    const propertyId = rooms[0]!.propertyId,
      ownerId = rooms[0]!.ownerId;
    if (rooms.some((room) => room.propertyId !== propertyId || room.ownerId !== ownerId))
      throw new BadRequestException({
        code: 'MIXED_ROOM_BATCH',
        message: 'Rooms must share a property and owner',
      });
    const property = await this.requireProperty(propertyId);
    return {
      propertyId,
      ownerId,
      renterIsOwner: renterId === ownerId,
      rooms: rooms.map((room) => ({
        roomId: room.id,
        propertyId,
        ownerId,
        propertyStatus: property.status,
        roomStatus: room.status,
        propertyDeleted: Boolean(property.deletedAt),
        roomDeleted: Boolean(room.deletedAt),
        bookable:
          !property.deletedAt &&
          !room.deletedAt &&
          property.status === 'active' &&
          room.status === 'available',
      })),
    };
  }
  public async assertRoomBookable(roomId: string): Promise<void> {
    const room = await this.requireRoom(roomId),
      property = await this.requireProperty(room.propertyId);
    if (
      room.deletedAt ||
      property.deletedAt ||
      room.status !== 'available' ||
      property.status !== 'active'
    )
      throw new ForbiddenException({
        code: 'ROOM_NOT_BOOKABLE',
        message: 'Room is not publicly bookable',
      });
  }
  public async assertOwnerOwnsRoom(ownerId: string, roomId: string): Promise<void> {
    const room = await this.requireRoom(roomId);
    if (room.ownerId !== ownerId || room.deletedAt)
      throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room was not found' });
  }
  public async assertRoomAssignableToContract(roomId: string): Promise<void> {
    await this.assertRoomBookable(roomId);
  }
  public async setPropertyStatus(
    ownerId: string,
    propertyId: string,
    status: OwnerPropertyStatus,
  ): Promise<PropertyRecord> {
    if (!['draft', 'active', 'inactive'].includes(status))
      throw new ForbiddenException({
        code: 'PROPERTY_STATUS_OWNER_FORBIDDEN',
        message: 'Owners cannot set suspended',
      });
    const property = await this.ownedProperty(ownerId, propertyId);
    const oldStatus = property.status;
    const saved = await this.repository.saveProperty({ ...property, status });
    await this.events.publish({
      type: 'PropertyStatusChanged',
      propertyId,
      ownerId,
      oldStatus,
      newStatus: status,
    });
    return saved;
  }
  public async setRoomStatus(
    ownerId: string,
    roomId: string,
    status: OwnerRoomStatus,
  ): Promise<RoomRecord> {
    if (!['available', 'maintenance', 'inactive'].includes(status))
      throw new ForbiddenException({
        code: 'ROOM_STATUS_OWNER_FORBIDDEN',
        message: 'Owners cannot set reserved or occupied',
      });
    const room = await this.requireRoom(roomId);
    await this.assertOwnerOwnsRoom(ownerId, roomId);
    if (status === 'available' && (await this.repository.hasActiveContract(roomId)))
      throw new BadRequestException({
        code: 'ROOM_ACTIVE_CONTRACT',
        message: 'A room with an active contract cannot become available',
      });
    const saved = await this.repository.saveRoom({ ...room, status });
    await this.events.publish({
      type: 'RoomStatusChanged',
      roomId,
      propertyId: room.propertyId,
      ownerId,
      oldStatus: room.status,
      newStatus: status,
    });
    return saved;
  }
  public async deleteProperty(ownerId: string, propertyId: string): Promise<void> {
    const property = await this.ownedProperty(ownerId, propertyId);
    await this.repository.saveProperty({ ...property, deletedAt: new Date() });
    await this.events.publish({ type: 'PropertyDeleted', propertyId, ownerId, status: property.status });
  }
  public async deleteRoom(ownerId: string, roomId: string): Promise<void> {
    const room = await this.requireRoom(roomId);
    await this.assertOwnerOwnsRoom(ownerId, roomId);
    await this.repository.saveRoom({ ...room, deletedAt: new Date() });
    await this.events.publish({
      type: 'RoomDeleted',
      roomId,
      propertyId: room.propertyId,
      ownerId,
      status: room.status,
    });
  }
  private async requireProperty(id: string): Promise<PropertyRecord> {
    const row = await this.repository.findProperty(id);
    if (!row)
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: 'Property was not found',
      });
    return row;
  }
  private async requireRoom(id: string): Promise<RoomRecord> {
    const row = await this.repository.findRoom(id);
    if (!row)
      throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room was not found' });
    return row;
  }
  private async ownedProperty(ownerId: string, id: string): Promise<PropertyRecord> {
    const row = await this.requireProperty(id);
    if (row.ownerId !== ownerId || row.deletedAt)
      throw new NotFoundException({
        code: 'PROPERTY_NOT_FOUND',
        message: 'Property was not found',
      });
    return row;
  }
  private bookableSnapshot(room: RoomRecord): RoomBookableSnapshot {
    return {
      roomId: room.id,
      propertyId: room.propertyId,
      ownerId: room.ownerId,
      status: room.status,
      monthlyRent: room.monthlyRent,
      depositAmount: room.depositAmount,
      currency: room.currency,
    };
  }
}
