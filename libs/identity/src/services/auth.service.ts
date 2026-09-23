import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  ChangePasswordDto,
  LoginDto,
  PasswordRecoveryResetDto,
  PasswordRecoveryVerifyDto,
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

export interface PasswordRecoveryAcceptedResponse {
  accepted: true;
  message: 'Nếu email tồn tại, mã xác thực đã được gửi.';
  challengeId: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export interface PasswordRecoveryVerifiedResponse {
  verified: true;
  resetToken: string;
  expiresInSeconds: number;
}

export interface PasswordRecoveryCompletedResponse {
  reset: true;
  next: 'sign_in';
  email: string;
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
  private readonly passwordRecoveryEmailLimit: number;
  private readonly passwordRecoveryEmailWindowSeconds: number;
  private readonly passwordRecoveryIpLimit: number;
  private readonly passwordRecoveryIpWindowSeconds: number;
  private readonly passwordRecoveryDeviceLimit: number;
  private readonly resetTokenTtlSeconds: number;
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
    this.passwordRecoveryEmailLimit = config.getOrThrow<number>('auth.passwordRecoveryEmailLimit');
    this.passwordRecoveryEmailWindowSeconds = config.getOrThrow<number>(
      'auth.passwordRecoveryEmailWindowSeconds',
    );
    this.passwordRecoveryIpLimit = config.getOrThrow<number>('auth.passwordRecoveryIpLimit');
    this.passwordRecoveryIpWindowSeconds = config.getOrThrow<number>(
      'auth.passwordRecoveryIpWindowSeconds',
    );
    this.passwordRecoveryDeviceLimit = config.getOrThrow<number>(
      'auth.passwordRecoveryDeviceLimit',
    );
    this.resetTokenTtlSeconds = config.getOrThrow<number>('auth.resetTokenTtlSeconds');
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

  public async requestPasswordRecovery(
    rawEmail: string,
    context: SessionClientContext,
  ): Promise<PasswordRecoveryAcceptedResponse> {
    const email = this.normalizeEmail(rawEmail);
    const now = new Date();
    const keys = this.passwordRecoveryRequestKeys(email, context);
    await this.rateLimiter.assertAllowed(keys, now);
    await this.rateLimiter.recordFailure(keys, now);
    await this.emailDelivery.assertAvailable();

    const [user, current] = await Promise.all([
      this.repository.findByEmail(email),
      this.repository.findOtpChallenge({ email }, 'password_reset'),
    ]);
    const eligible = user?.status === 'active' && Boolean(user.passwordHash);
    if (!eligible) {
      await this.auditRecovery('password_recovery.requested', null, email, context, now, {
        outcome: 'accepted',
      });
      return this.passwordRecoveryAccepted(randomUUID());
    }

    if (current) {
      const elapsedSeconds = Math.floor((now.getTime() - current.createdAt.getTime()) / 1000);
      const remaining = this.otpResendCooldownSeconds - elapsedSeconds;
      if (remaining > 0) {
        await this.auditRecovery('password_recovery.requested', user.id, email, context, now, {
          outcome: 'cooldown',
        });
        return this.passwordRecoveryAccepted(current.id, remaining);
      }
    }

    const code = randomInt(100_000, 1_000_000).toString();
    const challengeId = randomUUID();
    await this.repository.replaceOtpChallenge({
      id: challengeId,
      email,
      phone: null,
      purpose: 'password_reset',
      codeHash: this.hashOtp(email, 'password_reset', code),
      maxAttempts: this.otpMaxAttempts,
      expiresAt: new Date(now.getTime() + this.otpTtlSeconds * 1000),
      requestedIp: context.ipAddress,
    });
    try {
      await this.emailDelivery.sendOtp({
        email,
        purpose: 'password_reset',
        code,
        expiresInSeconds: this.otpTtlSeconds,
      });
      await this.auditRecovery(
        current ? 'password_recovery.resent' : 'password_recovery.requested',
        user.id,
        email,
        context,
        now,
        { outcome: 'sent' },
      );
    } catch {
      await this.repository.cancelOtp(challengeId, now);
      await this.auditRecovery('password_recovery.delivery_failed', user.id, email, context, now, {
        outcome: 'accepted',
      });
    }
    return this.passwordRecoveryAccepted(challengeId);
  }

