import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  IdentityRepository,
  type IdentityUser,
  type OtpPurpose,
} from '../persistence/identity.repository';
import { OtpDeliveryPort } from '../providers/otp-delivery.port';
import { SocialIdentityVerifier } from '../providers/social-identity-verifier.port';
import type {
  AuthenticatedActor,
  AuthSessionTokens,
  SocialProvider,
} from '../public/identity.contracts';
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  SocialLoginDto,
} from '../http/auth.dto';
import { JwtSessionService, type SessionClientContext } from '../security/jwt-session.service';
import { PasswordHasherService } from '../security/password-hasher.service';
import { RateLimiterService, type ThrottleKey } from '../security/rate-limiter.service';

const OTP_MAX_ATTEMPTS = 5;
const LOGIN_PHONE_POLICY = { limit: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const LOGIN_IP_POLICY = { limit: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const OTP_PHONE_POLICY = { limit: 3, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const OTP_IP_POLICY = { limit: 20, windowMs: 60 * 60_000, blockMs: 60 * 60_000 };
const OTP_VERIFY_POLICY = { limit: 10, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export interface OtpAcceptedResponse {
  accepted: true;
  expiresInSeconds: number;
}

export interface RegistrationResponse extends OtpAcceptedResponse {
  userId: string;
  status: 'verification_required';
}

@Injectable()
export class AuthService {
  private readonly otpSecret: string;
  private readonly otpTtlSeconds: number;

  public constructor(
    config: ConfigService,
    private readonly repository: IdentityRepository,
    private readonly passwords: PasswordHasherService,
    private readonly sessions: JwtSessionService,
    private readonly rateLimiter: RateLimiterService,
    private readonly otpDelivery: OtpDeliveryPort,
    private readonly socialVerifier: SocialIdentityVerifier,
  ) {
    this.otpSecret = config.getOrThrow<string>('auth.otpHashSecret');
    this.otpTtlSeconds = config.getOrThrow<number>('auth.otpTtlSeconds');
  }

  public async register(
    input: RegisterDto,
    context: SessionClientContext,
  ): Promise<RegistrationResponse> {
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

  public async login(input: LoginDto, context: SessionClientContext): Promise<AuthSessionTokens> {
    const phone = this.normalizePhone(input.phone);
    const keys = this.loginKeys(phone, context.ipAddress);
    const now = new Date();
    await this.rateLimiter.assertAllowed(keys, now);
    const user = await this.repository.findByPhone(phone);
    if (!user?.passwordHash) {
      await this.passwords.consumeDummyWork(input.password);
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidCredentials();
    }
    const passwordMatches = await this.passwords.verify(input.password, user.passwordHash);
    if (!passwordMatches) {
      await this.rateLimiter.recordFailure(keys, now);
      throw this.invalidCredentials();
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Account is not active',
      });
    }
    await Promise.all([this.rateLimiter.clear(keys), this.repository.markLogin(user.id, now)]);
    return this.sessions.create(user, context);
  }

  public async requestOtp(
    rawPhone: string,
    purpose: Exclude<OtpPurpose, 'password_reset'>,
    context: SessionClientContext,
  ): Promise<OtpAcceptedResponse> {
    return this.issueOtp(this.normalizePhone(rawPhone), purpose, context, false);
  }

  public async verifyOtp(
    rawPhone: string,
    purpose: Exclude<OtpPurpose, 'password_reset'>,
    code: string,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    const phone = this.normalizePhone(rawPhone);
    const keys = this.otpVerifyKeys(phone, context.ipAddress);
    const now = new Date();
    await this.rateLimiter.assertAllowed(keys, now);
    const challenge = await this.repository.findOtpChallenge(phone, purpose);
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
  ): Promise<OtpAcceptedResponse> {
    return this.issueOtp(this.normalizePhone(rawPhone), 'password_reset', context, true);
  }

  public async resetPassword(
    input: ResetPasswordDto,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    const phone = this.normalizePhone(input.phone);
    const now = new Date();
    const keys = this.otpVerifyKeys(phone, context.ipAddress);
    await this.rateLimiter.assertAllowed(keys, now);
    const challenge = await this.repository.findOtpChallenge(phone, 'password_reset');
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
    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.repository.updatePassword(user.id, passwordHash);
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
        email: verified.email,
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

  private async issueOtp(
    phone: string,
    purpose: OtpPurpose,
    context: SessionClientContext,
    suppressDeliveryErrors: boolean,
  ): Promise<OtpAcceptedResponse> {
    const now = new Date();
    const keys = this.otpRequestKeys(phone, context.ipAddress);
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
      phone,
      purpose,
      codeHash: this.hashOtp(phone, purpose, code),
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt: new Date(now.getTime() + this.otpTtlSeconds * 1000),
      requestedIp: context.ipAddress,
    });
    try {
      await this.otpDelivery.send({
        phone,
        purpose,
        code,
        expiresInSeconds: this.otpTtlSeconds,
      });
    } catch (error: unknown) {
      await this.repository.cancelOtp(challengeId, new Date());
      if (!suppressDeliveryErrors) {
        throw error;
      }
    }
    return { accepted: true, expiresInSeconds: this.otpTtlSeconds };
  }

  private otpMatches(
    phone: string,
    purpose: OtpPurpose,
    code: string,
    expectedHash: string,
  ): boolean {
    const actual = Buffer.from(this.hashOtp(phone, purpose, code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hashOtp(phone: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.otpSecret).update(`${purpose}:${phone}:${code}`).digest('hex');
  }

  private loginKeys(phone: string, ipAddress: string | null): ThrottleKey[] {
    return this.compactKeys([
      { scope: 'login_phone', value: phone, policy: LOGIN_PHONE_POLICY },
      ipAddress ? { scope: 'login_ip', value: ipAddress, policy: LOGIN_IP_POLICY } : null,
    ]);
  }

  private otpRequestKeys(phone: string, ipAddress: string | null): ThrottleKey[] {
    return this.compactKeys([
      { scope: 'otp_request_phone', value: phone, policy: OTP_PHONE_POLICY },
      ipAddress ? { scope: 'otp_request_ip', value: ipAddress, policy: OTP_IP_POLICY } : null,
    ]);
  }

  private otpVerifyKeys(phone: string, ipAddress: string | null): ThrottleKey[] {
    return this.compactKeys([
      { scope: 'otp_verify_phone', value: phone, policy: OTP_VERIFY_POLICY },
      ipAddress ? { scope: 'otp_verify_ip', value: ipAddress, policy: OTP_VERIFY_POLICY } : null,
    ]);
  }

  private compactKeys(keys: readonly (ThrottleKey | null)[]): ThrottleKey[] {
    return keys.filter((key): key is ThrottleKey => key !== null);
  }

  private normalizePhone(phone: string): string {
    return phone.trim();
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
      message: 'Invalid phone or password',
    });
  }

  private invalidOtp(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_OTP',
      message: 'OTP is invalid or expired',
    });
  }

  private isSocialProvider(provider: string): provider is SocialProvider {
    return provider === 'google' || provider === 'facebook' || provider === 'apple';
  }
}
