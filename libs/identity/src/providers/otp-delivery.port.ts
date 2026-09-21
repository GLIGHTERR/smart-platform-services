import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpPurpose } from '../persistence/identity.repository';

export interface EmailOtpMessage {
  email: string;
  purpose: Extract<OtpPurpose, 'registration'>;
  code: string;
  expiresInSeconds: number;
}

export abstract class EmailDeliveryPort {
  public abstract assertAvailable(): Promise<void>;
  public abstract sendOtp(message: EmailOtpMessage): Promise<void>;
}

export interface LegacyPhoneOtpMessage {
  phone: string;
  purpose: OtpPurpose;
  code: string;
  expiresInSeconds: number;
}

export abstract class OtpDeliveryPort {
  public abstract send(message: LegacyPhoneOtpMessage): Promise<void>;
}

@Injectable()
export class ConfigurableEmailDeliveryService extends EmailDeliveryPort {
  public constructor(private readonly config: ConfigService) {
    super();
  }

  public assertAvailable(): Promise<void> {
    const mode = this.config.getOrThrow<string>('auth.emailDeliveryMode');
    if (mode !== 'console' || this.config.get<string>('app.environment') === 'production') {
      throw new ServiceUnavailableException({
        code: 'OTP_PROVIDER_UNAVAILABLE',
        message: 'OTP delivery provider is not configured',
      });
    }
    return Promise.resolve();
  }

  public async sendOtp(message: EmailOtpMessage): Promise<void> {
    await this.assertAvailable();
    process.stdout.write(
      `${JSON.stringify({
        level: 'warn',
        context: 'LocalEmailDelivery',
        message: 'local_development_email_otp',
        email: message.email,
        purpose: message.purpose,
        code: message.code,
        expiresInSeconds: message.expiresInSeconds,
      })}\n`,
    );
  }
}

@Injectable()
export class ConfigurableOtpDeliveryService extends OtpDeliveryPort {
  public constructor(private readonly config: ConfigService) {
    super();
  }

  public async send(message: LegacyPhoneOtpMessage): Promise<void> {
    const enabled = this.config.getOrThrow<boolean>('auth.legacyPhoneFlowsEnabled');
    const mode = this.config.getOrThrow<string>('auth.otpDeliveryMode');
    if (
      !enabled ||
      mode !== 'console' ||
      this.config.get<string>('app.environment') === 'production'
    ) {
      throw new ServiceUnavailableException({
        code: 'LEGACY_PHONE_AUTH_DISABLED',
        message: 'Legacy phone authentication is disabled',
      });
    }
    process.stdout.write(
      `${JSON.stringify({
        level: 'warn',
        context: 'LegacyLocalOtpDelivery',
        message: 'legacy_local_development_otp',
        phone: message.phone,
        purpose: message.purpose,
        code: message.code,
        expiresInSeconds: message.expiresInSeconds,
      })}\n`,
    );
  }
}
