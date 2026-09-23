import type { QueryRunner } from 'typeorm';
import { PasswordRecovery1700000003000 } from './1700000003000-password-recovery';

describe('PasswordRecovery1700000003000', () => {
  it('creates hashed, context-bound, single-use reset token storage', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new PasswordRecovery1700000003000().up({ query } as unknown as QueryRunner);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('CREATE TABLE password_reset_tokens');
    expect(sql).toContain('token_hash char(64)');
    expect(sql).toContain('context_hash char(64)');
    expect(sql).toContain('UNIQUE (challenge_id)');
    expect(sql).toContain('WHERE consumed_at IS NULL');
  });

  it('has a forward-safe rollback that only removes UC-03 storage', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new PasswordRecovery1700000003000().down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith('DROP TABLE IF EXISTS password_reset_tokens;');
  });
});
