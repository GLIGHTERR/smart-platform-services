import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { ActorRole, ActorStatus, SocialProvider } from '../public/identity.contracts';
import {
  IdentityRepository,
  type CompleteEmailSignup,
  type IdentityUser,
  type NewPhoneUser,
  type NewSession,
  type NewSocialUser,
  type OtpChallengeRecord,
  type OtpPurpose,
  type SessionRotationResult,
  type ThrottleBucket,
  type ThrottlePolicy,
} from './identity.repository';

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  display_name: string | null;
  status: ActorStatus;
  roles: ActorRole[];
}

interface OtpRow {
  id: string;
  email: string | null;
  phone: string | null;
  purpose: OtpPurpose;
  code_hash: string;
  attempt_count: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
  verified_at: Date | null;
}

interface SessionRow {
  id: string;
  family_id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

interface ThrottleRow {
  window_started_at: Date;
  attempt_count: number;
  blocked_until: Date | null;
}

@Injectable()
export class PostgresIdentityRepository extends IdentityRepository {
  public constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  public findByPhone(phone: string): Promise<IdentityUser | null> {
    return this.findOne('u.phone = $1 AND u.phone_login_enabled', [phone]);
  }

  public findByEmail(email: string): Promise<IdentityUser | null> {
    return this.findOne('lower(u.email) = lower($1)', [email]);
  }

  public findById(userId: string): Promise<IdentityUser | null> {
    return this.findOne('u.id = $1', [userId]);
  }

  public findBySocialIdentity(
    provider: SocialProvider,
    providerSubject: string,
  ): Promise<IdentityUser | null> {
    return this.findOne(
      `EXISTS (
        SELECT 1 FROM social_identities si
        WHERE si.user_id = u.id AND si.provider = $1 AND si.provider_subject = $2
      )`,
      [provider, providerSubject],
    );
  }

