import { configuration, validateEnvironment } from './environment';

describe('environment configuration', () => {
  const validEnvironment = {
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:8081',
    DATABASE_HOST: 'localhost',
    DATABASE_NAME: 'smart_platform',
    DATABASE_USER: 'smart_platform',
    DATABASE_PASSWORD: 'local-password',
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
      /CORS_ORIGINS.*DATABASE_HOST.*DATABASE_NAME.*DATABASE_USER.*DATABASE_PASSWORD/,
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
});
