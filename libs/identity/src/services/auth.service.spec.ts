import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InMemoryIdentityRepository } from '../../../../test/support/in-memory-identity.repository';
import { OtpDeliveryPort, type OtpDeliveryMessage } from '../providers/otp-delivery.port';
import {
  SocialIdentityVerifier,
  type VerifiedSocialIdentity,
} from '../providers/social-identity-verifier.port';
import { JwtSessionService, type SessionClientContext } from '../security/jwt-session.service';
import { PasswordHasherService } from '../security/password-hasher.service';
import { RateLimiterService } from '../security/rate-limiter.service';
import { AuthService } from './auth.service';

class CapturingOtpDelivery extends OtpDeliveryPort {
  public readonly messages: OtpDeliveryMessage[] = [];

  public async send(message: OtpDeliveryMessage): Promise<void> {
    this.messages.push(message);
  }
}

class FakeSocialVerifier extends SocialIdentityVerifier {
  public verify(): Promise<VerifiedSocialIdentity> {
    return Promise.resolve({
      subject: 'provider-subject',
      email: 'social@example.com',
      displayName: 'Social User',
    });
  }
}

describe('AuthService security flows', () => {
  const context: SessionClientContext = {
    ipAddress: '203.0.113.10',
    userAgent: 'jest',
  };

  function createHarness(): {
    auth: AuthService;
    repository: InMemoryIdentityRepository;
    delivery: CapturingOtpDelivery;
    sessions: JwtSessionService;
    passwords: PasswordHasherService;
  } {
    const config = new ConfigService({
      auth: {
        jwtAccessSecret: 'unit-test-access-secret-at-least-32-characters',
        jwtRefreshSecret: 'unit-test-refresh-secret-at-least-32-characters',
        jwtIssuer: 'unit-test-issuer',
        accessTtlSeconds: 900,
        refreshTtlSeconds: 3600,
        otpHashSecret: 'unit-test-otp-secret-at-least-32-characters',
        otpTtlSeconds: 300,
      },
    });
    const repository = new InMemoryIdentityRepository();
    const passwords = new PasswordHasherService();
    const sessions = new JwtSessionService(config, repository);
    const delivery = new CapturingOtpDelivery();
    const auth = new AuthService(
      config,
      repository,
      passwords,
      sessions,
      new RateLimiterService(repository, config),
      delivery,
      new FakeSocialVerifier(),
    );
    return { auth, repository, delivery, sessions, passwords };
  }

  async function registerAndVerify(
    harness: ReturnType<typeof createHarness>,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    await harness.auth.register(
      {
        phone: '+84901234567',
        password: 'Secure123',
        displayName: 'Renter One',
        role: 'renter',
      },
      context,
    );
    const code = harness.delivery.messages.at(-1)?.code;
    expect(code).toMatch(/^\d{6}$/);
    return harness.auth.verifyOtp('+84901234567', 'registration', code ?? '', context);
  }

  it('registers by phone, verifies a single-use OTP and creates an active session', async () => {
    const harness = createHarness();
    const tokens = await registerAndVerify(harness);

    const actor = await harness.sessions.authenticateAccess(tokens.accessToken);

    expect(actor).toEqual(
      expect.objectContaining({
        status: 'active',
        roles: ['renter'],
        sessionId: expect.any(String),
      }),
    );
    await expect(
      harness.auth.verifyOtp(
        '+84901234567',
        'registration',
        harness.delivery.messages[0]?.code ?? '',
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a challenge after five OTP failures, including when the later code is correct', async () => {
    const harness = createHarness();
    await harness.auth.register(
      {
        phone: '+84901234567',
        password: 'Secure123',
        displayName: 'Renter One',
        role: 'renter',
      },
      context,
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.auth.verifyOtp('+84901234567', 'registration', '000000', context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      harness.auth.verifyOtp(
        '+84901234567',
        'registration',
        harness.delivery.messages[0]?.code ?? '',
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('locks phone login after five failed password attempts', async () => {
    const harness = createHarness();
    const passwordHash = await harness.passwords.hash('Secure123');
    harness.repository.addActiveUser({ phone: '+84901234567', passwordHash });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.auth.login({ phone: '+84901234567', password: 'Wrong123' }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      harness.auth.login({ phone: '+84901234567', password: 'Secure123' }, context),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('rotates refresh tokens, revokes a family on reuse and invalidates logout immediately', async () => {
    const harness = createHarness();
    const original = await registerAndVerify(harness);
    const rotated = await harness.auth.refresh(original.refreshToken, context);

    await expect(harness.auth.refresh(original.refreshToken, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(harness.sessions.authenticateAccess(rotated.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const login = await harness.auth.login(
      { phone: '+84901234567', password: 'Secure123' },
      context,
    );
    await harness.auth.logout(login.refreshToken);
    await expect(harness.sessions.authenticateAccess(login.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('supports passwordless phone OTP login for an active account', async () => {
    const harness = createHarness();
    await registerAndVerify(harness);
    await harness.auth.requestOtp('+84901234567', 'login', context);
    const loginCode = harness.delivery.messages.at(-1)?.code ?? '';

    const tokens = await harness.auth.verifyOtp('+84901234567', 'login', loginCode, context);

    await expect(harness.sessions.authenticateAccess(tokens.accessToken)).resolves.toEqual(
      expect.objectContaining({ roles: ['renter'] }),
    );
  });

  it('resets a forgotten password with OTP and revokes existing sessions', async () => {
    const harness = createHarness();
    const original = await registerAndVerify(harness);
    await harness.auth.forgotPassword('+84901234567', context);
    const resetCode = harness.delivery.messages.at(-1)?.code ?? '';

    const replacement = await harness.auth.resetPassword(
      { phone: '+84901234567', code: resetCode, newPassword: 'Changed123' },
      context,
    );

    await expect(harness.sessions.authenticateAccess(original.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(harness.sessions.authenticateAccess(replacement.accessToken)).resolves.toEqual(
      expect.objectContaining({ status: 'active' }),
    );
    await expect(
      harness.auth.login({ phone: '+84901234567', password: 'Secure123' }, context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.auth.login({ phone: '+84901234567', password: 'Changed123' }, context),
    ).resolves.toEqual(expect.objectContaining({ tokenType: 'Bearer' }));
  });

  it('changes password only with the current password and returns a replacement session', async () => {
    const harness = createHarness();
    const original = await registerAndVerify(harness);
    const actor = await harness.sessions.authenticateAccess(original.accessToken);

    await expect(
      harness.auth.changePassword(
        actor,
        { currentPassword: 'Wrong123', newPassword: 'Changed123' },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.auth.changePassword(
        actor,
        { currentPassword: 'Secure123', newPassword: 'Secure123' },
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const replacement = await harness.auth.changePassword(
      actor,
      { currentPassword: 'Secure123', newPassword: 'Changed123' },
      context,
    );
    await expect(harness.sessions.authenticateAccess(original.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(harness.sessions.authenticateAccess(replacement.accessToken)).resolves.toEqual(
      expect.objectContaining({ id: actor.id }),
    );
  });

  it('keeps registration unique and exposes the same accepted forgot response for unknown phones', async () => {
    const harness = createHarness();
    const registration = {
      phone: '+84901234567',
      password: 'Secure123',
      displayName: 'Renter One',
      role: 'renter' as const,
    };
    await harness.auth.register(registration, context);

    await expect(harness.auth.register(registration, context)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(harness.auth.forgotPassword('+84909999999', context)).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 300,
    });
  });

  it('rejects inactive accounts after correct password verification', async () => {
    const harness = createHarness();
    const passwordHash = await harness.passwords.hash('Secure123');
    const user = harness.repository.addActiveUser({ phone: '+84901234567', passwordHash });
    harness.repository.users.set(user.id, { ...user, status: 'suspended' });

    await expect(
      harness.auth.login({ phone: '+84901234567', password: 'Secure123' }, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a social account only from verified provider claims and never auto-links email', async () => {
    const harness = createHarness();

    const tokens = await harness.auth.socialLogin(
      'google',
      { credential: 'verified-token', role: 'owner' },
      context,
    );
    await expect(harness.sessions.authenticateAccess(tokens.accessToken)).resolves.toEqual(
      expect.objectContaining({ roles: ['owner'] }),
    );
    await expect(
      harness.auth.socialLogin('linkedin', { credential: 'token', role: 'owner' }, context),
    ).rejects.toBeInstanceOf(BadRequestException);

    const conflictingHarness = createHarness();
    const passwordHash = await conflictingHarness.passwords.hash('Secure123');
    const existing = conflictingHarness.repository.addActiveUser({
      phone: '+84901234567',
      passwordHash,
    });
    conflictingHarness.repository.users.set(existing.id, {
      ...existing,
      email: 'social@example.com',
    });
    await expect(
      conflictingHarness.auth.socialLogin(
        'google',
        { credential: 'verified-token', role: 'owner' },
        context,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
