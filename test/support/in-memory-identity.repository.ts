import { randomUUID } from 'node:crypto';
import type { ActorRole, SocialProvider } from '../../libs/identity/src/public/identity.contracts';
import {
  IdentityRepository,
  type IdentityUser,
  type NewPhoneUser,
  type NewSession,
  type NewSocialUser,
  type OtpChallengeRecord,
  type OtpPurpose,
  type SessionRotationResult,
  type ThrottleBucket,
  type ThrottlePolicy,
} from '../../libs/identity/src/persistence/identity.repository';

interface StoredSession extends NewSession {
  revokedAt: Date | null;
}

export class InMemoryIdentityRepository extends IdentityRepository {
  public readonly users = new Map<string, IdentityUser>();
  public readonly sessions = new Map<string, StoredSession>();
  private readonly otpChallenges = new Map<string, OtpChallengeRecord>();
  private readonly throttles = new Map<string, ThrottleBucket>();
  private readonly socialUsers = new Map<string, string>();

  public async findByPhone(phone: string): Promise<IdentityUser | null> {
    return [...this.users.values()].find((user) => user.phone === phone) ?? null;
  }

  public async findByEmail(email: string): Promise<IdentityUser | null> {
    return (
      [...this.users.values()].find((user) => user.email?.toLowerCase() === email.toLowerCase()) ??
      null
    );
  }

  public async findById(userId: string): Promise<IdentityUser | null> {
    return this.users.get(userId) ?? null;
  }

  public async findBySocialIdentity(
    provider: SocialProvider,
    providerSubject: string,
  ): Promise<IdentityUser | null> {
    const userId = this.socialUsers.get(`${provider}:${providerSubject}`);
    return userId ? this.findById(userId) : null;
  }

  public async createPhoneUser(input: NewPhoneUser): Promise<IdentityUser> {
    const user: IdentityUser = {
      id: randomUUID(),
      email: null,
      phone: input.phone,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      status: 'pending',
      roles: [input.role],
    };
    this.users.set(user.id, user);
    return user;
  }

  public async createSocialUser(input: NewSocialUser): Promise<IdentityUser> {
    const user: IdentityUser = {
      id: randomUUID(),
      email: input.email,
      phone: null,
      passwordHash: null,
      displayName: input.displayName,
      status: 'active',
      roles: [input.role],
    };
    this.users.set(user.id, user);
    this.socialUsers.set(`${input.provider}:${input.providerSubject}`, user.id);
    return user;
  }

