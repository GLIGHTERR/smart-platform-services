import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { IdentityRepository, type ThrottlePolicy } from '../persistence/identity.repository';

export interface ThrottleKey {
  scope: string;
  value: string;
  policy: ThrottlePolicy;
}

@Injectable()
export class RateLimiterService {
  private readonly keySecret: string;

  public constructor(
    private readonly repository: IdentityRepository,
    config: ConfigService,
  ) {
    this.keySecret = config.getOrThrow<string>('auth.otpHashSecret');
  }

  public async assertAllowed(keys: readonly ThrottleKey[], at: Date): Promise<void> {
    const buckets = await Promise.all(
      keys.map(async (key) => ({
        key,
        bucket: await this.repository.findThrottle(key.scope, this.hash(key.scope, key.value)),
      })),
    );
    const blocked = buckets
      .map(({ bucket }) => bucket?.blockedUntil)
      .filter((until): until is Date => Boolean(until && until > at))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    if (blocked) {
      throw new HttpException(
        {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many attempts. Try again later.',
          details: {
            retryAfterSeconds: Math.max(1, Math.ceil((blocked.getTime() - at.getTime()) / 1000)),
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  public async recordFailure(keys: readonly ThrottleKey[], at: Date): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        this.repository.recordThrottleFailure(
          key.scope,
          this.hash(key.scope, key.value),
          key.policy,
          at,
        ),
      ),
    );
  }

  public async clear(keys: readonly ThrottleKey[]): Promise<void> {
    await Promise.all(
      keys.map((key) => this.repository.clearThrottle(key.scope, this.hash(key.scope, key.value))),
    );
  }

  private hash(scope: string, value: string): string {
    return createHmac('sha256', this.keySecret).update(`${scope}:${value}`).digest('hex');
  }
}
