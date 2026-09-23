import { configuration, validateEnvironment } from './environment';

describe('environment configuration', () => {
  const validEnvironment = {
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:8081',
    DATABASE_HOST: 'localhost',
    DATABASE_NAME: 'smart_platform',
    DATABASE_USER: 'smart_platform',
    DATABASE_PASSWORD: 'local-password',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
    OTP_HASH_SECRET: 'test-otp-secret-at-least-32-characters',
  };

  it('validates and converts the environment', () => {
    const result = validateEnvironment({
      ...validEnvironment,
      RENTER_API_PORT: '3101',
      DATABASE_SSL: 'true',
    });

    expect(result.RENTER_API_PORT).toBe(3101);
    expect(result.DATABASE_SSL).toBe(true);
    expect(result.DATABASE_POOL_SIZE).toBe(10);
  });

  it('reports all missing required values', () => {
    expect(() => validateEnvironment({})).toThrow(
      /CORS_ORIGINS.*DATABASE_HOST.*DATABASE_NAME.*DATABASE_USER.*DATABASE_PASSWORD.*JWT_ACCESS_SECRET.*JWT_REFRESH_SECRET.*OTP_HASH_SECRET/,
    );
  });

  it('rejects invalid ports and short passwords', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        DATABASE_PASSWORD: 'short',
        DATABASE_PORT: 70000,
      }),
    ).toThrow(/DATABASE_PORT.*DATABASE_PASSWORD/);
  });

  it('requires Brevo credentials when Brevo delivery is enabled', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        EMAIL_DELIVERY_MODE: 'brevo',
      }),
    ).toThrow(/BREVO_API_KEY.*BREVO_SENDER_EMAIL/);

    const result = validateEnvironment({
      ...validEnvironment,
      EMAIL_DELIVERY_MODE: 'brevo',
      BREVO_API_KEY: 'xkeysib-test-key-at-least-twenty-characters',
      BREVO_SENDER_EMAIL: 'no-reply@example.com',
    });

    expect(result.BREVO_SENDER_NAME).toBe('Smart Platform');
  });

  it('normalizes CORS origins in the loaded configuration', () => {
    const original = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = ' https://renter.example.com, https://owner.example.com ';

    try {
      const result = configuration() as {
        app: { corsOrigins: string[] };
      };
      expect(result.app.corsOrigins).toEqual([
        'https://renter.example.com',
        'https://owner.example.com',
      ]);
    } finally {
      if (original === undefined) {
        delete process.env.CORS_ORIGINS;
      } else {
        process.env.CORS_ORIGINS = original;
      }
    }
  });

  it('loads explicit UC-03 recovery policy overrides', () => {
    const overrides = {
      PASSWORD_RECOVERY_EMAIL_LIMIT: '7',
      PASSWORD_RECOVERY_EMAIL_WINDOW_SECONDS: '1200',
      PASSWORD_RECOVERY_IP_LIMIT: '30',
      PASSWORD_RECOVERY_IP_WINDOW_SECONDS: '7200',
      PASSWORD_RECOVERY_DEVICE_LIMIT: '25',
      RESET_TOKEN_TTL_SECONDS: '480',
    };
    const original = Object.fromEntries(
      Object.keys(overrides).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, overrides);

    try {
      const result = configuration() as {
        auth: {
          passwordRecoveryEmailLimit: number;
          passwordRecoveryEmailWindowSeconds: number;
          passwordRecoveryIpLimit: number;
          passwordRecoveryIpWindowSeconds: number;
          passwordRecoveryDeviceLimit: number;
          resetTokenTtlSeconds: number;
        };
      };
      expect(result.auth).toEqual(
        expect.objectContaining({
          passwordRecoveryEmailLimit: 7,
          passwordRecoveryEmailWindowSeconds: 1200,
          passwordRecoveryIpLimit: 30,
          passwordRecoveryIpWindowSeconds: 7200,
          passwordRecoveryDeviceLimit: 25,
          resetTokenTtlSeconds: 480,
        }),
      );
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
