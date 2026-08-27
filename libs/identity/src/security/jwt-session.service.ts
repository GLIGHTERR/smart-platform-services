import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  IdentityRepository,
  type IdentityUser,
  type NewSession,
} from '../persistence/identity.repository';
import type { AuthenticatedActor, AuthSessionTokens } from '../public/identity.contracts';

interface JwtHeader {
  alg: 'HS256';
  typ: 'JWT';
}

interface AccessClaims {
  iss: string;
  aud: 'smart-platform-api';
  sub: string;
  sid: string;
  typ: 'access';
  iat: number;
  exp: number;
  jti: string;
}

interface RefreshClaims {
  iss: string;
  aud: 'smart-platform-auth';
  sub: string;
  sid: string;
  fid: string;
  typ: 'refresh';
  iat: number;
  exp: number;
  jti: string;
}

export interface SessionClientContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class JwtSessionService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly issuer: string;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  public constructor(
    config: ConfigService,
    private readonly repository: IdentityRepository,
  ) {
    this.accessSecret = config.getOrThrow<string>('auth.jwtAccessSecret');
    this.refreshSecret = config.getOrThrow<string>('auth.jwtRefreshSecret');
    this.issuer = config.getOrThrow<string>('auth.jwtIssuer');
    this.accessTtlSeconds = config.getOrThrow<number>('auth.accessTtlSeconds');
    this.refreshTtlSeconds = config.getOrThrow<number>('auth.refreshTtlSeconds');
  }

  public async create(
    user: IdentityUser,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    const now = new Date();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const refreshToken = this.signRefresh(user.id, sessionId, familyId, now);
    await this.repository.createSession(
      this.newSession(user.id, sessionId, familyId, refreshToken, context, now),
    );
    return this.tokenPair(user.id, sessionId, refreshToken, now);
  }

  public async refresh(
    refreshToken: string,
    context: SessionClientContext,
  ): Promise<AuthSessionTokens> {
    const claims = this.verifyRefresh(refreshToken);
    const now = new Date();
    const replacementId = randomUUID();
    const replacementToken = this.signRefresh(claims.sub, replacementId, claims.fid, now);
    const result = await this.repository.rotateSession({
      currentSessionId: claims.sid,
      currentFamilyId: claims.fid,
      currentTokenHash: this.hashToken(refreshToken),
      replacement: this.newSession(
        claims.sub,
        replacementId,
        claims.fid,
        replacementToken,
        context,
        now,
      ),
      usedAt: now,
    });
    if (result !== 'rotated') {
      throw this.invalidSession();
    }
    const user = await this.repository.findById(claims.sub);
    if (!user || user.status !== 'active') {
      await this.repository.revokeSessionsForUser(claims.sub, now, 'account_inactive');
      throw this.invalidSession();
    }
    return this.tokenPair(user.id, replacementId, replacementToken, now);
  }

  public async logout(refreshToken: string): Promise<void> {
    await this.repository.revokeSessionByTokenHash(
      this.hashToken(refreshToken),
      new Date(),
      'logout',
    );
  }

  public async authenticateAccess(accessToken: string): Promise<AuthenticatedActor> {
    const claims = this.verifyAccess(accessToken);
    const now = new Date();
    const [activeSession, user] = await Promise.all([
      this.repository.isSessionActive(claims.sid, claims.sub, now),
      this.repository.findById(claims.sub),
    ]);
    if (!activeSession || !user || user.status !== 'active') {
      throw this.invalidSession();
    }
    return { id: user.id, roles: user.roles, status: user.status, sessionId: claims.sid };
  }

  private tokenPair(
    userId: string,
    sessionId: string,
    refreshToken: string,
    issuedAt: Date,
  ): AuthSessionTokens {
    return {
      accessToken: this.signAccess(userId, sessionId, issuedAt),
      refreshToken,
      tokenType: 'Bearer',
      accessExpiresInSeconds: this.accessTtlSeconds,
      refreshExpiresInSeconds: this.refreshTtlSeconds,
    };
  }

  private newSession(
    userId: string,
    sessionId: string,
    familyId: string,
    refreshToken: string,
    context: SessionClientContext,
    issuedAt: Date,
  ): NewSession {
    return {
      id: sessionId,
      familyId,
      userId,
      refreshTokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(issuedAt.getTime() + this.refreshTtlSeconds * 1000),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
    };
  }

  private signAccess(userId: string, sessionId: string, issuedAt: Date): string {
    const now = Math.floor(issuedAt.getTime() / 1000);
    return this.sign(
      {
        iss: this.issuer,
        aud: 'smart-platform-api',
        sub: userId,
        sid: sessionId,
        typ: 'access',
        iat: now,
        exp: now + this.accessTtlSeconds,
        jti: randomUUID(),
      } satisfies AccessClaims,
      this.accessSecret,
    );
  }

  private signRefresh(userId: string, sessionId: string, familyId: string, issuedAt: Date): string {
    const now = Math.floor(issuedAt.getTime() / 1000);
    return this.sign(
      {
        iss: this.issuer,
        aud: 'smart-platform-auth',
        sub: userId,
        sid: sessionId,
        fid: familyId,
        typ: 'refresh',
        iat: now,
        exp: now + this.refreshTtlSeconds,
        jti: randomUUID(),
      } satisfies RefreshClaims,
      this.refreshSecret,
    );
  }

  private sign(payload: AccessClaims | RefreshClaims, secret: string): string {
    const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
    const unsigned = `${this.encode(header)}.${this.encode(payload)}`;
    const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${signature}`;
  }

  private verifyAccess(token: string): AccessClaims {
    const claims = this.verify(token, this.accessSecret) as Partial<AccessClaims>;
    if (
      claims.typ !== 'access' ||
      claims.aud !== 'smart-platform-api' ||
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string'
    ) {
      throw this.invalidSession();
    }
    return claims as AccessClaims;
  }

  private verifyRefresh(token: string): RefreshClaims {
    const claims = this.verify(token, this.refreshSecret) as Partial<RefreshClaims>;
    if (
      claims.typ !== 'refresh' ||
      claims.aud !== 'smart-platform-auth' ||
      typeof claims.sub !== 'string' ||
      typeof claims.sid !== 'string' ||
      typeof claims.fid !== 'string'
    ) {
      throw this.invalidSession();
    }
    return claims as RefreshClaims;
  }

  private verify(token: string, secret: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw this.invalidSession();
    }
    const [headerPart, payloadPart, signaturePart] = parts;
    if (!headerPart || !payloadPart || !signaturePart) {
      throw this.invalidSession();
    }
    const unsigned = `${headerPart}.${payloadPart}`;
    const expected = createHmac('sha256', secret).update(unsigned).digest();
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw this.invalidSession();
    }
    try {
      const header = JSON.parse(
        Buffer.from(headerPart, 'base64url').toString('utf8'),
      ) as Partial<JwtHeader>;
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      const now = Math.floor(Date.now() / 1000);
      if (
        header.alg !== 'HS256' ||
        header.typ !== 'JWT' ||
        payload.iss !== this.issuer ||
        typeof payload.exp !== 'number' ||
        payload.exp <= now ||
        typeof payload.iat !== 'number' ||
        payload.iat > now + 30
      ) {
        throw this.invalidSession();
      }
      return payload;
    } catch {
      throw this.invalidSession();
    }
  }

  private encode(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private invalidSession(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_SESSION',
      message: 'Session is invalid or expired',
    });
  }
}
