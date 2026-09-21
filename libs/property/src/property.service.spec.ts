/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DefaultPropertyService } from './property.service';
import {
  PropertyEventPublisher,
  type PropertyRecord,
  type RoomRecord,
} from './public/property.contracts';
import { PropertyRepository } from './property.repository';

class Repository extends PropertyRepository {
  properties = new Map<string, PropertyRecord>();
  rooms = new Map<string, RoomRecord>();
  active = new Set<string>();
  async listPublicRooms() {
    return [...this.rooms.values()].filter((room) => {
      const property = this.properties.get(room.propertyId);
      return Boolean(
        property &&
        !property.deletedAt &&
        property.status === 'active' &&
        !room.deletedAt &&
        room.status === 'available',
      );
    });
  }
  async createProperty(x: Omit<PropertyRecord, 'id' | 'deletedAt'>) {
    const property = { ...x, id: `p-${this.properties.size + 1}`, deletedAt: null };
    this.properties.set(property.id, property);
    return property;
  }
  async listPropertiesByOwner(ownerId: string) {
    return [...this.properties.values()].filter((x) => x.ownerId === ownerId && !x.deletedAt);
  }
  async findProperty(id: string) {
    return this.properties.get(id) ?? null;
  }
  async findRoom(id: string) {
    return this.rooms.get(id) ?? null;
  }
  async createRoom(x: Omit<RoomRecord, 'id' | 'ownerId' | 'deletedAt'>) {
    const room = {
      ...x,
      id: `r-${this.rooms.size + 1}`,
      ownerId: this.properties.get(x.propertyId)!.ownerId,
      deletedAt: null,
    };
    this.rooms.set(room.id, room);
    return room;
  }
  async listRoomsByProperty(propertyId: string) {
    return [...this.rooms.values()].filter((x) => x.propertyId === propertyId && !x.deletedAt);
  }
  async findRooms(ids: readonly string[]) {
    return ids.map((id) => this.rooms.get(id)).filter((x): x is RoomRecord => Boolean(x));
  }
  async hasActiveContract(id: string) {
    return this.active.has(id);
  }
  async saveProperty(x: PropertyRecord) {
    this.properties.set(x.id, x);
    return x;
  }
  async saveRoom(x: RoomRecord) {
    this.rooms.set(x.id, x);
    return x;
  }
}
class Events extends PropertyEventPublisher {
  events = [];
  async publish(event: never) {
    this.events.push(event);
  }
}
describe('property policy', () => {
  const property: PropertyRecord = {
    id: 'p',
    ownerId: 'owner',
    name: 'P',
    description: null,
    address: {},
    status: 'active',
    deletedAt: null,
  };
  const room: RoomRecord = {
    id: 'r',
    propertyId: 'p',
    ownerId: 'owner',
    code: 'A',
    name: 'A',
    description: null,
    monthlyRent: '1',
    depositAmount: '0',
    currency: 'VND',
    status: 'maintenance',
    deletedAt: null,
  };
  function setup() {
    const repo = new Repository(),
      events = new Events();
    repo.properties.set('p', property);
    repo.rooms.set('r', room);
    return { repo, events, service: new DefaultPropertyService(repo, events) };
  }
  it('enforces owner status matrix, contract guard and emits status events', async () => {
    const { repo, events, service } = setup();
    await expect(
      service.setPropertyStatus('owner', 'p', 'suspended' as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setRoomStatus('owner', 'r', 'occupied' as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    repo.active.add('r');
    await expect(service.setRoomStatus('owner', 'r', 'available')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    repo.active.delete('r');
    await expect(service.setRoomStatus('owner', 'r', 'available')).resolves.toMatchObject({
      status: 'available',
    });
    expect(events.events).toEqual([
      {
        type: 'RoomStatusChanged',
        roomId: 'r',
        propertyId: 'p',
        ownerId: 'owner',
        oldStatus: 'maintenance',
        newStatus: 'available',
      },
    ]);
  });
  it('emits deletion snapshots without exposing repositories to event consumers', async () => {
    const { events, service } = setup();
    await service.deleteRoom('owner', 'r');
    await service.deleteProperty('owner', 'p');
    expect(events.events).toEqual([
      {
        type: 'RoomDeleted',
        roomId: 'r',
        propertyId: 'p',
        ownerId: 'owner',
        status: 'maintenance',
      },
      { type: 'PropertyDeleted', propertyId: 'p', ownerId: 'owner', status: 'active' },
    ]);
  });
  it('returns only active, available, non-deleted rooms publicly', async () => {
    const { repo, service } = setup();
    repo.rooms.set('r', { ...room, status: 'available' });
    repo.rooms.set('hidden', { ...room, id: 'hidden', status: 'maintenance' });
    await expect(service.listPublicRooms()).resolves.toMatchObject([{ id: 'r' }]);
    repo.properties.set('p', { ...property, status: 'inactive' });
    await expect(service.listPublicRooms()).resolves.toEqual([]);
  });
  it('rejects cross-owner access and produces a stable bookability batch', async () => {
    const { repo, service } = setup();
    await expect(service.assertOwnerOwnsRoom('other', 'r')).rejects.toBeTruthy();
    await expect(service.getViewingRoomsSnapshot([], 'renter')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.getViewingRoomsSnapshot(['r'], 'owner')).resolves.toMatchObject({
      propertyId: 'p',
      ownerId: 'owner',
      renterIsOwner: true,
      rooms: [{ bookable: false }],
    });
    repo.rooms.set('r', { ...room, status: 'available' });
    await expect(service.getViewingRoomsSnapshot(['r'], 'renter')).resolves.toMatchObject({
      renterIsOwner: false,
      rooms: [{ bookable: true }],
    });
  });
  it('creates, reads, updates and hides owner-owned resources', async () => {
    const { service } = setup();
    const created = await service.createProperty('owner', {
      name: 'New',
      address: { city: 'HCM' },
    });
    await expect(service.getProperty('other', created.id)).rejects.toBeTruthy();
    await expect(
      service.updateProperty('owner', created.id, { name: 'Renamed' }),
    ).resolves.toMatchObject({ name: 'Renamed' });
    const createdRoom = await service.createRoom('owner', created.id, {
      code: '01',
      name: 'Room',
      monthlyRent: '100',
    });
    await expect(service.getRoom('other', createdRoom.id)).rejects.toBeTruthy();
    await expect(
      service.updateRoom('owner', createdRoom.id, { name: 'Updated' }),
    ).resolves.toMatchObject({ name: 'Updated' });
    await service.deleteRoom('owner', createdRoom.id);
    await expect(service.listRooms('owner', created.id)).resolves.toEqual([]);
  });
});
