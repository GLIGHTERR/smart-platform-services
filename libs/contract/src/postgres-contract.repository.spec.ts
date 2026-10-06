import type { DataSource } from 'typeorm';
import { PostgresContractRepository } from './postgres-contract.repository';

describe('PostgresContractRepository', () => {
  it('reads all active contracts for the renter without suppressing inactive or soft-deleted rooms/properties', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        contract_id: 'contract-a',
        room: 'Phong 1',
        property: 'Nha A',
        expires_at: '2027-01-01',
        renter_signed_at: '2026-01-01T00:00:00.000Z',
        activated_at: null,
      },
      {
        contract_id: 'contract-b',
        room: 'Phong 2',
        property: 'Nha B',
        expires_at: null,
        renter_signed_at: null,
        activated_at: '2026-02-01T00:00:00.000Z',
      },
    ]);
    const repository = new PostgresContractRepository({ query } as unknown as DataSource);

    await expect(repository.listActiveRenterContracts('renter-a')).resolves.toEqual([
      {
        contractId: 'contract-a',
        room: 'Phong 1',
        property: 'Nha A',
        expiresAt: '2027-01-01',
        renterSignedAt: new Date('2026-01-01T00:00:00.000Z'),
        activatedAt: null,
      },
      {
        contractId: 'contract-b',
        room: 'Phong 2',
        property: 'Nha B',
        expiresAt: null,
        renterSignedAt: null,
        activatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("c.status = 'active'");
    expect(sql).toContain('LEFT JOIN rooms');
    expect(sql).toContain('LEFT JOIN properties');
    expect(sql).not.toContain('deleted_at');
    expect(query).toHaveBeenCalledWith(expect.any(String), ['renter-a']);
  });
});
