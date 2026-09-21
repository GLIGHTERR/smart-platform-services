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

  it('sends email OTP through Brevo without logging the code', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    const write = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    const adapter = new ConfigurableEmailDeliveryService(
      new ConfigService({
        auth: {
          emailDeliveryMode: 'brevo',
          brevoApiKey: 'xkeysib-test-key',
          brevoSenderEmail: 'no-reply@smartplatform.example',
          brevoSenderName: 'Smart Platform',
        },
        app: { environment: 'production' },
      }),
    );

    await adapter.sendOtp({
      email: 'user@example.com',
      purpose: 'registration',
      code: '123456',
      expiresInSeconds: 600,
    });

    expect(request).toHaveBeenCalledWith(
      'https://api.brevo.com/v3/smtp/email',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'xkeysib-test-key' }),
      }),
    );
    const options = request.mock.calls[0]?.[1];
    expect(JSON.parse(String(options?.body))).toEqual(
      expect.objectContaining({
        sender: { email: 'no-reply@smartplatform.example', name: 'Smart Platform' },
        to: [{ email: 'user@example.com' }],
      }),
    );
    expect(String(options?.body)).toContain('123456');
    expect(write).not.toHaveBeenCalled();
  });

  it('fails closed when Brevo rejects the message', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
    const adapter = new ConfigurableEmailDeliveryService(
      new ConfigService({
        auth: {
          emailDeliveryMode: 'brevo',
          brevoApiKey: 'invalid-key',
          brevoSenderEmail: 'no-reply@smartplatform.example',
          brevoSenderName: 'Smart Platform',
        },
        app: { environment: 'production' },
      }),
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
