export interface RoomBookableSnapshot {
  roomId: string;
  propertyId: string;
  ownerId: string;
  status: 'available' | 'reserved' | 'occupied' | 'maintenance' | 'inactive';
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

export abstract class PropertyQueryService {
  public abstract getRoomBookableSnapshot(roomId: string): Promise<RoomBookableSnapshot | null>;
  public abstract getRoomContractSnapshot(roomId: string): Promise<RoomContractSnapshot | null>;
  public abstract getRoomBillingSnapshot(roomId: string): Promise<RoomBillingSnapshot | null>;
}

export abstract class PropertyPolicyService {
  public abstract assertRoomBookable(roomId: string): Promise<void>;
  public abstract assertOwnerOwnsRoom(ownerId: string, roomId: string): Promise<void>;
  public abstract assertRoomAssignableToContract(roomId: string): Promise<void>;
}

export abstract class PropertyCommandService {
  public abstract markRoomOccupiedFromContract(roomId: string, contractId: string): Promise<void>;
  public abstract markRoomAvailableFromContract(roomId: string, contractId: string): Promise<void>;
}