  public async createPhoneUser(input: NewPhoneUser): Promise<IdentityUser> {
    try {
      const userId = await this.dataSource.transaction(async (manager) => {
        const [user] = await manager.query<Array<{ id: string }>>(
          `
            INSERT INTO users (phone, password_hash, display_name, status, phone_login_enabled)
            VALUES ($1, $2, $3, 'pending', true)
            RETURNING id
          `,
          [input.phone, input.passwordHash, input.displayName],
        );
        if (!user) {
          throw new Error('User insert returned no row');
        }
        await this.grantRoleAndCreateProfile(manager, user.id, input.role);
        return user.id;
      });
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('Created user could not be loaded');
      }
      return user;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'PHONE_ALREADY_REGISTERED',
          message: 'Phone is registered',
        });
      }
      throw error;
    }
  }

  public async completeEmailSignup(input: CompleteEmailSignup): Promise<IdentityUser | null> {
    try {
      const userId = await this.dataSource.transaction(async (manager) => {
        const challenges = await manager.query<Array<{ id: string }>>(
          `
            SELECT id
            FROM otp_challenges
            WHERE id = $1
              AND email = $2
              AND purpose = 'registration'
              AND code_hash = $3
              AND verified_at IS NOT NULL
              AND consumed_at IS NULL
              AND expires_at > $4
            FOR UPDATE
          `,
          [input.challengeId, input.email, input.codeHash, input.completedAt],
        );
        if (!challenges[0]) {
          return null;
        }
        const [user] = await manager.query<Array<{ id: string }>>(
          `
            INSERT INTO users
              (email, phone, password_hash, display_name, status, email_verified_at)
            VALUES ($1, $2, $3, NULL, 'active', $4)
            RETURNING id
          `,
          [input.email, input.phone, input.passwordHash, input.completedAt],
        );
        if (!user) {
          throw new Error('User insert returned no row');
        }
        await this.grantRoleAndCreateProfile(manager, user.id, 'renter');
        await manager.query(`UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1`, [
          input.challengeId,
          input.completedAt,
        ]);
        return user.id;
      });
      if (!userId) {
        return null;
      }
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('Created email user could not be loaded');
      }
      return user;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'SIGNUP_UNAVAILABLE',
          message: 'Unable to complete sign up',
        });
      }
      throw error;
    }
  }

  public async createSocialUser(input: NewSocialUser): Promise<IdentityUser> {
    try {
      const userId = await this.dataSource.transaction(async (manager) => {
        const [user] = await manager.query<Array<{ id: string }>>(
          `
            INSERT INTO users (email, display_name, status, email_verified_at)
            VALUES (lower($1), $2, 'active', now())
            RETURNING id
          `,
          [input.email, input.displayName],
        );
        if (!user) {
          throw new Error('User insert returned no row');
        }
        await manager.query(
          `
            INSERT INTO social_identities (user_id, provider, provider_subject, provider_email)
            VALUES ($1, $2, $3, lower($4))
          `,
          [user.id, input.provider, input.providerSubject, input.email],
        );
        await this.grantRoleAndCreateProfile(manager, user.id, input.role);
        return user.id;
      });
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('Created social user could not be loaded');
      }
      return user;
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'SOCIAL_IDENTITY_CONFLICT',
          message: 'Social identity or verified email is already registered',
        });
      }
      throw error;
    }
  }

  public async activatePhone(userId: string, verifiedAt: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE users SET status = 'active', phone_verified_at = $2 WHERE id = $1 AND status = 'pending'`,
      [userId, verifiedAt],
    );
  }

  public async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.dataSource.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
      userId,
      passwordHash,
    ]);
  }

  public async markLogin(userId: string, at: Date): Promise<void> {
    await this.dataSource.query(`UPDATE users SET last_login_at = $2 WHERE id = $1`, [userId, at]);
  }

  public async replaceOtpChallenge(input: {
    id: string;
    email: string | null;
    phone: string | null;
    purpose: OtpPurpose;
    codeHash: string;
    maxAttempts: number;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          UPDATE otp_challenges
          SET consumed_at = now()
          WHERE (($1::varchar IS NOT NULL AND email = $1) OR ($2::varchar IS NOT NULL AND phone = $2))
            AND purpose = $3 AND consumed_at IS NULL
        `,
        [input.email, input.phone, input.purpose],
      );
      await manager.query(
        `
          INSERT INTO otp_challenges
            (id, email, phone, purpose, code_hash, max_attempts, expires_at, requested_ip)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          input.id,
          input.email,
          input.phone,
          input.purpose,
          input.codeHash,
          input.maxAttempts,
          input.expiresAt,
          input.requestedIp,
        ],
      );
    });
  }

  public async findOtpChallenge(
    recipient: { email: string } | { phone: string },
    purpose: OtpPurpose,
  ): Promise<OtpChallengeRecord | null> {
    const column = 'email' in recipient ? 'email' : 'phone';
    const value = 'email' in recipient ? recipient.email : recipient.phone;
    const [row] = await this.dataSource.query<OtpRow[]>(
      `
        SELECT id, email, phone, purpose, code_hash, attempt_count, max_attempts,
               expires_at, consumed_at, created_at, verified_at
        FROM otp_challenges
        WHERE ${column} = $1 AND purpose = $2 AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [value, purpose],
    );
    return row ? this.mapOtp(row) : null;
  }

  public async recordOtpFailure(challengeId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1 AND consumed_at IS NULL`,
      [challengeId],
    );
  }

  public async markOtpVerified(challengeId: string, verifiedAt: Date): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `
        UPDATE otp_challenges
        SET verified_at = $2
        WHERE id = $1
          AND consumed_at IS NULL
          AND verified_at IS NULL
          AND expires_at > $2
          AND attempt_count < max_attempts
        RETURNING id
      `,
      [challengeId, verifiedAt],
    );
    return this.updatedExactlyOneRow(result);
  }

  public async consumeOtp(challengeId: string, consumedAt: Date): Promise<boolean> {
    const result: unknown = await this.dataSource.query(
      `
        UPDATE otp_challenges
        SET consumed_at = $2
        WHERE id = $1 AND consumed_at IS NULL AND expires_at > $2 AND attempt_count < max_attempts
        RETURNING id
      `,
      [challengeId, consumedAt],
    );
    return this.updatedExactlyOneRow(result);
  }

  public async cancelOtp(challengeId: string, consumedAt: Date): Promise<void> {
    await this.dataSource.query(
      `UPDATE otp_challenges SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`,
      [challengeId, consumedAt],
    );
  }

  public async createSession(session: NewSession): Promise<void> {
    await this.insertSession(this.dataSource.manager, session);
  }

  public async rotateSession(input: {
    currentSessionId: string;
    currentFamilyId: string;
    currentTokenHash: string;
    replacement: NewSession;
    usedAt: Date;
  }): Promise<SessionRotationResult> {
    return this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query<SessionRow[]>(
        `
          SELECT id, family_id, user_id, expires_at, revoked_at
          FROM auth_sessions
          WHERE id = $1 AND refresh_token_hash = $2
          FOR UPDATE
        `,
        [input.currentSessionId, input.currentTokenHash],
      );
      if (!current || current.family_id !== input.currentFamilyId) {
        return 'missing';
      }
      if (current.revoked_at) {
        await manager.query(
          `
            UPDATE auth_sessions
            SET revoked_at = COALESCE(revoked_at, $2), revoke_reason = COALESCE(revoke_reason, 'refresh_reuse')
            WHERE family_id = $1
          `,
          [current.family_id, input.usedAt],
        );
        return 'reused';
      }
      if (current.expires_at <= input.usedAt) {
        await manager.query(
          `UPDATE auth_sessions SET revoked_at = $2, revoke_reason = 'expired' WHERE id = $1`,
          [current.id, input.usedAt],
        );
        return 'expired';
      }
      if (
        input.replacement.userId !== current.user_id ||
        input.replacement.familyId !== current.family_id
      ) {
        return 'missing';
      }
      await this.insertSession(manager, input.replacement);
      await manager.query(
        `
          UPDATE auth_sessions
          SET revoked_at = $2,
              revoke_reason = 'rotated',
              replaced_by_session_id = $3,
              last_used_at = $2
          WHERE id = $1
        `,
        [current.id, input.usedAt, input.replacement.id],
      );
      return 'rotated';
    });
  }

  public async isSessionActive(sessionId: string, userId: string, at: Date): Promise<boolean> {
    const [row] = await this.dataSource.query<Array<{ active: boolean }>>(
      `
        SELECT EXISTS (
          SELECT 1 FROM auth_sessions
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > $3
        ) AS active
      `,
      [sessionId, userId, at],
    );
    return row?.active ?? false;
  }

  public async revokeSessionByTokenHash(
    tokenHash: string,
    revokedAt: Date,
    reason: string,
  ): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE auth_sessions
        SET revoked_at = $2, revoke_reason = $3
        WHERE refresh_token_hash = $1 AND revoked_at IS NULL
      `,
      [tokenHash, revokedAt, reason],
    );
  }

  public async revokeSessionsForUser(
    userId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<void> {
    await this.dataSource.query(
      `
        UPDATE auth_sessions
        SET revoked_at = $2, revoke_reason = $3
        WHERE user_id = $1 AND revoked_at IS NULL
      `,
      [userId, revokedAt, reason],
    );
  }

  public async findThrottle(scope: string, keyHash: string): Promise<ThrottleBucket | null> {
    const [row] = await this.dataSource.query<ThrottleRow[]>(
      `
        SELECT window_started_at, attempt_count, blocked_until
        FROM auth_throttle_buckets
        WHERE scope = $1 AND key_hash = $2
      `,
      [scope, keyHash],
    );
    return row ? this.mapThrottle(row) : null;
  }

  public async recordThrottleFailure(
    scope: string,
    keyHash: string,
    policy: ThrottlePolicy,
    at: Date,
  ): Promise<ThrottleBucket> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `
          INSERT INTO auth_throttle_buckets (scope, key_hash, window_started_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (scope, key_hash) DO NOTHING
        `,
        [scope, keyHash, at],
      );
      const [current] = await manager.query<ThrottleRow[]>(
        `
          SELECT window_started_at, attempt_count, blocked_until
          FROM auth_throttle_buckets
          WHERE scope = $1 AND key_hash = $2
          FOR UPDATE
        `,
        [scope, keyHash],
      );
      if (!current) {
        throw new Error('Throttle bucket could not be loaded');
      }
      const windowExpired = at.getTime() - current.window_started_at.getTime() >= policy.windowMs;
      const nextCount = windowExpired ? 1 : current.attempt_count + 1;
      const windowStartedAt = windowExpired ? at : current.window_started_at;
      const blockedUntil =
        nextCount >= policy.limit ? new Date(at.getTime() + policy.blockMs) : null;
      const [updated] = await manager.query<ThrottleRow[]>(
        `
          UPDATE auth_throttle_buckets
          SET window_started_at = $3,
              attempt_count = $4,
              blocked_until = $5,
              updated_at = $6
          WHERE scope = $1 AND key_hash = $2
          RETURNING window_started_at, attempt_count, blocked_until
        `,
        [scope, keyHash, windowStartedAt, nextCount, blockedUntil, at],
      );
      if (!updated) {
        throw new Error('Throttle bucket update returned no row');
      }
      return this.mapThrottle(updated);
    });
  }

  public async clearThrottle(scope: string, keyHash: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM auth_throttle_buckets WHERE scope = $1 AND key_hash = $2`,
      [scope, keyHash],
    );
  }

  private async findOne(
    predicate: string,
    values: readonly unknown[],
  ): Promise<IdentityUser | null> {
    const [row] = await this.dataSource.query<UserRow[]>(
      `
        SELECT
          u.id,
          u.email,
          u.phone,
          u.password_hash,
          u.display_name,
          u.status,
          COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE ${predicate} AND u.deleted_at IS NULL
        GROUP BY u.id
        LIMIT 1
      `,
      [...values],
    );
    return row ? this.mapUser(row) : null;
  }

  private async grantRoleAndCreateProfile(
    manager: EntityManager,
    userId: string,
    role: Exclude<ActorRole, 'admin'>,
  ): Promise<void> {
    const rows = await manager.query<Array<{ id: number }>>(
      `SELECT id FROM roles WHERE code = $1`,
      [role],
    );
    const roleId = rows[0]?.id;
    if (!roleId) {
      throw new Error(`Required role is not seeded: ${role}`);
    }
    await manager.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [
      userId,
      roleId,
    ]);
    const profileTable = role === 'renter' ? 'renter_profiles' : 'owner_profiles';
    await manager.query(`INSERT INTO ${profileTable} (user_id) VALUES ($1)`, [userId]);
  }

  private async insertSession(manager: EntityManager, session: NewSession): Promise<void> {
    await manager.query(
      `
        INSERT INTO auth_sessions
          (id, family_id, user_id, refresh_token_hash, expires_at, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        session.id,
        session.familyId,
        session.userId,
        session.refreshTokenHash,
        session.expiresAt,
        session.ipAddress,
        session.userAgent,
      ],
    );
  }

  private mapUser(row: UserRow): IdentityUser {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      passwordHash: row.password_hash,
      displayName: row.display_name,
      status: row.status,
      roles: row.roles,
    };
  }

  private mapOtp(row: OtpRow): OtpChallengeRecord {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      purpose: row.purpose,
      codeHash: row.code_hash,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      expiresAt: new Date(row.expires_at),
      consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
      createdAt: new Date(row.created_at),
      verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
    };
  }

  private mapThrottle(row: ThrottleRow): ThrottleBucket {
    return {
      windowStartedAt: new Date(row.window_started_at),
      attemptCount: row.attempt_count,
      blockedUntil: row.blocked_until ? new Date(row.blocked_until) : null,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private updatedExactlyOneRow(result: unknown): boolean {
    if (!Array.isArray(result)) {
      return false;
    }
    if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
      return result[1] === 1 && result[0].length === 1;
    }
    return result.length === 1;
  }
}