  public async verifyPasswordRecovery(
    input: PasswordRecoveryVerifyDto,
    context: SessionClientContext,
  ): Promise<PasswordRecoveryVerifiedResponse> {
    const email = this.normalizeEmail(input.email);
    const now = new Date();
    const keys = this.otpVerifyKeys(email, context);
    await this.rateLimiter.assertAllowed(keys, now);
    const [challenge, user] = await Promise.all([
      this.repository.findOtpChallenge({ email }, 'password_reset'),
      this.repository.findByEmail(email),
    ]);
    const eligible = user?.status === 'active' && Boolean(user.passwordHash);
    if (
      !eligible ||
      !challenge ||
      challenge.id !== input.challengeId ||
      challenge.consumedAt ||
      challenge.expiresAt <= now ||
      challenge.attemptCount >= challenge.maxAttempts ||
      !this.otpMatches(email, 'password_reset', input.code, challenge.codeHash)
    ) {
      if (
        challenge &&
        challenge.id === input.challengeId &&
        challenge.attemptCount < challenge.maxAttempts
      ) {
        await this.repository.recordOtpFailure(challenge.id);
      }
      await this.rateLimiter.recordFailure(keys, now);
      await this.auditRecovery(
        'password_recovery.verify_failed',
        user?.id ?? null,
        email,
        context,
        now,
      );
      throw this.invalidRecoveryOtp();
    }

    const resetToken = randomBytes(32).toString('base64url');
    const issued = await this.repository.issuePasswordResetToken({
      challengeId: challenge.id,
      userId: user.id,
      email,
      codeHash: challenge.codeHash,
      tokenHash: this.hashResetToken(resetToken),
      contextHash: this.hashRecoveryContext(context),
      expiresAt: new Date(now.getTime() + this.resetTokenTtlSeconds * 1000),
      issuedAt: now,
      audit: {
        eventType: 'password_recovery.verified',
        userId: user.id,
        maskedEmail: this.maskEmail(email),
        occurredAt: now,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    if (!issued) {
      throw this.invalidRecoveryOtp();
    }
    await this.rateLimiter.clear(keys);
    return { verified: true, resetToken, expiresInSeconds: this.resetTokenTtlSeconds };
  }

  public async completePasswordRecovery(
    input: PasswordRecoveryResetDto,
    context: SessionClientContext,
  ): Promise<PasswordRecoveryCompletedResponse> {
    if (input.newPassword !== input.confirmPassword) {
      throw new BadRequestException({
        code: 'PASSWORD_CONFIRMATION_MISMATCH',
        message: 'Password confirmation does not match',
      });
    }
    const now = new Date();
    const tokenHash = this.hashResetToken(input.resetToken);
    const token = await this.repository.findPasswordResetToken(tokenHash);
    if (
      !token ||
      token.consumedAt ||
      token.expiresAt <= now ||
      token.contextHash !== this.hashRecoveryContext(context)
    ) {
      throw this.invalidResetToken();
    }
    const user = await this.repository.findById(token.userId);
    if (!user?.email || !user.passwordHash || user.status !== 'active') {
      throw this.invalidResetToken();
    }
    if (await this.passwords.verify(input.newPassword, user.passwordHash)) {
      throw new BadRequestException({
        code: 'PASSWORD_UNCHANGED',
        message: 'New password must be different from the current password',
      });
    }
    const result = await this.repository.resetPasswordWithToken({
      tokenHash,
      contextHash: this.hashRecoveryContext(context),
      passwordHash: await this.passwords.hash(input.newPassword),
      resetAt: now,
      audit: {
        eventType: 'password_recovery.reset',
        userId: user.id,
        maskedEmail: this.maskEmail(user.email),
        occurredAt: now,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    if (result !== 'reset') {
      throw this.invalidResetToken();
    }
    return { reset: true, next: 'sign_in', email: user.email };
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

  private passwordRecoveryAccepted(
    challengeId: string,
    resendAfterSeconds = this.otpResendCooldownSeconds,
  ): PasswordRecoveryAcceptedResponse {
    return {
      accepted: true,
      message: 'Nếu email tồn tại, mã xác thực đã được gửi.',
      challengeId,
      expiresInSeconds: this.otpTtlSeconds,
      resendAfterSeconds: Math.max(1, Math.min(this.otpResendCooldownSeconds, resendAfterSeconds)),
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

  private hashResetToken(token: string): string {
    return createHmac('sha256', this.otpSecret)
      .update(`password_reset_token:${token}`)
      .digest('hex');
  }

  private hashRecoveryContext(context: SessionClientContext): string {
    return createHmac('sha256', this.otpSecret)
      .update(`password_reset_context:${this.deviceKey(context)}`)
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

  private passwordRecoveryRequestKeys(email: string, context: SessionClientContext): ThrottleKey[] {
    const emailPolicy = {
      limit: this.passwordRecoveryEmailLimit,
      windowMs: this.passwordRecoveryEmailWindowSeconds * 1000,
      blockMs: this.passwordRecoveryEmailWindowSeconds * 1000,
    };
    const abusePolicy = {
      limit: this.passwordRecoveryIpLimit,
      windowMs: this.passwordRecoveryIpWindowSeconds * 1000,
      blockMs: this.passwordRecoveryIpWindowSeconds * 1000,
    };
    return this.compactKeys([
      { scope: 'password_recovery_email', value: email, policy: emailPolicy },
      context.ipAddress
        ? { scope: 'password_recovery_ip', value: context.ipAddress, policy: abusePolicy }
        : null,
      {
        scope: 'password_recovery_device',
        value: this.deviceKey(context),
        policy: { ...abusePolicy, limit: this.passwordRecoveryDeviceLimit },
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

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@') as [string, string];
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
  }

  private auditRecovery(
    eventType: string,
    userId: string | null,
    email: string,
    context: SessionClientContext,
    occurredAt: Date,
    data?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    return this.repository.recordRecoveryAudit({
      eventType,
      userId,
      maskedEmail: this.maskEmail(email),
      occurredAt,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      data,
    });
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

  private invalidRecoveryOtp(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'PASSWORD_RECOVERY_OTP_INVALID',
      message: 'OTP is invalid or expired',
    });
  }

  private invalidResetToken(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'PASSWORD_RESET_TOKEN_INVALID',
      message: 'Password reset token is invalid or expired',
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
