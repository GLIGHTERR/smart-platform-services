import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpPurpose } from '../persistence/identity.repository';

export interface OtpDeliveryMessage {
  phone: string;
  purpose: OtpPurpose;
  code: string;
  expiresInSeconds: number;
}

export abstract class OtpDeliveryPort {
  public abstract send(message: OtpDeliveryMessage): Promise<void>;
}

@Injectable()
export class ConfigurableOtpDeliveryService extends OtpDeliveryPort {
  public constructor(private readonly config: ConfigService) {
    super();
  }

  public async send(message: OtpDeliveryMessage): Promise<void> {
    const mode = this.config.getOrThrow<string>('auth.otpDeliveryMode');
    if (mode !== 'console' || this.config.get<string>('app.environment') === 'production') {
      throw new ServiceUnavailableException({
        code: 'OTP_PROVIDER_UNAVAILABLE',
        message: 'OTP delivery provider is not configured',
      });
    }
    process.stdout.write(
      `${JSON.stringify({
        level: 'warn',
        context: 'LocalOtpDelivery',
        message: 'local_development_otp',
        phone: message.phone,
        purpose: message.purpose,
        code: message.code,
        expiresInSeconds: message.expiresInSeconds,
      })}\n`,
    );
  }
}
