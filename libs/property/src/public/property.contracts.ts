export type PropertyStatus = 'draft' | 'active' | 'inactive' | 'suspended';
export type OwnerPropertyStatus = Exclude<PropertyStatus, 'suspended'>;
export type RoomStatus = 'available' | 'reserved' | 'occupied' | 'maintenance' | 'inactive';
export type OwnerRoomStatus = Extract<RoomStatus, 'available' | 'maintenance' | 'inactive'>;

export interface PropertyRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  address: Record<string, unknown>;
  status: PropertyStatus;
  deletedAt: Date | null;
}

export interface RoomRecord {
  id: string;
  propertyId: string;
  ownerId: string;
  code: string;
  name: string;
  description: string | null;
  monthlyRent: string;
  depositAmount: string;
  currency: string;
  status: RoomStatus;
  deletedAt: Date | null;
}

export interface RoomBookableSnapshot {
  roomId: string;
  propertyId: string;
  ownerId: string;
  status: RoomStatus;
  monthlyRent: string;
  depositAmount: string;
  currency: string;
}

export interface RoomContractSnapshot extends RoomBookableSnapshot {
  propertyAddress: Record<string, unknown>;
}

export interface RoomBillingSnapshot {
  roomId: string;
  propertyId: string;
  ownerId: string;
  roomCode: string;
}

export interface ViewingRoomSnapshot {
  roomId: string;
  propertyId: string;
  ownerId: string;
  propertyStatus: PropertyStatus;
  roomStatus: RoomStatus;
  propertyDeleted: boolean;
  roomDeleted: boolean;
  bookable: boolean;
}

export interface ViewingRoomsSnapshot {
  propertyId: string;
  ownerId: string;
  rooms: readonly ViewingRoomSnapshot[];
  renterIsOwner: boolean;
}

export interface CreatePropertyInput {
  name: string;
  description?: string | null;
  address: Record<string, unknown>;
}

export interface UpdatePropertyInput {
  name?: string;
  description?: string | null;
  address?: Record<string, unknown>;
}

export interface CreateRoomInput {
  code: string;
  name: string;
  description?: string | null;
  monthlyRent: string;
  depositAmount?: string;
  currency?: string;
}

export interface UpdateRoomInput {
  code?: string;
  name?: string;
  description?: string | null;
  monthlyRent?: string;
  depositAmount?: string;
  currency?: string;
}

export type PropertyDomainEvent =
  | {
      type: 'RoomStatusChanged';
      roomId: string;
      propertyId: string;
      ownerId: string;
      oldStatus: RoomStatus;
      newStatus: RoomStatus;
    }
  | {
      type: 'RoomDeleted';
      roomId: string;
      propertyId: string;
      ownerId: string;
      status: RoomStatus;
    }
  | {
      type: 'PropertyStatusChanged';
      propertyId: string;
      ownerId: string;
      oldStatus: PropertyStatus;
      newStatus: PropertyStatus;
    }
  | {
      type: 'PropertyDeleted';
      propertyId: string;
      ownerId: string;
      status: PropertyStatus;
    };

export abstract class PropertyEventPublisher {
  public abstract publish(event: PropertyDomainEvent): Promise<void>;
}

export abstract class PropertyQueryService {
  public abstract listPublicRooms(): Promise<readonly RoomRecord[]>;
  public abstract getRoomBookableSnapshot(roomId: string): Promise<RoomBookableSnapshot | null>;
  public abstract getRoomContractSnapshot(roomId: string): Promise<RoomContractSnapshot | null>;
  public abstract getRoomBillingSnapshot(roomId: string): Promise<RoomBillingSnapshot | null>;
  public abstract getViewingRoomsSnapshot(
    roomIds: readonly string[],
    renterId: string,
  ): Promise<ViewingRoomsSnapshot>;
}

export abstract class PropertyPolicyService {
  public abstract assertRoomBookable(roomId: string): Promise<void>;
  public abstract assertOwnerOwnsRoom(ownerId: string, roomId: string): Promise<void>;
  public abstract assertRoomAssignableToContract(roomId: string): Promise<void>;
}

export abstract class PropertyOwnerService {
  public abstract createProperty(ownerId: string, input: CreatePropertyInput): Promise<PropertyRecord>;
  public abstract listProperties(ownerId: string): Promise<readonly PropertyRecord[]>;
  public abstract getProperty(ownerId: string, propertyId: string): Promise<PropertyRecord>;
  public abstract updateProperty(ownerId: string, propertyId: string, input: UpdatePropertyInput): Promise<PropertyRecord>;
  public abstract deleteProperty(ownerId: string, propertyId: string): Promise<void>;
  public abstract createRoom(ownerId: string, propertyId: string, input: CreateRoomInput): Promise<RoomRecord>;
  public abstract listRooms(ownerId: string, propertyId: string): Promise<readonly RoomRecord[]>;
  public abstract getRoom(ownerId: string, roomId: string): Promise<RoomRecord>;
  public abstract updateRoom(ownerId: string, roomId: string, input: UpdateRoomInput): Promise<RoomRecord>;
  public abstract setPropertyStatus(ownerId: string, propertyId: string, status: OwnerPropertyStatus): Promise<PropertyRecord>;
  public abstract setRoomStatus(ownerId: string, roomId: string, status: OwnerRoomStatus): Promise<RoomRecord>;
  public abstract deleteRoom(ownerId: string, roomId: string): Promise<void>;
}

export abstract class PropertyCommandService {
  public abstract markRoomOccupiedFromContract(roomId: string, contractId: string): Promise<void>;
  public abstract markRoomAvailableFromContract(roomId: string, contractId: string): Promise<void>;
}
