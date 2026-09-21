import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SignupCompleteDto,
  SignupOtpVerifyDto,
  SocialLoginDto,
} from '../http/auth.dto';
import {
  IdentityRepository,
  type IdentityUser,
  type OtpPurpose,
} from '../persistence/identity.repository';
import { EmailDeliveryPort, OtpDeliveryPort } from '../providers/otp-delivery.port';
import { SocialIdentityVerifier } from '../providers/social-identity-verifier.port';
import type {
  AuthenticatedActor,
  AuthSessionTokens,
  SocialProvider,
} from '../public/identity.contracts';
import { JwtSessionService, type SessionClientContext } from '../security/jwt-session.service';
import { PasswordHasherService } from '../security/password-hasher.service';
import { RateLimiterService, type ThrottleKey } from '../security/rate-limiter.service';

export interface OtpAcceptedResponse {
  accepted: true;
  attemptId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface SignupOtpVerifiedResponse {
  verified: true;
  attemptId: string;
  expiresInSeconds: number;
}

export interface SignupCompletedResponse {
  created: true;
  next: 'sign_in';
}

export interface RegistrationResponse {
  userId: string;
  status: 'verification_required';
  accepted: true;
  expiresInSeconds: number;
}

@Injectable()
export class AuthService {
  private readonly otpSecret: string;
  private readonly otpTtlSeconds: number;
  private readonly otpMaxAttempts: number;
  private readonly otpResendCooldownSeconds: number;
  private readonly otpRequestLimitPerHour: number;
  private readonly otpIpLimitPerHour: number;
  private readonly otpDeviceLimitPerHour: number;
  private readonly loginFailureLimit: number;
  private readonly loginAbuseLimit: number;
  private readonly loginWindowSeconds: number;
  private readonly loginLockSeconds: number;
  private readonly legacyPhoneFlowsEnabled: boolean;

  public constructor(
    config: ConfigService,
    private readonly repository: IdentityRepository,
    private readonly passwords: PasswordHasherService,
    private readonly sessions: JwtSessionService,
    private readonly rateLimiter: RateLimiterService,
    private readonly emailDelivery: EmailDeliveryPort,
    private readonly otpDelivery: OtpDeliveryPort,
    private readonly socialVerifier: SocialIdentityVerifier,
  ) {
    this.otpSecret = config.getOrThrow<string>('auth.otpHashSecret');
    this.otpTtlSeconds = config.getOrThrow<number>('auth.otpTtlSeconds');
    this.otpMaxAttempts = config.getOrThrow<number>('auth.otpMaxAttempts');
    this.otpResendCooldownSeconds = config.getOrThrow<number>('auth.otpResendCooldownSeconds');
    this.otpRequestLimitPerHour = config.getOrThrow<number>('auth.otpRequestLimitPerHour');
    this.otpIpLimitPerHour = config.getOrThrow<number>('auth.otpIpLimitPerHour');
    this.otpDeviceLimitPerHour = config.getOrThrow<number>('auth.otpDeviceLimitPerHour');
    this.loginFailureLimit = config.getOrThrow<number>('auth.loginFailureLimit');
    this.loginAbuseLimit = config.getOrThrow<number>('auth.loginAbuseLimit');
    this.loginWindowSeconds = config.getOrThrow<number>('auth.loginWindowSeconds');
    this.loginLockSeconds = config.getOrThrow<number>('auth.loginLockSeconds');
    this.legacyPhoneFlowsEnabled = config.getOrThrow<boolean>('auth.legacyPhoneFlowsEnabled');
  }

