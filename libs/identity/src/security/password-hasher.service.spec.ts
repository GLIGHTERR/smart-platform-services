import { PasswordHasherService } from './password-hasher.service';

describe('PasswordHasherService', () => {
  it('hashes and verifies without accepting malformed or incorrect hashes', async () => {
    const hasher = new PasswordHasherService();
    const hash = await hasher.hash('Secure123');

    await expect(hasher.verify('Secure123', hash)).resolves.toBe(true);
    await expect(hasher.verify('Wrong123', hash)).resolves.toBe(false);
    await expect(hasher.verify('Secure123', 'bcrypt$invalid')).resolves.toBe(false);
    await expect(hasher.verify('Secure123', 'scrypt$16384$8$1$salt$00')).resolves.toBe(false);
    await expect(hasher.consumeDummyWork('unknown-password')).resolves.toBeUndefined();
  });
});
