import { platformMigrations } from './index';

describe('platformMigrations', () => {
  it('registers every production migration in ledger order', () => {
    expect(platformMigrations.map((migration) => migration.name)).toEqual([
      'InitialPlatformSchema1700000000000',
      'IdentityAuthSchema1700000001000',
      'EmailIdentityAuth1700000002000',
      'PasswordRecovery1700000003000',
      'PasswordRecoveryOutbox1700000004000',
      'ContractActiveLifecycle1700000005000',
      'SignupChallengeSupersession1700000006000',
    ]);
  });
});