  public async requestSignupOtp(
    rawEmail: string,
    context: SessionClientContext,
  ): Promise<OtpAcceptedResponse> {
    const email = this.normalizeEmail(rawEmail);
    const now = new Date();
    const keys = this.otpRequestKeys(email, context);
    await this.rateLimiter.assertAllowed(keys, now);
    await this.emailDelivery.assertAvailable();

    const current = await this.repository.findOtpChallenge({ email }, 'registration');
    if (current) {
      const elapsedSeconds = Math.floor((now.getTime() - current.createdAt.getTime()) / 1000);
      const remaining = this.otpResendCooldownSeconds - elapsedSeconds;
      if (remaining > 0) {
        return this.otpAccepted(
          current.id,
          Math.max(1, Math.ceil((current.expiresAt.getTime() - now.getTime()) / 1000)),
          Math.min(this.otpResendCooldownSeconds, remaining),
        );
      }
    }

    await this.rateLimiter.recordFailure(keys, now);
    if (await this.repository.findByEmail(email)) {
      return this.otpAccepted(randomUUID(), this.otpTtlSeconds, this.otpResendCooldownSeconds);
    }

    const code = randomInt(100_000, 1_000_000).toString();
    const attemptId = randomUUID();
    await this.repository.replaceOtpChallenge({
      id: attemptId,
      email,
      phone: null,
      purpose: 'registration',
      codeHash: this.hashOtp(email, 'registration', code),
      maxAttempts: this.otpMaxAttempts,
      expiresAt: new Date(now.getTime() + this.otpTtlSeconds * 1000),
      requestedIp: context.ipAddress,
    });
    try {
      await this.emailDelivery.sendOtp({
        email,
        purpose: 'registration',
        code,
        expiresInSeconds: this.otpTtlSeconds,
      });
    } catch (error: unknown) {
      await this.repository.cancelOtp(attemptId, new Date());
      throw error;
    }
    return this.otpAccepted(attemptId, this.otpTtlSeconds, this.otpResendCooldownSeconds);
  }

