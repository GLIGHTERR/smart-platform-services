import * as Joi from 'joi';

const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'log', 'debug', 'verbose').default('log'),
  CORS_ORIGINS: Joi.string().min(1).required(),
  RENTER_API_PORT: Joi.number().port().default(3001),
  OWNER_API_PORT: Joi.number().port().default(3002),
  ADMIN_API_PORT: Joi.number().port().default(3003),
  DATABASE_HOST: Joi.string().hostname().required(),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_NAME: Joi.string()
    .pattern(/^[a-zA-Z0-9_-]+$/)
    .required(),
  DATABASE_USER: Joi.string().min(1).required(),
  DATABASE_PASSWORD: Joi.string().min(8).required(),
  DATABASE_SSL: Joi.boolean().truthy('true').falsy('false').default(false),
  DATABASE_SSL_REJECT_UNAUTHORIZED: Joi.boolean().truthy('true').falsy('false').default(true),
  DATABASE_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),
  DATABASE_RUN_MIGRATIONS_ON_STARTUP: Joi.boolean().truthy('true').falsy('false').default(false),
  RENDER_GIT_COMMIT: Joi.string().empty('').optional(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().min(3).default('smart-platform-services'),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).max(3600).default(900),
  JWT_REFRESH_TTL_SECONDS: Joi.number().integer().min(3600).max(7776000).default(2592000),
  OTP_HASH_SECRET: Joi.string().min(32).required(),
  OTP_TTL_SECONDS: Joi.number().integer().min(60).max(900).default(600),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(1).max(3600).default(60),
  OTP_REQUEST_LIMIT_PER_HOUR: Joi.number().integer().min(1).max(100).default(5),
  OTP_IP_LIMIT_PER_HOUR: Joi.number().integer().min(1).max(1000).default(20),
  OTP_DEVICE_LIMIT_PER_HOUR: Joi.number().integer().min(1).max(1000).default(20),
  PASSWORD_RECOVERY_EMAIL_LIMIT: Joi.number().integer().min(1).max(100).default(5),
  PASSWORD_RECOVERY_EMAIL_WINDOW_SECONDS: Joi.number().integer().min(60).max(86400).default(900),
  PASSWORD_RECOVERY_IP_LIMIT: Joi.number().integer().min(1).max(1000).default(20),
  PASSWORD_RECOVERY_IP_WINDOW_SECONDS: Joi.number().integer().min(60).max(86400).default(3600),
  PASSWORD_RECOVERY_DEVICE_LIMIT: Joi.number().integer().min(1).max(1000).default(20),
  RESET_TOKEN_TTL_SECONDS: Joi.number().integer().min(60).max(900).default(600),
  LOGIN_FAILURE_LIMIT: Joi.number().integer().min(1).max(20).default(5),
  LOGIN_ABUSE_LIMIT: Joi.number().integer().min(1).max(1000).default(20),
  LOGIN_WINDOW_SECONDS: Joi.number().integer().min(60).max(86400).default(900),
  LOGIN_LOCK_SECONDS: Joi.number().integer().min(60).max(86400).default(900),
  EMAIL_DELIVERY_MODE: Joi.string().valid('disabled', 'console', 'brevo').default('disabled'),
  BREVO_API_KEY: Joi.string()
    .empty('')
    .min(20)
    .when('EMAIL_DELIVERY_MODE', { is: 'brevo', then: Joi.required() }),
  BREVO_SENDER_EMAIL: Joi.string()
    .empty('')
    .email()
    .when('EMAIL_DELIVERY_MODE', { is: 'brevo', then: Joi.required() }),
  BREVO_SENDER_NAME: Joi.string().empty('').min(1).max(160).default('Smart Platform'),
  OTP_DELIVERY_MODE: Joi.string().valid('disabled', 'console').default('disabled'),
  LEGACY_PHONE_FLOWS_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
}).unknown(true);

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const { error, value } = environmentSchema.validate(input, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    const details = error.details.map((detail) => detail.message).join('; ');
    throw new Error(`Environment validation failed: ${details}`);
  }

  return value as Record<string, unknown>;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function configuration(): Record<string, unknown> {
  return {
    app: {
      environment: process.env.NODE_ENV ?? 'development',
      logLevel: process.env.LOG_LEVEL ?? 'log',
      corsOrigins: splitCsv(process.env.CORS_ORIGINS),
      ports: {
        renter: Number(process.env.RENTER_API_PORT ?? 3001),
        owner: Number(process.env.OWNER_API_PORT ?? 3002),
        admin: Number(process.env.ADMIN_API_PORT ?? 3003),
      },
      buildRevision: process.env.RENDER_GIT_COMMIT || undefined,
    },
    database: {
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT ?? 5432),
      name: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: process.env.DATABASE_SSL === 'true',
      sslRejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
      poolSize: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      runMigrationsOnStartup: process.env.DATABASE_RUN_MIGRATIONS_ON_STARTUP === 'true',
    },
    auth: {
      jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
      jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
      jwtIssuer: process.env.JWT_ISSUER ?? 'smart-platform-services',
      accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
      refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS ?? 2592000),
      otpHashSecret: process.env.OTP_HASH_SECRET,
      otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS ?? 600),
      otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
      otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? 60),
      otpRequestLimitPerHour: Number(process.env.OTP_REQUEST_LIMIT_PER_HOUR ?? 5),
      otpIpLimitPerHour: Number(process.env.OTP_IP_LIMIT_PER_HOUR ?? 20),
      otpDeviceLimitPerHour: Number(process.env.OTP_DEVICE_LIMIT_PER_HOUR ?? 20),
      passwordRecoveryEmailLimit: Number(process.env.PASSWORD_RECOVERY_EMAIL_LIMIT ?? 5),
      passwordRecoveryEmailWindowSeconds: Number(
        process.env.PASSWORD_RECOVERY_EMAIL_WINDOW_SECONDS ?? 900,
      ),
      passwordRecoveryIpLimit: Number(process.env.PASSWORD_RECOVERY_IP_LIMIT ?? 20),
      passwordRecoveryIpWindowSeconds: Number(
        process.env.PASSWORD_RECOVERY_IP_WINDOW_SECONDS ?? 3600,
      ),
      passwordRecoveryDeviceLimit: Number(process.env.PASSWORD_RECOVERY_DEVICE_LIMIT ?? 20),
      resetTokenTtlSeconds: Number(process.env.RESET_TOKEN_TTL_SECONDS ?? 600),
      loginFailureLimit: Number(process.env.LOGIN_FAILURE_LIMIT ?? 5),
      loginAbuseLimit: Number(process.env.LOGIN_ABUSE_LIMIT ?? 20),
      loginWindowSeconds: Number(process.env.LOGIN_WINDOW_SECONDS ?? 900),
      loginLockSeconds: Number(process.env.LOGIN_LOCK_SECONDS ?? 900),
      emailDeliveryMode: process.env.EMAIL_DELIVERY_MODE ?? 'disabled',
      brevoApiKey: process.env.BREVO_API_KEY,
      brevoSenderEmail: process.env.BREVO_SENDER_EMAIL,
      brevoSenderName: process.env.BREVO_SENDER_NAME ?? 'Smart Platform',
      otpDeliveryMode: process.env.OTP_DELIVERY_MODE ?? 'disabled',
      legacyPhoneFlowsEnabled: process.env.LEGACY_PHONE_FLOWS_ENABLED === 'true',
    },
  };
}
