import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ContractRepository, type ActiveRenterContractRecord } from './contract.repository';

interface ActiveRenterContractRow {
  contract_id: string;
  room: string | null;
  property: string | null;
  expires_at: string | null;
  renter_signed_at: Date | null;
  activated_at: Date | null;
}

@Injectable()
export class PostgresContractRepository extends ContractRepository {
  public constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  public async listActiveRenterContracts(
    renterId: string,
  ): Promise<readonly ActiveRenterContractRecord[]> {
    const rows = await this.dataSource.query<ActiveRenterContractRow[]>(
      `
        SELECT
          c.id AS contract_id,
          r.name AS room,
          p.name AS property,
          c.ends_on::text AS expires_at,
          c.renter_signed_at,
          c.activated_at
        FROM contracts c
        LEFT JOIN rooms r ON r.id = c.room_id
        LEFT JOIN properties p ON p.id = r.property_id
        WHERE c.renter_id = $1 AND c.status = 'active'
      `,
      [renterId],
    );
    return rows.map((row) => ({
      contractId: row.contract_id,
      room: row.room,
      property: row.property,
      expiresAt: row.expires_at,
      renterSignedAt: row.renter_signed_at ? new Date(row.renter_signed_at) : null,
      activatedAt: row.activated_at ? new Date(row.activated_at) : null,
    }));
  }
}