  public async verifySignupOtp(
    input: SignupOtpVerifyDto,
    context: SessionClientContext,
  ): Promise<SignupOtpVerifiedResponse> {
    const email = this.normalizeEmail(input.email);
    const now = new Date();
    const keys = this.otpVerifyKeys(email, context);
    await this.rateLimiter.assertAllowed(keys, now);
    const challenge = await this.repository.findOtpChallenge({ email }, 'registration');
    if (
      !challenge ||
      challenge.id !== input.attemptId ||
      challenge.consumedAt ||
      challenge.verifiedAt ||
      challenge.expiresAt <= now ||
      challenge.attemptCount >= challenge.maxAttempts ||
      !this.otpMatches(email, 'registration', input.code, challenge.codeHash)
    ) {
      if (challenge && challenge.attemptCount < challenge.maxAttempts && !challenge.verifiedAt) {
        await this.repository.recordOtpFailure(challenge.id);
      }
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidOtp();
    }

    const marked = await this.repository.markOtpVerified(challenge.id, now);
    if (!marked) {
      throw this.invalidOtp();
    }
    await this.rateLimiter.clear(keys);
    return {
      verified: true,
      attemptId: challenge.id,
      expiresInSeconds: Math.max(
        1,
        Math.ceil((challenge.expiresAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  public async completeSignup(input: SignupCompleteDto): Promise<SignupCompletedResponse> {
    const email = this.normalizeEmail(input.email);
    const challenge = await this.repository.findOtpChallenge({ email }, 'registration');
    if (
      !challenge ||
      challenge.id !== input.attemptId ||
      !challenge.verifiedAt ||
      !this.otpMatches(email, 'registration', input.code, challenge.codeHash)
    ) {
      throw this.signupUnavailable();
    }
    const user = await this.repository.completeEmailSignup({
      challengeId: challenge.id,
      email,
      phone: input.phone?.trim() || null,
      passwordHash: await this.passwords.hash(input.password),
      codeHash: challenge.codeHash,
      completedAt: new Date(),
    });
    if (!user) {
      throw this.signupUnavailable();
    }
    return { created: true, next: 'sign_in' };
  }

  public async login(input: LoginDto, context: SessionClientContext): Promise<AuthSessionTokens> {
    const email = this.normalizeEmail(input.email);
    const keys = this.loginKeys(email, context);
    const now = new Date();
    await this.rateLimiter.assertAllowed(keys, now);
    const user = await this.repository.findByEmail(email);
    if (!user?.passwordHash) {
      await this.passwords.consumeDummyWork(input.password);
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidCredentials();
    }
    if (!(await this.passwords.verify(input.password, user.passwordHash))) {
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidCredentials();
    }
    await this.rateLimiter.clear(keys);
    if (user.status === 'pending') {
      throw new ForbiddenException({
        code: 'ACCOUNT_UNVERIFIED',
        message: 'Account email is not verified',
      });
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
    }
    await this.repository.markLogin(user.id, now);
    return this.sessions.create(user, context);
  }

  public async logoutAll(actor: AuthenticatedActor): Promise<void> {
    await this.repository.revokeSessionsForUser(actor.id, new Date(), 'logout_all');
  }

  public async register(
    input: RegisterDto,
    context: SessionClientContext,
  ): Promise<RegistrationResponse> {
    this.assertLegacyPhoneFlowsEnabled();
    const phone = this.normalizePhone(input.phone);
    if (await this.repository.findByPhone(phone)) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'Phone is registered',
      });
    }
    const user = await this.repository.createPhoneUser({
      phone,
      passwordHash: await this.passwords.hash(input.password),
      displayName: input.displayName.trim(),
      role: input.role,
    });
    const otp = await this.requestOtp(phone, 'registration', context);
    return { userId: user.id, status: 'verification_required', ...otp };
  }

  public async requestOtp(
    rawPhone: string,
    purpose: Exclude<OtpPurpose, 'password_reset'>,
    context: SessionClientContext,
  ): Promise<{ accepted: true; expiresInSeconds: number }> {
    this.assertLegacyPhoneFlowsEnabled();
    return this.issuePhoneOtp(this.normalizePhone(rawPhone), purpose, context, false);
  }

  public async verifyOtp(
    rawPhone: string,
    purpose: Exclude<OtpPurpose, 'password_reset'>,
    code: string,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    this.assertLegacyPhoneFlowsEnabled();
    const phone = this.normalizePhone(rawPhone);
    const keys = this.legacyOtpVerifyKeys(phone, context.ipAddress);
    const now = new Date();
    await this.rateLimiter.assertAllowed(keys, now);
    const challenge = await this.repository.findOtpChallenge({ phone }, purpose);
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.attemptCount >= challenge.maxAttempts ||
      !this.otpMatches(phone, purpose, code, challenge.codeHash)
    ) {
      if (challenge && challenge.attemptCount < challenge.maxAttempts) {
        await this.repository.recordOtpFailure(challenge.id);
      }
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidOtp();
    }
    if (!(await this.repository.consumeOtp(challenge.id, now))) {
      throw this.invalidOtp();
    }
    await this.rateLimiter.clear(keys);
    let user = await this.repository.findByPhone(phone);
    if (!user) {
      throw this.invalidOtp();
    }
    if (purpose === 'registration') {
      if (user.status !== 'pending') {
        throw this.invalidOtp();
      }
      await this.repository.activatePhone(user.id, now);
      user = await this.requireUser(user.id);
    }
    if (user.status !== 'active') {
      throw this.invalidOtp();
    }
    await this.repository.markLogin(user.id, now);
    return this.sessions.create(user, context);
  }

  public async forgotPassword(
    rawPhone: string,
    context: SessionClientContext,
  ): Promise<{ accepted: true; expiresInSeconds: number }> {
    this.assertLegacyPhoneFlowsEnabled();
    return this.issuePhoneOtp(this.normalizePhone(rawPhone), 'password_reset', context, true);
  }

  public async resetPassword(
    input: ResetPasswordDto,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    this.assertLegacyPhoneFlowsEnabled();
    const phone = this.normalizePhone(input.phone);
    const now = new Date();
    const keys = this.legacyOtpVerifyKeys(phone, context.ipAddress);
    await this.rateLimiter.assertAllowed(keys, now);
    const challenge = await this.repository.findOtpChallenge({ phone }, 'password_reset');
    if (
      !challenge ||
      challenge.expiresAt <= now ||
      challenge.attemptCount >= challenge.maxAttempts ||
      !this.otpMatches(phone, 'password_reset', input.code, challenge.codeHash)
    ) {
      if (challenge && challenge.attemptCount < challenge.maxAttempts) {
        await this.repository.recordOtpFailure(challenge.id);
      }
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidOtp();
    }
    const user = await this.repository.findByPhone(phone);
    if (
      !user ||
      user.status !== 'active' ||
      !(await this.repository.consumeOtp(challenge.id, now))
    ) {
      throw this.invalidOtp();
    }
    await this.repository.updatePassword(user.id, await this.passwords.hash(input.newPassword));
    await this.repository.revokeSessionsForUser(user.id, now, 'password_reset');
    await this.rateLimiter.clear(keys);
    return this.sessions.create(user, context);
  }

  public async changePassword(
    actor: AuthenticatedActor,
    input: ChangePasswordDto,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    const user = await this.requireUser(actor.id);
    if (
      !user.passwordHash ||
      !(await this.passwords.verify(input.currentPassword, user.passwordHash))
    ) {
      throw this.invalidCredentials();
    }
    if (await this.passwords.verify(input.newPassword, user.passwordHash)) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'New password must be different from the current password',
      });
    }
    const now = new Date();
    await this.repository.updatePassword(user.id, await this.passwords.hash(input.newPassword));
    await this.repository.revokeSessionsForUser(user.id, now, 'password_change');
    return this.sessions.create(user, context);
  }

  public refresh(refreshToken: string, context: SessionClientContext): Promise<AuthSessionTokens> {
    return this.sessions.refresh(refreshToken, context);
  }

  public logout(refreshToken: string): Promise<void> {
    return this.sessions.logout(refreshToken);
  }

  public async socialLogin(
    provider: string,
    input: SocialLoginDto,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    if (!this.isSocialProvider(provider)) {
      throw new BadRequestException({
        code: 'SOCIAL_PROVIDER_UNSUPPORTED',
        message: 'Supported social providers are google, facebook and apple',
      });
    }
    const verified = await this.socialVerifier.verify(provider, input.credential);
    let user = await this.repository.findBySocialIdentity(provider, verified.subject);
    if (!user) {
      if (!verified.email || !input.role) {
        throw new BadRequestException({
          code: 'SOCIAL_SIGNUP_DETAILS_REQUIRED',
          message:
            'A verified provider email and renter or owner role are required for first login',
        });
      }
      if (await this.repository.findByEmail(verified.email)) {
        throw new ConflictException({
          code: 'EXPLICIT_IDENTITY_LINK_REQUIRED',
          message: 'An account already uses this email; sign in to that account before linking',
        });
      }
      user = await this.repository.createSocialUser({
        email: this.normalizeEmail(verified.email),
        displayName: verified.displayName?.trim() || 'Smart Platform User',
        role: input.role,
        provider,
        providerSubject: verified.subject,
      });
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
    }
    await this.repository.markLogin(user.id, new Date());
    return this.sessions.create(user, context);
  }

  private async issuePhoneOtp(
    phone: string,
    purpose: OtpPurpose,
    context: SessionClientContext,
    suppressDeliveryErrors: boolean,
  ): Promise<{ accepted: true; expiresInSeconds: number }> {
    const now = new Date();
    const keys = this.legacyOtpRequestKeys(phone, context.ipAddress);
    await this.rateLimiter.assertAllowed(keys, now);
    await this.rateLimiter.recordFailure(keys, now);
    const user = await this.repository.findByPhone(phone);
    const eligible =
      (purpose === 'registration' && user?.status === 'pending') ||
      ((purpose === 'login' || purpose === 'password_reset') && user?.status === 'active');
    if (!eligible) {
      return { accepted: true, expiresInSeconds: this.otpTtlSeconds };
    }
    const code = randomInt(100_000, 1_000_000).toString();
    const challengeId = randomUUID();
    await this.repository.replaceOtpChallenge({
      id: challengeId,
      email: null,
      phone,
      purpose,
      codeHash: this.hashOtp(phone, purpose, code),
      maxAttempts: this.otpMaxAttempts,
      expiresAt: new Date(now.getTime() + this.otpTtlSeconds * 1000),
      requestedIp: context.ipAddress,
    });
    try {
      await this.otpDelivery.send({ phone, purpose, code, expiresInSeconds: this.otpTtlSeconds });
    } catch (error: unknown) {
      await this.repository.cancelOtp(challengeId, new Date());
      if (!suppressDeliveryErrors) {
        throw error;
      }
    }
    return { accepted: true, expiresInSeconds: this.otpTtlSeconds };
  }

  private otpAccepted(
    attemptId: string,
    expiresInSeconds: number,
    resendAfterSeconds: number,
  ): OtpAcceptedResponse {
    return {
      accepted: true,
      attemptId,
      expiresInSeconds,
      resendAfterSeconds,
    };
  }

  private otpMatches(
    recipient: string,
    purpose: OtpPurpose,
    code: string,
    expectedHash: string,
  ): boolean {
    const actual = Buffer.from(this.hashOtp(recipient, purpose, code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hashOtp(recipient: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.otpSecret)
      .update(`${purpose}:${recipient}:${code}`)
      .digest('hex');
  }

  private loginKeys(email: string, context: SessionClientContext): ThrottleKey[] {
    const policy = {
      limit: this.loginFailureLimit,
      windowMs: this.loginWindowSeconds * 1000,
      blockMs: this.loginLockSeconds * 1000,
    };
    return this.compactKeys([
      { scope: 'login_email', value: email, policy },
      context.ipAddress
        ? {
            scope: 'login_ip',
            value: context.ipAddress,
            policy: { ...policy, limit: this.loginAbuseLimit },
          }
        : null,
      {
        scope: 'login_device',
        value: this.deviceKey(context),
        policy: { ...policy, limit: this.loginAbuseLimit },
      },
    ]);
  }

  private otpRequestKeys(email: string, context: SessionClientContext): ThrottleKey[] {
    const emailPolicy = {
      limit: this.otpRequestLimitPerHour,
      windowMs: 60 * 60_000,
      blockMs: 60 * 60_000,
    };
    return this.compactKeys([
      { scope: 'otp_request_email', value: email, policy: emailPolicy },
      context.ipAddress
        ? {
            scope: 'otp_request_ip',
            value: context.ipAddress,
            policy: { ...emailPolicy, limit: this.otpIpLimitPerHour },
          }
        : null,
      {
        scope: 'otp_request_device',
        value: this.deviceKey(context),
        policy: { ...emailPolicy, limit: this.otpDeviceLimitPerHour },
      },
    ]);
  }

  private otpVerifyKeys(email: string, context: SessionClientContext): ThrottleKey[] {
    const policy = { limit: 10, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
    return this.compactKeys([
      { scope: 'otp_verify_email', value: email, policy },
      context.ipAddress ? { scope: 'otp_verify_ip', value: context.ipAddress, policy } : null,
      { scope: 'otp_verify_device', value: this.deviceKey(context), policy },
    ]);
  }

  private legacyOtpRequestKeys(phone: string, ipAddress: string | null): ThrottleKey[] {
    return this.compactKeys([
      {
        scope: 'otp_request_phone',
        value: phone,
        policy: { limit: 3, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
      },
      ipAddress
        ? {
            scope: 'otp_request_ip',
            value: ipAddress,
            policy: { limit: 20, windowMs: 60 * 60_000, blockMs: 60 * 60_000 },
          }
        : null,
    ]);
  }

  private legacyOtpVerifyKeys(phone: string, ipAddress: string | null): ThrottleKey[] {
    const policy = { limit: 10, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
    return this.compactKeys([
      { scope: 'otp_verify_phone', value: phone, policy },
      ipAddress ? { scope: 'otp_verify_ip', value: ipAddress, policy } : null,
    ]);
  }

  private deviceKey(context: SessionClientContext): string {
    return (
      context.deviceId?.trim() ||
      `${context.ipAddress ?? 'unknown'}:${context.userAgent ?? 'unknown'}`
    );
  }

  private compactKeys(keys: readonly (ThrottleKey | null)[]): ThrottleKey[] {
    return keys.filter((key): key is ThrottleKey => key !== null);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  private assertLegacyPhoneFlowsEnabled(): void {
    if (!this.legacyPhoneFlowsEnabled) {
      throw new ServiceUnavailableException({
        code: 'LEGACY_PHONE_AUTH_DISABLED',
        message: 'Legacy phone authentication is disabled',
      });
    }
  }

  private async requireUser(userId: string): Promise<IdentityUser> {
    const user = await this.repository.findById(userId);
    if (!user) {
      throw new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Session is invalid' });
    }
    return user;
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  private invalidOtp(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_OTP',
      message: 'OTP is invalid or expired',
    });
  }

  private signupUnavailable(): BadRequestException {
    return new BadRequestException({
      code: 'SIGNUP_UNAVAILABLE',
      message: 'Unable to complete sign up',
    });
  }

  private isSocialProvider(provider: string): provider is SocialProvider {
    return provider === 'google' || provider === 'facebook' || provider === 'apple';
  }
}
