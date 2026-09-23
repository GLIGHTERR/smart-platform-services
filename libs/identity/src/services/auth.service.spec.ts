import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InMemoryIdentityRepository } from '../../../../test/support/in-memory-identity.repository';
import {
  EmailDeliveryPort,
  type EmailOtpMessage,
  OtpDeliveryPort,
  type LegacyPhoneOtpMessage,
} from '../providers/otp-delivery.port';
import {
  SocialIdentityVerifier,
  type VerifiedSocialIdentity,
} from '../providers/social-identity-verifier.port';
import { JwtSessionService, type SessionClientContext } from '../security/jwt-session.service';
import { PasswordHasherService } from '../security/password-hasher.service';
import { RateLimiterService } from '../security/rate-limiter.service';
import { AuthService } from './auth.service';

class CapturingEmailDelivery extends EmailDeliveryPort {
  public readonly messages: EmailOtpMessage[] = [];
  public availabilityFailure: Error | null = null;
  public sendFailure: Error | null = null;

  public assertAvailable(): Promise<void> {
    if (this.availabilityFailure) {
      return Promise.reject(this.availabilityFailure);
    }
    return Promise.resolve();
  }

  public async sendOtp(message: EmailOtpMessage): Promise<void> {
    if (this.sendFailure) {
      throw this.sendFailure;
    }
    this.messages.push(message);
  }
}

class CapturingPhoneDelivery extends OtpDeliveryPort {
  public readonly messages: LegacyPhoneOtpMessage[] = [];
  public failure: Error | null = null;

  public async send(message: LegacyPhoneOtpMessage): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.messages.push(message);
  }
}

class FakeSocialVerifier extends SocialIdentityVerifier {
  public identity: VerifiedSocialIdentity = {
    subject: 'provider-subject',
    email: 'social@example.com',
    displayName: 'Social User',
  };

  public verify(): Promise<VerifiedSocialIdentity> {
    return Promise.resolve(this.identity);
  }
}

