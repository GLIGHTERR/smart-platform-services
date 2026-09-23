import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpPurpose } from '../persistence/identity.repository';

export interface EmailOtpMessage {
  email: string;
  purpose: Extract<OtpPurpose, 'registration' | 'password_reset'>;
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
  private static readonly brevoEndpoint = 'https://api.brevo.com/v3/smtp/email';

  public constructor(private readonly config: ConfigService) {
    super();
  }

  public assertAvailable(): Promise<void> {
    const mode = this.config.getOrThrow<string>('auth.emailDeliveryMode');
    if (mode === 'brevo') {
      this.config.getOrThrow<string>('auth.brevoApiKey');
      this.config.getOrThrow<string>('auth.brevoSenderEmail');
      this.config.getOrThrow<string>('auth.brevoSenderName');
      return Promise.resolve();
    }
    if (mode === 'console' && this.config.get<string>('app.environment') !== 'production') {
      return Promise.resolve();
    }
    throw this.unavailable();
  }

  public async sendOtp(message: EmailOtpMessage): Promise<void> {
    await this.assertAvailable();
    if (this.config.getOrThrow<string>('auth.emailDeliveryMode') === 'brevo') {
      await this.sendWithBrevo(message);
      return;
    }
    const localEvent: Record<string, unknown> = {
      level: 'warn',
      context: 'LocalEmailDelivery',
      message: 'local_development_email_otp',
      email: message.email,
      purpose: message.purpose,
      expiresInSeconds: message.expiresInSeconds,
    };
    if (message.purpose === 'registration') {
      localEvent.code = message.code;
    }
    process.stdout.write(`${JSON.stringify(localEvent)}\n`);
  }

  private async sendWithBrevo(message: EmailOtpMessage): Promise<void> {
    try {
      const response = await fetch(ConfigurableEmailDeliveryService.brevoEndpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': this.config.getOrThrow<string>('auth.brevoApiKey'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            email: this.config.getOrThrow<string>('auth.brevoSenderEmail'),
            name: this.config.getOrThrow<string>('auth.brevoSenderName'),
          },
          to: [{ email: message.email }],
          subject:
            message.purpose === 'password_reset'
              ? 'Mã xác thực khôi phục mật khẩu Smart Platform'
              : 'Mã xác thực đăng ký Smart Platform',
          textContent: `Mã OTP của bạn là ${message.code}. Mã có hiệu lực trong ${Math.ceil(message.expiresInSeconds / 60)} phút.`,
          htmlContent: `<p>Mã OTP của bạn là:</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${message.code}</p><p>Mã có hiệu lực trong ${Math.ceil(message.expiresInSeconds / 60)} phút.</p><p>Nếu bạn không yêu cầu mã này, hãy bỏ qua email.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw this.unavailable();
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw this.unavailable();
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: 'OTP_PROVIDER_UNAVAILABLE',
      message: 'OTP delivery provider is not configured or temporarily unavailable',
    });
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
