import type { QueryRunner } from 'typeorm';
import { PasswordRecoveryOutbox1700000004000 } from './1700000004000-password-recovery-outbox';

describe('PasswordRecoveryOutbox1700000004000', () => {
  it('adds a recoverable worker lease and a pending-job index', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new PasswordRecoveryOutbox1700000004000().up({ query } as unknown as QueryRunner);
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('ADD COLUMN locked_at');
    expect(sql).toContain('ADD COLUMN lock_token');
    expect(sql).toContain('idx_outbox_recovery_claim');
  });
});
