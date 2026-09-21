import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConfigurableEmailDeliveryService,
  ConfigurableOtpDeliveryService,
} from './otp-delivery.port';

describe('OTP delivery adapters', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes email OTP only in local console mode', async () => {
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const adapter = new ConfigurableEmailDeliveryService(
      new ConfigService({
        auth: { emailDeliveryMode: 'console' },
        app: { environment: 'development' },
      }),
    );

    await adapter.sendOtp({
      email: 'user@example.com',
      purpose: 'registration',
      code: '123456',
      expiresInSeconds: 600,
    });

    expect(write).toHaveBeenCalledWith(expect.stringContaining('local_development_email_otp'));
  });

  it.each([
    ['disabled', 'development'],
    ['console', 'production'],
  ])('fails email delivery closed in %s/%s mode', async (mode, environment) => {
    const adapter = new ConfigurableEmailDeliveryService(
      new ConfigService({ auth: { emailDeliveryMode: mode }, app: { environment } }),
    );

    await expect(
      adapter.sendOtp({
        email: 'user@example.com',
        purpose: 'registration',
        code: '123456',
        expiresInSeconds: 600,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires both the legacy gate and local console mode for phone delivery', async () => {
    const disabled = new ConfigurableOtpDeliveryService(
      new ConfigService({
        auth: { legacyPhoneFlowsEnabled: false, otpDeliveryMode: 'console' },
        app: { environment: 'development' },
      }),
    );
    await expect(
      disabled.send({
        phone: '+84901234567',
        purpose: 'login',
        code: '123456',
        expiresInSeconds: 600,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const enabled = new ConfigurableOtpDeliveryService(
      new ConfigService({
        auth: { legacyPhoneFlowsEnabled: true, otpDeliveryMode: 'console' },
        app: { environment: 'development' },
      }),
    );
    await enabled.send({
      phone: '+84901234567',
      purpose: 'login',
      code: '123456',
      expiresInSeconds: 600,
    });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('legacy_local_development_otp'));
  });
});
