import type { ActorRole, ActorStatus, SocialProvider } from '../public/identity.contracts';

export interface IdentityUser {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  displayName: string | null;
  status: ActorStatus;
  roles: readonly ActorRole[];
}

export interface NewPhoneUser {
  phone: string;
  passwordHash: string;
  displayName: string;
  role: Exclude<ActorRole, 'admin'>;
}

export interface CompleteEmailSignup {
  challengeId: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  codeHash: string;
  completedAt: Date;
}

export interface NewSocialUser {
  email: string;
  displayName: string;
  role: Exclude<ActorRole, 'admin'>;
  provider: SocialProvider;
  providerSubject: string;
}

export type OtpPurpose = 'registration' | 'login' | 'password_reset';

export interface OtpChallengeRecord {
  id: string;
  email: string | null;
  phone: string | null;
  purpose: OtpPurpose;
  codeHash: string;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  verifiedAt: Date | null;
}

export interface NewSession {
  id: string;
  familyId: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}

export type SessionRotationResult = 'rotated' | 'missing' | 'expired' | 'reused';

export interface ThrottleBucket {
  windowStartedAt: Date;
  attemptCount: number;
  blockedUntil: Date | null;
}

export interface ThrottlePolicy {
  limit: number;
  windowMs: number;
  blockMs: number;
}

export abstract class IdentityRepository {
  public abstract findByPhone(phone: string): Promise<IdentityUser | null>;
  public abstract findByEmail(email: string): Promise<IdentityUser | null>;
  public abstract findById(userId: string): Promise<IdentityUser | null>;
  public abstract findBySocialIdentity(
    provider: SocialProvider,
    providerSubject: string,
  ): Promise<IdentityUser | null>;
  public abstract createPhoneUser(input: NewPhoneUser): Promise<IdentityUser>;
  public abstract completeEmailSignup(input: CompleteEmailSignup): Promise<IdentityUser | null>;
  public abstract createSocialUser(input: NewSocialUser): Promise<IdentityUser>;
  public abstract activatePhone(userId: string, verifiedAt: Date): Promise<void>;
  public abstract updatePassword(userId: string, passwordHash: string): Promise<void>;
  public abstract markLogin(userId: string, at: Date): Promise<void>;

  public abstract replaceOtpChallenge(input: {
    id: string;
    email: string | null;
    phone: string | null;
    purpose: OtpPurpose;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<void>;
  public abstract findOtpChallenge(
    recipient: { email: string } | { phone: string },
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | null>;
  public abstract recordOtpFailure(challengeId: string): Promise<void>;
  public abstract markOtpVerified(challengeId: string, verifiedAt: Date): Promise<boolean>;
  public abstract consumeOtp(challengeId: string, consumedAt: Date): Promise<boolean>;
  public abstract cancelOtp(challengeId: string, consumedAt: Date): Promise<void>;

  public abstract createSession(session: NewSession): Promise<void>;
  public abstract rotateSession(input: {
    currentSessionId: string;
    currentFamilyId: string;
    currentTokenHash: string;
    replacement: NewSession;
    usedAt: Date;
  }): Promise<SessionRotationResult>;
  public abstract isSessionActive(sessionId: string, userId: string, at: Date): Promise<boolean>;
  public abstract revokeSessionByTokenHash(
    tokenHash: string,
    revokedAt: Date,
    reason: string,
  ): Promise<void>;
  public abstract revokeSessionsForUser(
    userId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<void>;

  public abstract findThrottle(scope: string, keyHash: string): Promise<ThrottleBucket | null>;
  public abstract recordThrottleFailure(
    scope: string,
    keyHash: string,
    policy: ThrottlePolicy,
    at: Date,
  ): Promise<ThrottleBucket>;
  public abstract clearThrottle(scope: string, keyHash: string): Promise<void>;
}
