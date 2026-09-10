import type { PropertyRecord, RoomRecord } from './public/property.contracts';

export abstract class PropertyRepository {
  public abstract createProperty(property: Omit<PropertyRecord, 'id' | 'deletedAt'>): Promise<PropertyRecord>;
  public abstract listPropertiesByOwner(ownerId: string): Promise<readonly PropertyRecord[]>;
  public abstract findProperty(id: string): Promise<PropertyRecord | null>;
  public abstract createRoom(room: Omit<RoomRecord, 'id' | 'ownerId' | 'deletedAt'>): Promise<RoomRecord>;
  public abstract listRoomsByProperty(propertyId: string): Promise<readonly RoomRecord[]>;
  public abstract findRoom(id: string): Promise<RoomRecord | null>;
  public abstract findRooms(ids: readonly string[]): Promise<readonly RoomRecord[]>;
  public abstract hasActiveContract(roomId: string): Promise<boolean>;
  public abstract saveProperty(property: PropertyRecord): Promise<PropertyRecord>;
  public abstract saveRoom(room: RoomRecord): Promise<RoomRecord>;
}