describe('AuthService email identity flows', () => {
  const context: SessionClientContext = {
    ipAddress: '203.0.113.10',
    userAgent: 'jest',
    deviceId: 'device-1',
  };

  function createHarness(legacyPhoneFlowsEnabled = false): {
    auth: AuthService;
    repository: InMemoryIdentityRepository;
    emailDelivery: CapturingEmailDelivery;
    phoneDelivery: CapturingPhoneDelivery;
    socialVerifier: FakeSocialVerifier;
    sessions: JwtSessionService;
    passwords: PasswordHasherService;
  } {
    const config = new ConfigService({
      auth: {
        jwtAccessSecret: 'unit-test-access-secret-at-least-32-characters',
        jwtRefreshSecret: 'unit-test-refresh-secret-at-least-32-characters',
        jwtIssuer: 'unit-test-issuer',
        accessTtlSeconds: 900,
        refreshTtlSeconds: 2_592_000,
        otpHashSecret: 'unit-test-otp-secret-at-least-32-characters',
        otpTtlSeconds: 600,
        otpMaxAttempts: 5,
        otpResendCooldownSeconds: 60,
        otpRequestLimitPerHour: 5,
        otpIpLimitPerHour: 20,
        otpDeviceLimitPerHour: 20,
        passwordRecoveryEmailLimit: 5,
        passwordRecoveryEmailWindowSeconds: 900,
        passwordRecoveryIpLimit: 20,
        passwordRecoveryIpWindowSeconds: 3600,
        passwordRecoveryDeviceLimit: 20,
        resetTokenTtlSeconds: 600,
        loginFailureLimit: 5,
        loginAbuseLimit: 20,
        loginWindowSeconds: 900,
        loginLockSeconds: 900,
        legacyPhoneFlowsEnabled,
      },
    });
    const repository = new InMemoryIdentityRepository();
    const passwords = new PasswordHasherService();
    const sessions = new JwtSessionService(config, repository);
    const emailDelivery = new CapturingEmailDelivery();
    const phoneDelivery = new CapturingPhoneDelivery();
    const socialVerifier = new FakeSocialVerifier();
    const auth = new AuthService(
      config,
      repository,
      passwords,
      sessions,
      new RateLimiterService(repository, config),
      emailDelivery,
      phoneDelivery,
      socialVerifier,
    );
    return {
      auth,
      repository,
      emailDelivery,
      phoneDelivery,
      socialVerifier,
      sessions,
      passwords,
    };
  }

  async function completeEmailSignup(harness: ReturnType<typeof createHarness>): Promise<{
    requested: Awaited<ReturnType<AuthService['requestSignupOtp']>>;
    verified: Awaited<ReturnType<AuthService['verifySignupOtp']>>;
    completed: Awaited<ReturnType<AuthService['completeSignup']>>;
  }> {
    const requested = await harness.auth.requestSignupOtp('  User@Example.COM ', context);
    const code = harness.emailDelivery.messages.at(-1)?.code ?? '';
    const verified = await harness.auth.verifySignupOtp(
      { email: 'user@example.com', attemptId: requested.attemptId, code },
      context,
    );
    const completed = await harness.auth.completeSignup({
      email: 'user@example.com',
      attemptId: requested.attemptId,
      code,
      password: 'Secure1!',
      phone: '+84901234567',
    });
    return { requested, verified, completed };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  it('normalizes email and completes registration without creating a session', async () => {
    const harness = createHarness();
    const result = await completeEmailSignup(harness);

    expect(result.requested).toEqual({
      accepted: true,
      attemptId: expect.any(String),
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });
    expect(result.completed).toEqual({ created: true, next: 'sign_in' });
    expect(harness.repository.sessions.size).toBe(0);
    expect(await harness.repository.findByEmail('USER@EXAMPLE.COM')).toEqual(
      expect.objectContaining({
        email: 'user@example.com',
        phone: '+84901234567',
        status: 'active',
        roles: ['renter'],
      }),
    );
  });

  it('uses a generic accepted response for an existing email without sending an OTP', async () => {
    const harness = createHarness();
    harness.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await harness.passwords.hash('Secure1!'),
    });

    await expect(harness.auth.requestSignupOtp('USER@example.com', context)).resolves.toEqual({
      accepted: true,
      attemptId: expect.any(String),
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });
    expect(harness.emailDelivery.messages).toHaveLength(0);
  });

  it('enforces resend cooldown, replaces the old challenge, and limits requests per hour', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-21T00:00:00Z') });
    const harness = createHarness();
    const first = await harness.auth.requestSignupOtp('user@example.com', context);
    const immediate = await harness.auth.requestSignupOtp('user@example.com', context);
    expect(immediate.attemptId).toBe(first.attemptId);
    expect(harness.emailDelivery.messages).toHaveLength(1);

    for (let request = 1; request < 5; request += 1) {
      jest.advanceTimersByTime(61_000);
      await harness.auth.requestSignupOtp('user@example.com', context);
    }
    jest.advanceTimersByTime(61_000);
    await expect(harness.auth.requestSignupOtp('user@example.com', context)).rejects.toMatchObject({
      status: 429,
    });
  });

  it('cancels the challenge and fails closed when email delivery is unavailable', async () => {
    const harness = createHarness();
    harness.emailDelivery.sendFailure = new Error('provider unavailable');

    await expect(harness.auth.requestSignupOtp('user@example.com', context)).rejects.toThrow(
      'provider unavailable',
    );
    expect(
      await harness.repository.findOtpChallenge({ email: 'user@example.com' }, 'registration'),
    ).toBeNull();
  });

  it('fails closed before account lookup when the email adapter is not configured', async () => {
    const harness = createHarness();
    harness.emailDelivery.availabilityFailure = new Error('provider not configured');
    const lookup = jest.spyOn(harness.repository, 'findByEmail');

    await expect(harness.auth.requestSignupOtp('user@example.com', context)).rejects.toThrow(
      'provider not configured',
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('invalidates an OTP after five wrong entries and rejects expired attempts', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-21T00:00:00Z') });
    const harness = createHarness();
    const requested = await harness.auth.requestSignupOtp('user@example.com', context);
    const correctCode = harness.emailDelivery.messages[0]?.code ?? '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.auth.verifySignupOtp(
          { email: 'user@example.com', attemptId: requested.attemptId, code: '000000' },
          context,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      harness.auth.verifySignupOtp(
        { email: 'user@example.com', attemptId: requested.attemptId, code: correctCode },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    jest.advanceTimersByTime(61_000);
    const expiring = await harness.auth.requestSignupOtp('other@example.com', context);
    jest.advanceTimersByTime(601_000);
    await expect(
      harness.auth.verifySignupOtp(
        {
          email: 'other@example.com',
          attemptId: expiring.attemptId,
          code: harness.emailDelivery.messages.at(-1)?.code ?? '',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps verified OTP completion single-use and race-safe', async () => {
    const harness = createHarness();
    const requested = await harness.auth.requestSignupOtp('user@example.com', context);
    const input = {
      email: 'user@example.com',
      attemptId: requested.attemptId,
      code: harness.emailDelivery.messages[0]?.code ?? '',
    };
    const verified = await harness.auth.verifySignupOtp(input, context);
    expect(verified).not.toHaveProperty('signupToken');
    await expect(harness.auth.verifySignupOtp(input, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      harness.auth.completeSignup({
        email: input.email,
        attemptId: input.attemptId,
        code: '000000',
        password: 'Secure1!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const completions = await Promise.allSettled([
      harness.auth.completeSignup({
        email: input.email,
        attemptId: input.attemptId,
        code: input.code,
        password: 'Secure1!',
      }),
      harness.auth.completeSignup({
        email: input.email,
        attemptId: input.attemptId,
        code: input.code,
        password: 'Secure1!',
      }),
    ]);
    expect(completions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(completions.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('rejects completion before verification and a verification persistence race', async () => {
    const harness = createHarness();
    await expect(
      harness.auth.completeSignup({
        email: 'missing@example.com',
        attemptId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
        code: '123456',
        password: 'Secure1!',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const requested = await harness.auth.requestSignupOtp('user@example.com', context);
    jest.spyOn(harness.repository, 'markOtpVerified').mockResolvedValueOnce(false);
    await expect(
      harness.auth.verifySignupOtp(
        {
          email: 'user@example.com',
          attemptId: requested.attemptId,
          code: harness.emailDelivery.messages[0]?.code ?? '',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('signs in by normalized email, uses generic credential errors, and locks after five failures', async () => {
    const harness = createHarness();
    await completeEmailSignup(harness);

    await expect(
      harness.auth.login({ email: 'missing@example.com', password: 'Wrong1!' }, context),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDENTIALS' } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.auth.login({ email: 'user@example.com', password: 'Wrong1!' }, context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      harness.auth.login({ email: 'USER@example.com', password: 'Secure1!' }, context),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('returns ACCOUNT_UNVERIFIED only after a correct password and rejects inactive accounts', async () => {
    const harness = createHarness();
    const passwordHash = await harness.passwords.hash('Secure1!');
    const user = harness.repository.addActiveUser({ email: 'user@example.com', passwordHash });
    harness.repository.users.set(user.id, { ...user, status: 'pending' });

    await expect(
      harness.auth.login({ email: 'user@example.com', password: 'Wrong1!' }, context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.auth.login({ email: 'user@example.com', password: 'Secure1!' }, context),
    ).rejects.toMatchObject({ response: { code: 'ACCOUNT_UNVERIFIED' } });

    harness.repository.users.set(user.id, { ...user, status: 'suspended' });
    await expect(
      harness.auth.login({ email: 'user@example.com', password: 'Secure1!' }, context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rotates refresh tokens and supports current-session and all-session logout', async () => {
    const harness = createHarness();
    await completeEmailSignup(harness);
    const first = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      context,
    );
    const rotated = await harness.auth.refresh(first.refreshToken, context);
    await expect(harness.auth.refresh(first.refreshToken, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(harness.sessions.authenticateAccess(rotated.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const current = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      context,
    );
    await harness.auth.logout(current.refreshToken);
    await expect(harness.sessions.authenticateAccess(current.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    const one = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      context,
    );
    const two = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      context,
    );
    const actor = await harness.sessions.authenticateAccess(one.accessToken);
    await harness.auth.logoutAll(actor);
    await expect(harness.sessions.authenticateAccess(one.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(harness.sessions.authenticateAccess(two.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns the same neutral recovery contract for eligible and ineligible accounts', async () => {
    const eligible = createHarness();
    const passwordHash = await eligible.passwords.hash('Secure1!');
    const user = eligible.repository.addActiveUser({ email: 'user@example.com', passwordHash });
    const accepted = await eligible.auth.requestPasswordRecovery('  USER@Example.com ', context);

    expect(accepted).toEqual({
      accepted: true,
      message: 'Nếu email tồn tại, mã xác thực đã được gửi.',
      challengeId: expect.any(String),
      expiresInSeconds: 600,
      resendAfterSeconds: 60,
    });
    expect(eligible.emailDelivery.messages).toEqual([
      expect.objectContaining({ email: 'user@example.com', purpose: 'password_reset' }),
    ]);
    expect(eligible.repository.recoveryAudits).toEqual([
      expect.objectContaining({
        eventType: 'password_recovery.requested',
        userId: user.id,
        maskedEmail: 'us**@example.com',
        data: { outcome: 'sent' },
      }),
    ]);
    expect(JSON.stringify(eligible.repository.recoveryAudits)).not.toContain(
      eligible.emailDelivery.messages[0]?.code ?? 'unreachable',
    );

    for (const configure of [
      (harness: ReturnType<typeof createHarness>): void => {
        void harness;
      },
      async (harness: ReturnType<typeof createHarness>): Promise<void> => {
        const pending = harness.repository.addActiveUser({
          email: 'user@example.com',
          passwordHash: await harness.passwords.hash('Secure1!'),
        });
        harness.repository.users.set(pending.id, { ...pending, status: 'pending' });
      },
      (harness: ReturnType<typeof createHarness>): void => {
        const socialOnly = harness.repository.addActiveUser({
          email: 'user@example.com',
          passwordHash: 'provider-managed',
        });
        harness.repository.users.set(socialOnly.id, { ...socialOnly, passwordHash: null });
      },
    ]) {
      const ineligible = createHarness();
      await configure(ineligible);
      const response = await ineligible.auth.requestPasswordRecovery('user@example.com', context);
      expect(response).toEqual({ ...accepted, challengeId: expect.any(String) });
      expect(ineligible.emailDelivery.messages).toHaveLength(0);
    }
  });

  it('enforces recovery cooldown, replacement, request limits, and provider failure privacy', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-23T00:00:00Z') });
    const harness = createHarness();
    harness.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await harness.passwords.hash('Secure1!'),
    });
    const first = await harness.auth.requestPasswordRecovery('user@example.com', context);
    const immediate = await harness.auth.requestPasswordRecovery('user@example.com', context);
    expect(immediate.challengeId).toBe(first.challengeId);
    expect(harness.emailDelivery.messages).toHaveLength(1);

    jest.advanceTimersByTime(61_000);
    const replacement = await harness.auth.requestPasswordRecovery('user@example.com', context);
    expect(replacement.challengeId).not.toBe(first.challengeId);
    await expect(
      harness.auth.verifyPasswordRecovery(
        {
          email: 'user@example.com',
          challengeId: first.challengeId,
          code: harness.emailDelivery.messages[0]?.code ?? '',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    await harness.auth.requestPasswordRecovery('user@example.com', context);
    await harness.auth.requestPasswordRecovery('user@example.com', context);
    await expect(
      harness.auth.requestPasswordRecovery('user@example.com', context),
    ).rejects.toMatchObject({ status: 429 });

    const deliveryFailure = createHarness();
    deliveryFailure.repository.addActiveUser({
      email: 'other@example.com',
      passwordHash: await deliveryFailure.passwords.hash('Secure1!'),
    });
    deliveryFailure.emailDelivery.sendFailure = new Error('brevo unavailable');
    await expect(
      deliveryFailure.auth.requestPasswordRecovery('other@example.com', context),
    ).resolves.toEqual(
      expect.objectContaining({
        accepted: true,
        message: 'Nếu email tồn tại, mã xác thực đã được gửi.',
      }),
    );
    expect(
      await deliveryFailure.repository.findOtpChallenge(
        { email: 'other@example.com' },
        'password_reset',
      ),
    ).toBeNull();
  });

  it('issues a context-bound one-time reset token and cancels OTP after five failures', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-23T00:00:00Z') });
    const harness = createHarness();
    harness.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await harness.passwords.hash('Secure1!'),
    });
    const requested = await harness.auth.requestPasswordRecovery('user@example.com', context);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        harness.auth.verifyPasswordRecovery(
          { email: 'user@example.com', challengeId: requested.challengeId, code: '000000' },
          context,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(
      harness.auth.verifyPasswordRecovery(
        {
          email: 'user@example.com',
          challengeId: requested.challengeId,
          code: harness.emailDelivery.messages[0]?.code ?? '',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const validHarness = createHarness();
    validHarness.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await validHarness.passwords.hash('Secure1!'),
    });
    const valid = await validHarness.auth.requestPasswordRecovery('user@example.com', context);
    const verified = await validHarness.auth.verifyPasswordRecovery(
      {
        email: 'user@example.com',
        challengeId: valid.challengeId,
        code: validHarness.emailDelivery.messages.at(-1)?.code ?? '',
      },
      context,
    );
    expect(verified).toEqual({
      verified: true,
      resetToken: expect.any(String),
      expiresInSeconds: 600,
    });
    expect(JSON.stringify(validHarness.repository.recoveryAudits)).not.toContain(
      verified.resetToken,
    );
    await expect(
      validHarness.auth.verifyPasswordRecovery(
        {
          email: 'user@example.com',
          challengeId: valid.challengeId,
          code: validHarness.emailDelivery.messages.at(-1)?.code ?? '',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('atomically resets the password, revokes every session, and rejects replay or binding mismatch', async () => {
    const harness = createHarness();
    harness.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await harness.passwords.hash('Secure1!'),
    });
    const sessionOne = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      context,
    );
    const sessionTwo = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      { ...context, deviceId: 'device-2' },
    );
    const requested = await harness.auth.requestPasswordRecovery('user@example.com', context);
    const verified = await harness.auth.verifyPasswordRecovery(
      {
        email: 'user@example.com',
        challengeId: requested.challengeId,
        code: harness.emailDelivery.messages[0]?.code ?? '',
      },
      context,
    );

    await expect(
      harness.auth.completePasswordRecovery(
        {
          resetToken: verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Changed1!',
        },
        { ...context, deviceId: 'wrong-device' },
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_RESET_TOKEN_INVALID' } });
    await expect(
      harness.auth.completePasswordRecovery(
        {
          resetToken: verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Changed1!',
        },
        context,
      ),
    ).resolves.toEqual({ reset: true, next: 'sign_in', email: 'user@example.com' });
    await expect(
      harness.sessions.authenticateAccess(sessionOne.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.sessions.authenticateAccess(sessionTwo.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.auth.completePasswordRecovery(
        {
          resetToken: verified.resetToken,
          newPassword: 'Another1!',
          confirmPassword: 'Another1!',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_RESET_TOKEN_INVALID' } });
    expect(harness.repository.recoveryAudits.map((audit) => audit.eventType)).toEqual(
      expect.arrayContaining(['password_recovery.reset', 'password_recovery.sessions_revoked']),
    );
  });

  it('rejects reset expiry, confirmation mismatch, current-password reuse, and double submit', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-23T00:00:00Z') });
    const setup = async (): Promise<{
      harness: ReturnType<typeof createHarness>;
      verified: Awaited<ReturnType<AuthService['verifyPasswordRecovery']>>;
    }> => {
      const harness = createHarness();
      harness.repository.addActiveUser({
        email: 'user@example.com',
        passwordHash: await harness.passwords.hash('Secure1!'),
      });
      const requested = await harness.auth.requestPasswordRecovery('user@example.com', context);
      const verified = await harness.auth.verifyPasswordRecovery(
        {
          email: 'user@example.com',
          challengeId: requested.challengeId,
          code: harness.emailDelivery.messages[0]?.code ?? '',
        },
        context,
      );
      return { harness, verified };
    };

    const mismatch = await setup();
    await expect(
      mismatch.harness.auth.completePasswordRecovery(
        {
          resetToken: mismatch.verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Different1!',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_CONFIRMATION_MISMATCH' } });
    await expect(
      mismatch.harness.auth.completePasswordRecovery(
        {
          resetToken: mismatch.verified.resetToken,
          newPassword: 'Secure1!',
          confirmPassword: 'Secure1!',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_UNCHANGED' } });

    const expired = await setup();
    jest.advanceTimersByTime(601_000);
    await expect(
      expired.harness.auth.completePasswordRecovery(
        {
          resetToken: expired.verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Changed1!',
        },
        context,
      ),
    ).rejects.toMatchObject({ response: { code: 'PASSWORD_RESET_TOKEN_INVALID' } });

    jest.setSystemTime(new Date('2026-09-23T01:00:00Z'));
    const concurrent = await setup();
    const results = await Promise.allSettled([
      concurrent.harness.auth.completePasswordRecovery(
        {
          resetToken: concurrent.verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Changed1!',
        },
        context,
      ),
      concurrent.harness.auth.completePasswordRecovery(
        {
          resetToken: concurrent.verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Changed1!',
        },
        context,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('handles recovery persistence races, missing accounts, and absent network metadata', async () => {
    const noMetadata: SessionClientContext = {
      ipAddress: null,
      userAgent: null,
      deviceId: null,
    };
    const unknown = createHarness();
    await unknown.auth.requestPasswordRecovery('missing@example.com', noMetadata);
    await expect(
      unknown.auth.verifyPasswordRecovery(
        {
          email: 'missing@example.com',
          challengeId: '234cc3de-18ca-4b8b-a45d-522b9ec5d31e',
          code: '123456',
        },
        noMetadata,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const issueRace = createHarness();
    issueRace.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await issueRace.passwords.hash('Secure1!'),
    });
    const racedRequest = await issueRace.auth.requestPasswordRecovery('user@example.com', context);
    jest.spyOn(issueRace.repository, 'issuePasswordResetToken').mockResolvedValueOnce(false);
    await expect(
      issueRace.auth.verifyPasswordRecovery(
        {
          email: 'user@example.com',
          challengeId: racedRequest.challengeId,
          code: issueRace.emailDelivery.messages[0]?.code ?? '',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const missingUser = createHarness();
    const user = missingUser.repository.addActiveUser({
      email: 'user@example.com',
      passwordHash: await missingUser.passwords.hash('Secure1!'),
    });
    const request = await missingUser.auth.requestPasswordRecovery('user@example.com', context);
    const verified = await missingUser.auth.verifyPasswordRecovery(
      {
        email: 'user@example.com',
        challengeId: request.challengeId,
        code: missingUser.emailDelivery.messages[0]?.code ?? '',
      },
      context,
    );
    missingUser.repository.users.delete(user.id);
    await expect(
      missingUser.auth.completePasswordRecovery(
        {
          resetToken: verified.resetToken,
          newPassword: 'Changed1!',
          confirmPassword: 'Changed1!',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('feature-gates legacy phone registration, passwordless login, and recovery', async () => {
    const harness = createHarness();
    const registration = {
      phone: '+84901234567',
      password: 'Secure123',
      displayName: 'Legacy User',
      role: 'renter' as const,
    };

    await expect(harness.auth.register(registration, context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      harness.auth.requestOtp(registration.phone, 'login', context),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(harness.auth.forgotPassword(registration.phone, context)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('keeps legacy phone flows compatible only when explicitly enabled', async () => {
    const harness = createHarness(true);
    const registration = {
      phone: '+84901234567',
      password: 'Secure123',
      displayName: 'Legacy User',
      role: 'renter' as const,
    };
    await harness.auth.register(registration, context);
    const code = harness.phoneDelivery.messages.at(-1)?.code ?? '';
    const tokens = await harness.auth.verifyOtp(registration.phone, 'registration', code, context);
    await expect(harness.sessions.authenticateAccess(tokens.accessToken)).resolves.toEqual(
      expect.objectContaining({ roles: ['renter'] }),
    );
    await expect(harness.auth.register(registration, context)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('supports explicitly enabled legacy passwordless login and password recovery', async () => {
    const harness = createHarness(true);
    const registration = {
      phone: '+84901234567',
      password: 'Secure123',
      displayName: 'Legacy User',
      role: 'renter' as const,
    };
    await harness.auth.register(registration, context);
    await harness.auth.verifyOtp(
      registration.phone,
      'registration',
      harness.phoneDelivery.messages.at(-1)?.code ?? '',
      context,
    );

    await harness.auth.requestOtp(registration.phone, 'login', context);
    const passwordless = await harness.auth.verifyOtp(
      registration.phone,
      'login',
      harness.phoneDelivery.messages.at(-1)?.code ?? '',
      context,
    );
    await expect(harness.sessions.authenticateAccess(passwordless.accessToken)).resolves.toEqual(
      expect.objectContaining({ status: 'active' }),
    );

    await harness.auth.forgotPassword(registration.phone, context);
    const replacement = await harness.auth.resetPassword(
      {
        phone: registration.phone,
        code: harness.phoneDelivery.messages.at(-1)?.code ?? '',
        newPassword: 'Changed123',
      },
      context,
    );
    await expect(
      harness.sessions.authenticateAccess(passwordless.accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(harness.sessions.authenticateAccess(replacement.accessToken)).resolves.toEqual(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('keeps legacy recovery generic and handles delivery failures according to endpoint policy', async () => {
    const unknown = createHarness(true);
    await expect(unknown.auth.forgotPassword('+84909999999', context)).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 600,
    });

    const registrationFailure = createHarness(true);
    registrationFailure.phoneDelivery.failure = new Error('sms unavailable');
    await expect(
      registrationFailure.auth.register(
        {
          phone: '+84901234567',
          password: 'Secure123',
          displayName: 'Legacy User',
          role: 'renter',
        },
        context,
      ),
    ).rejects.toThrow('sms unavailable');

    const recoveryFailure = createHarness(true);
    const passwordHash = await recoveryFailure.passwords.hash('Secure123');
    recoveryFailure.repository.addActiveUser({ phone: '+84901234567', passwordHash });
    recoveryFailure.phoneDelivery.failure = new Error('sms unavailable');
    await expect(recoveryFailure.auth.forgotPassword('+84901234567', context)).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 600,
    });
  });

  it('returns generic errors for invalid legacy OTP and reset states', async () => {
    const harness = createHarness(true);
    await expect(
      harness.auth.verifyOtp('+84901234567', 'login', '000000', context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.auth.resetPassword(
        { phone: '+84901234567', code: '000000', newPassword: 'Changed123' },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('covers legacy OTP persistence and account-state failure modes', async () => {
    const registrationInput = {
      phone: '+84901234567',
      password: 'Secure123',
      displayName: 'Legacy User',
      role: 'renter' as const,
    };

    const wrongCode = createHarness(true);
    await wrongCode.auth.register(registrationInput, context);
    await expect(
      wrongCode.auth.verifyOtp(registrationInput.phone, 'registration', '000000', context),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const consumeRace = createHarness(true);
    await consumeRace.auth.register(registrationInput, context);
    jest.spyOn(consumeRace.repository, 'consumeOtp').mockResolvedValueOnce(false);
    await expect(
      consumeRace.auth.verifyOtp(
        registrationInput.phone,
        'registration',
        consumeRace.phoneDelivery.messages[0]?.code ?? '',
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const missingUser = createHarness(true);
    await missingUser.auth.register(registrationInput, context);
    const created = await missingUser.repository.findByPhone(registrationInput.phone);
    missingUser.repository.users.delete(created!.id);
    await expect(
      missingUser.auth.verifyOtp(
        registrationInput.phone,
        'registration',
        missingUser.phoneDelivery.messages[0]?.code ?? '',
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const alreadyActive = createHarness(true);
    await alreadyActive.auth.register(registrationInput, context);
    const activeUser = await alreadyActive.repository.findByPhone(registrationInput.phone);
    alreadyActive.repository.users.set(activeUser!.id, { ...activeUser!, status: 'active' });
    await expect(
      alreadyActive.auth.verifyOtp(
        registrationInput.phone,
        'registration',
        alreadyActive.phoneDelivery.messages[0]?.code ?? '',
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const inactiveLogin = createHarness(true);
    const passwordHash = await inactiveLogin.passwords.hash('Secure123');
    const loginUser = inactiveLogin.repository.addActiveUser({
      phone: registrationInput.phone,
      passwordHash,
    });
    await inactiveLogin.auth.requestOtp(registrationInput.phone, 'login', context);
    inactiveLogin.repository.users.set(loginUser.id, { ...loginUser, status: 'suspended' });
    await expect(
      inactiveLogin.auth.verifyOtp(
        registrationInput.phone,
        'login',
        inactiveLogin.phoneDelivery.messages[0]?.code ?? '',
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('covers legacy password-reset challenge and user races', async () => {
    const wrongCode = createHarness(true);
    const passwordHash = await wrongCode.passwords.hash('Secure123');
    wrongCode.repository.addActiveUser({ phone: '+84901234567', passwordHash });
    await wrongCode.auth.forgotPassword('+84901234567', context);
    await expect(
      wrongCode.auth.resetPassword(
        { phone: '+84901234567', code: '000000', newPassword: 'Changed123' },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    const missingUser = createHarness(true);
    const user = missingUser.repository.addActiveUser({ phone: '+84901234567', passwordHash });
    await missingUser.auth.forgotPassword('+84901234567', context);
    missingUser.repository.users.delete(user.id);
    await expect(
      missingUser.auth.resetPassword(
        {
          phone: '+84901234567',
          code: missingUser.phoneDelivery.messages[0]?.code ?? '',
          newPassword: 'Changed123',
        },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses safe fallback abuse keys when network and device headers are unavailable', async () => {
    const noMetadata: SessionClientContext = {
      ipAddress: null,
      userAgent: null,
      deviceId: null,
    };
    const harness = createHarness(true);
    const requested = await harness.auth.requestSignupOtp('user@example.com', noMetadata);
    await harness.auth.verifySignupOtp(
      {
        email: 'user@example.com',
        attemptId: requested.attemptId,
        code: harness.emailDelivery.messages[0]?.code ?? '',
      },
      noMetadata,
    );
    await expect(
      harness.auth.login({ email: 'missing@example.com', password: 'Wrong1!' }, noMetadata),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(harness.auth.forgotPassword('+84909999999', noMetadata)).resolves.toEqual({
      accepted: true,
      expiresInSeconds: 600,
    });
    await expect(
      harness.auth.verifyOtp('+84909999999', 'login', '000000', noMetadata),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('changes passwords and preserves explicit social-account linking rules', async () => {
    const harness = createHarness();
    await completeEmailSignup(harness);
    const login = await harness.auth.login(
      { email: 'user@example.com', password: 'Secure1!' },
      context,
    );
    const actor = await harness.sessions.authenticateAccess(login.accessToken);
    await expect(
      harness.auth.changePassword(
        actor,
        { currentPassword: 'Wrong1!', newPassword: 'Changed1!' },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      harness.auth.changePassword(
        actor,
        { currentPassword: 'Secure1!', newPassword: 'Secure1!' },
        context,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      harness.auth.changePassword(
        actor,
        { currentPassword: 'Secure1!', newPassword: 'Changed1!' },
        context,
      ),
    ).resolves.toEqual(expect.objectContaining({ tokenType: 'Bearer' }));

    await expect(
      harness.auth.socialLogin('linkedin', { credential: 'token', role: 'owner' }, context),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      harness.auth.socialLogin('google', { credential: 'token', role: 'owner' }, context),
    ).resolves.toEqual(expect.objectContaining({ tokenType: 'Bearer' }));

    const conflict = createHarness();
    conflict.repository.addActiveUser({
      email: 'social@example.com',
      passwordHash: await conflict.passwords.hash('Secure1!'),
    });
    await expect(
      conflict.auth.socialLogin('google', { credential: 'token', role: 'owner' }, context),
    ).rejects.toBeInstanceOf(ConflictException);

    const missingClaims = createHarness();
    missingClaims.socialVerifier.identity = {
      subject: 'missing-claims',
      email: null,
      displayName: null,
    };
    await expect(
      missingClaims.auth.socialLogin('google', { credential: 'token' }, context),
    ).rejects.toMatchObject({ response: { code: 'SOCIAL_SIGNUP_DETAILS_REQUIRED' } });

    const inactive = createHarness();
    const social = await inactive.auth.socialLogin(
      'google',
      { credential: 'token', role: 'owner' },
      context,
    );
    const socialActor = await inactive.sessions.authenticateAccess(social.accessToken);
    const socialUser = inactive.repository.users.get(socialActor.id);
    inactive.repository.users.set(socialActor.id, { ...socialUser!, status: 'disabled' });
    await expect(
      inactive.auth.socialLogin('google', { credential: 'token', role: 'owner' }, context),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const fallbackName = createHarness();
    fallbackName.socialVerifier.identity = {
      subject: 'fallback-name',
      email: 'fallback@example.com',
      displayName: null,
    };
    await expect(
      fallbackName.auth.socialLogin('google', { credential: 'token', role: 'renter' }, context),
    ).resolves.toEqual(expect.objectContaining({ tokenType: 'Bearer' }));
  });

  it('rejects password change when the authenticated user no longer exists', async () => {
    const harness = createHarness();
    await expect(
      harness.auth.changePassword(
        { id: 'missing', roles: ['renter'], status: 'active', sessionId: 'session' },
        { currentPassword: 'Secure1!', newPassword: 'Changed1!' },
        context,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
