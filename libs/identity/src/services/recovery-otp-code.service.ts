import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

@Injectable()
export class RecoveryOtpCodeService {
  private readonly secret: string;

  public constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('auth.otpHashSecret');
  }

  // A deterministic code lets a retried worker deliver the original challenge without storing it.
  public forChallenge(challengeId: string): string {
    const bytes = createHmac('sha256', this.secret)
      .update(`password_reset:${challengeId}`)
      .digest();
    return (100_000 + (bytes.readUInt32BE(0) % 900_000)).toString();
  }
}
