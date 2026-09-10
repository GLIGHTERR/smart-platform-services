import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { PropertyRecord, RoomRecord } from './public/property.contracts';
import { PropertyRepository } from './property.repository';

interface PropertyRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  address: Record<string, unknown>;
  status: PropertyRecord['status'];
  deleted_at: Date | null;
}
interface RoomRow {
  id: string;
  property_id: string;
  owner_id: string;
  code: string;
  name: string;
  description: string | null;
  monthly_rent: string;
  deposit_amount: string;
  currency: string;
  status: RoomRecord['status'];
  deleted_at: Date | null;
}

@Injectable()
export class PostgresPropertyRepository extends PropertyRepository {
  public constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }
  public async listPublicRooms(): Promise<readonly RoomRecord[]> {
    return (await this.roomsQuery("p.status = 'active' AND p.deleted_at IS NULL AND r.status = 'available' AND r.deleted_at IS NULL", [])).map((row) => this.room(row));
  }
  public async findProperty(id: string): Promise<PropertyRecord | null> {
    const [row] = await this.dataSource.query<PropertyRow[]>(
      'SELECT id, owner_id, name, description, address, status, deleted_at FROM properties WHERE id = $1',
      [id],
    );
    return row ? this.property(row) : null;
  }
  public async createProperty(
    property: Omit<PropertyRecord, 'id' | 'deletedAt'>,
  ): Promise<PropertyRecord> {
    const [row] = await this.dataSource.query<PropertyRow[]>(
      'INSERT INTO properties (owner_id, name, description, address, status) VALUES ($1, $2, $3, $4, $5) RETURNING id, owner_id, name, description, address, status, deleted_at',
      [property.ownerId, property.name, property.description, property.address, property.status],
    );
    if (!row) throw new Error('Property insert returned no row');
    return this.property(row);
  }
  public async listPropertiesByOwner(ownerId: string): Promise<readonly PropertyRecord[]> {
    const rows = await this.dataSource.query<PropertyRow[]>(
      'SELECT id, owner_id, name, description, address, status, deleted_at FROM properties WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC',
      [ownerId],
    );
    return rows.map((row) => this.property(row));
  }
  public async findRoom(id: string): Promise<RoomRecord | null> {
    const [row] = await this.roomsQuery('r.id = $1', [id]);
    return row ? this.room(row) : null;
  }
  public async createRoom(room: Omit<RoomRecord, 'id' | 'ownerId' | 'deletedAt'>): Promise<RoomRecord> {
    const [row] = await this.dataSource.query<RoomRow[]>(
      'INSERT INTO rooms (property_id, code, name, description, monthly_rent, deposit_amount, currency, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, property_id, (SELECT owner_id FROM properties WHERE id = property_id) AS owner_id, code, name, description, monthly_rent, deposit_amount, currency, status, deleted_at',
      [room.propertyId, room.code, room.name, room.description, room.monthlyRent, room.depositAmount, room.currency, room.status],
    );
    if (!row) throw new Error('Room insert returned no row');
    return this.room(row);
  }
  public async listRoomsByProperty(propertyId: string): Promise<readonly RoomRecord[]> {
    return (await this.roomsQuery('r.property_id = $1 AND r.deleted_at IS NULL', [propertyId])).map((row) => this.room(row));
  }
  public async findRooms(ids: readonly string[]): Promise<readonly RoomRecord[]> {
    if (!ids.length) return [];
    return (await this.roomsQuery('r.id = ANY($1::uuid[])', [ids])).map((row) => this.room(row));
  }
  public async hasActiveContract(roomId: string): Promise<boolean> {
    const [row] = await this.dataSource.query<Array<{ exists: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM contracts WHERE room_id = $1 AND status = 'active') AS exists`,
      [roomId],
    );
    return Boolean(row?.exists);
  }
  public async saveProperty(property: PropertyRecord): Promise<PropertyRecord> {
    const [row] = await this.dataSource.query<PropertyRow[]>(
      'UPDATE properties SET name = $2, description = $3, address = $4, status = $5, deleted_at = $6 WHERE id = $1 RETURNING id, owner_id, name, description, address, status, deleted_at',
      [
        property.id,
        property.name,
        property.description,
        property.address,
        property.status,
        property.deletedAt,
      ],
    );
    if (!row) throw new Error('Property update returned no row');
    return this.property(row);
  }
  public async saveRoom(room: RoomRecord): Promise<RoomRecord> {
    const [row] = await this.dataSource.query<RoomRow[]>(
      'UPDATE rooms SET code = $2, name = $3, description = $4, monthly_rent = $5, deposit_amount = $6, currency = $7, status = $8, deleted_at = $9 WHERE id = $1 RETURNING id, property_id, code, name, description, monthly_rent, deposit_amount, currency, status, deleted_at',
      [
        room.id,
        room.code,
        room.name,
        room.description,
        room.monthlyRent,
        room.depositAmount,
        room.currency,
        room.status,
        room.deletedAt,
      ],
    );
    if (!row) throw new Error('Room update returned no row');
    return this.room(row);
  }
  private roomsQuery(where: string, values: unknown[]): Promise<RoomRow[]> {
    return this.dataSource.query<RoomRow[]>(
      `SELECT r.id, r.property_id, p.owner_id, r.code, r.name, r.description, r.monthly_rent, r.deposit_amount, r.currency, r.status, r.deleted_at FROM rooms r JOIN properties p ON p.id = r.property_id WHERE ${where}`,
      values,
    );
  }
  private property(row: PropertyRow): PropertyRecord {
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      description: row.description,
      address: row.address,
      status: row.status,
      deletedAt: row.deleted_at,
    };
  }
  private room(row: RoomRow): RoomRecord {
    return {
      id: row.id,
      propertyId: row.property_id,
      ownerId: row.owner_id,
      code: row.code,
      name: row.name,
      description: row.description,
      monthlyRent: String(row.monthly_rent),
      depositAmount: String(row.deposit_amount),
      currency: row.currency,
      status: row.status,
      deletedAt: row.deleted_at,
    };
  }
}
