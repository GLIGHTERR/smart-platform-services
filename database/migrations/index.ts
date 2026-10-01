import { InitialPlatformSchema1700000000000 } from './1700000000000-initial-platform-schema';
import { IdentityAuthSchema1700000001000 } from './1700000001000-identity-auth-schema';
import { EmailIdentityAuth1700000002000 } from './1700000002000-email-identity-auth';
import { PasswordRecovery1700000003000 } from './1700000003000-password-recovery';
import { PasswordRecoveryOutbox1700000004000 } from './1700000004000-password-recovery-outbox';

export const platformMigrations = [
  InitialPlatformSchema1700000000000,
  IdentityAuthSchema1700000001000,
  EmailIdentityAuth1700000002000,
  PasswordRecovery1700000003000,
  PasswordRecoveryOutbox1700000004000,
];
