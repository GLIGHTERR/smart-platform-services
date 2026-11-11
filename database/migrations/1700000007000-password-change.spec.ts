import { PasswordChange1700000007000 } from './1700000007000-password-change';

describe('PasswordChange1700000007000', () => {
  it('creates and rolls back only the password-change idempotency ledger', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new PasswordChange1700000007000();
    await migration.up({ query } as never);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE password_change_idempotency'));
    await migration.down({ query } as never);
    expect(query).toHaveBeenLastCalledWith('DROP TABLE IF EXISTS password_change_idempotency;');
  });
});
