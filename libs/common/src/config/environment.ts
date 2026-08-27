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
    },
  };
}
