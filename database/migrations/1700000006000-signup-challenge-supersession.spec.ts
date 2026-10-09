import type { QueryRunner } from 'typeorm';
import { SignupChallengeSupersession1700000006000 } from './1700000006000-signup-challenge-supersession';

describe('SignupChallengeSupersession1700000006000', () => {
  it('adds an additive marker and lookup index for unclaimed registration outbox work', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new SignupChallengeSupersession1700000006000().up({ query } as unknown as QueryRunner);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('ADD COLUMN superseded_at timestamptz');
    expect(sql).toContain('idx_outbox_registration_unsuperseded');
    expect(sql).toContain("event_type = 'registration_email'");
  });

  it('removes only its own index and column on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new SignupChallengeSupersession1700000006000().down({ query } as unknown as QueryRunner);

    expect(String(query.mock.calls[0]?.[0])).toContain('DROP COLUMN IF EXISTS superseded_at');
  });
});
