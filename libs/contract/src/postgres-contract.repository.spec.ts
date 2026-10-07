import type { DataSource } from 'typeorm';
import { PostgresContractRepository } from './postgres-contract.repository';

describe('PostgresContractRepository', () => {
  it('reads only active contracts that meet the signed lifecycle invariant without suppressing inactive or soft-deleted rooms/properties', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        contract_id: 'contract-a',
        room: 'Phong 1',
        property: 'Nha A',
        expires_at: '2027-01-01',
        owner_signed_at: '2025-12-31T00:00:00.000Z',
        renter_signed_at: '2026-01-01T00:00:00.000Z',
        activated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const repository = new PostgresContractRepository({ query } as unknown as DataSource);

    await expect(repository.listActiveRenterContracts('renter-a')).resolves.toEqual([
      {
        contractId: 'contract-a',
        room: 'Phong 1',
        property: 'Nha A',
        expiresAt: '2027-01-01',
        ownerSignedAt: new Date('2025-12-31T00:00:00.000Z'),
        renterSignedAt: new Date('2026-01-01T00:00:00.000Z'),
        activatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain("c.status = 'active'");
    expect(sql).toContain('c.owner_signed_at IS NOT NULL');
    expect(sql).toContain('c.renter_signed_at IS NOT NULL');
    expect(sql).toContain('c.activated_at IS NOT NULL');
    expect(sql).toContain('c.ends_on IS NOT NULL');
    expect(sql).toContain('LEFT JOIN rooms');
    expect(sql).toContain('LEFT JOIN properties');
    expect(sql).not.toContain('deleted_at');
    expect(query).toHaveBeenCalledWith(expect.any(String), ['renter-a']);
  });

  it('preserves null lifecycle evidence if a database row bypasses the SQL predicate', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        contract_id: 'invalid-contract',
        room: 'Phong 1',
        property: 'Nha A',
        expires_at: null,
        owner_signed_at: null,
        renter_signed_at: null,
        activated_at: null,
      },
    ]);
    const repository = new PostgresContractRepository({ query } as unknown as DataSource);

    await expect(repository.listActiveRenterContracts('renter-a')).resolves.toEqual([
      {
        contractId: 'invalid-contract',
        room: 'Phong 1',
        property: 'Nha A',
        expiresAt: null,
        ownerSignedAt: null,
        renterSignedAt: null,
        activatedAt: null,
      },
    ]);
  });
});