  public async activatePhone(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      this.users.set(userId, { ...user, status: 'active' });
    }
  }

  public async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      this.users.set(userId, { ...user, passwordHash });
    }
  }

  public async markLogin(): Promise<void> {}

  public async replaceOtpChallenge(input: {
    id: string;
    phone: string;
    purpose: OtpPurpose;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
  }): Promise<void> {
    for (const [key, challenge] of this.otpChallenges) {
      if (
        challenge.phone === input.phone &&
        challenge.purpose === input.purpose &&
        !challenge.consumedAt
      ) {
        this.otpChallenges.set(key, { ...challenge, consumedAt: new Date() });
      }
    }
    this.otpChallenges.set(input.id, {
      id: input.id,
      phone: input.phone,
      purpose: input.purpose,
      codeHash: input.codeHash,
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      expiresAt: input.expiresAt,
      consumedAt: null,
    });
  }

  public async findOtpChallenge(
    phone: string,
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | null> {
    return (
      [...this.otpChallenges.values()]
        .reverse()
        .find(
          (challenge) =>
            challenge.phone === phone && challenge.purpose === purpose && !challenge.consumedAt,
        ) ?? null
    );
  }

  public async recordOtpFailure(challengeId: string): Promise<void> {
    const challenge = this.otpChallenges.get(challengeId);
    if (challenge) {
      this.otpChallenges.set(challengeId, {
        ...challenge,
        attemptCount: challenge.attemptCount + 1,
      });
    }
  }

  public async consumeOtp(challengeId: string, consumedAt: Date): Promise<boolean> {
    const challenge = this.otpChallenges.get(challengeId);
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= consumedAt ||
      challenge.attemptCount >= challenge.maxAttempts
    ) {
      return false;
    }
    this.otpChallenges.set(challengeId, { ...challenge, consumedAt });
    return true;
  }

  public async cancelOtp(challengeId: string, consumedAt: Date): Promise<void> {
    const challenge = this.otpChallenges.get(challengeId);
    if (challenge) {
      this.otpChallenges.set(challengeId, { ...challenge, consumedAt });
    }
  }

  public async createSession(session: NewSession): Promise<void> {
    this.sessions.set(session.id, { ...session, revokedAt: null });
  }

  public async rotateSession(input: {
    currentSessionId: string;
    currentFamilyId: string;
    currentTokenHash: string;
    replacement: NewSession;
    usedAt: Date;
  }): Promise<SessionRotationResult> {
    const current = this.sessions.get(input.currentSessionId);
    if (
      !current ||
      current.familyId !== input.currentFamilyId ||
      current.refreshTokenHash !== input.currentTokenHash
    ) {
      return 'missing';
    }
    if (current.revokedAt) {
      for (const [sessionId, session] of this.sessions) {
        if (session.familyId === current.familyId) {
          this.sessions.set(sessionId, {
            ...session,
            revokedAt: session.revokedAt ?? input.usedAt,
          });
        }
      }
      return 'reused';
    }
    if (current.expiresAt <= input.usedAt) {
      this.sessions.set(current.id, { ...current, revokedAt: input.usedAt });
      return 'expired';
    }
    this.sessions.set(current.id, { ...current, revokedAt: input.usedAt });
    this.sessions.set(input.replacement.id, { ...input.replacement, revokedAt: null });
    return 'rotated';
  }

  public async isSessionActive(sessionId: string, userId: string, at: Date): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    return Boolean(
      session && session.userId === userId && !session.revokedAt && session.expiresAt > at,
    );
  }

  public async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      if (session.refreshTokenHash === tokenHash && !session.revokedAt) {
        this.sessions.set(sessionId, { ...session, revokedAt });
      }
    }
  }

  public async revokeSessionsForUser(userId: string, revokedAt: Date): Promise<void> {
    for (const [sessionId, session] of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        this.sessions.set(sessionId, { ...session, revokedAt });
      }
    }
  }

  public async findThrottle(scope: string, keyHash: string): Promise<ThrottleBucket | null> {
    return this.throttles.get(`${scope}:${keyHash}`) ?? null;
  }

  public async recordThrottleFailure(
    scope: string,
    keyHash: string,
    policy: ThrottlePolicy,
    at: Date,
  ): Promise<ThrottleBucket> {
    const key = `${scope}:${keyHash}`;
    const current = this.throttles.get(key);
    const windowExpired = current
      ? at.getTime() - current.windowStartedAt.getTime() >= policy.windowMs
      : true;
    const attemptCount = windowExpired ? 1 : (current?.attemptCount ?? 0) + 1;
    const bucket = {
      windowStartedAt: windowExpired ? at : (current?.windowStartedAt ?? at),
      attemptCount,
      blockedUntil: attemptCount >= policy.limit ? new Date(at.getTime() + policy.blockMs) : null,
    };
    this.throttles.set(key, bucket);
    return bucket;
  }

  public async clearThrottle(scope: string, keyHash: string): Promise<void> {
    this.throttles.delete(`${scope}:${keyHash}`);
  }

  public addActiveUser(input: {
    phone: string;
    passwordHash: string;
    roles?: readonly ActorRole[];
  }): IdentityUser {
    const user: IdentityUser = {
      id: randomUUID(),
      email: null,
      phone: input.phone,
      passwordHash: input.passwordHash,
      displayName: 'Existing User',
      status: 'active',
      roles: input.roles ?? ['renter'],
    };
    this.users.set(user.id, user);
    return user;
  }
}
