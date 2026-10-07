import type { QueryRunner } from 'typeorm';
import { ContractActiveLifecycle1700000005000 } from './1700000005000-contract-active-lifecycle';

describe('ContractActiveLifecycle1700000005000', () => {
  it('adds a non-destructive invariant requiring both signatures, activation, and expiry for active contracts', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new ContractActiveLifecycle1700000005000().up({ query } as unknown as QueryRunner);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('ADD CONSTRAINT chk_contracts_active_lifecycle');
    expect(sql).toContain("status <> 'active'");
    expect(sql).toContain('owner_signed_at IS NOT NULL');
    expect(sql).toContain('renter_signed_at IS NOT NULL');
    expect(sql).toContain('activated_at IS NOT NULL');
    expect(sql).toContain('ends_on IS NOT NULL');
    expect(sql).toContain('NOT VALID');
  });

  it('removes only the added constraint on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new ContractActiveLifecycle1700000005000().down({ query } as unknown as QueryRunner);

    expect(String(query.mock.calls[0]?.[0])).toContain(
      'DROP CONSTRAINT IF EXISTS chk_contracts_active_lifecycle',
    );
  });
});
