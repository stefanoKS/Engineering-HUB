/**
 * Configuration is validated once, at start-up, and fails closed.
 *
 * There is no fallback to a development identity in production, no default domain allowlist and
 * no implicit CORS origin. A missing requirement stops the process instead of serving a weaker
 * application.
 */
import { z } from 'zod';
import { APP_VERSION } from '@eh/contracts';

const Schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION']).default('DEVELOPMENT'),
    APP_VERSION: z.string().default(APP_VERSION),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DATABASE_URL: z.string().min(1).optional(),
    PGHOST: z.string().optional(),
    PGPORT: z.coerce.number().int().optional(),
    PGUSER: z.string().optional(),
    PGPASSWORD: z.string().optional(),
    PGDATABASE: z.string().optional(),
    PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    PGSSL: z.enum(['true', 'false']).default('false'),
    PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
    GOOGLE_CLIENT_ID: z.string().min(10).optional(),
    MANAGER_WEB_ALLOWED_DOMAINS: z.string().min(1, 'MANAGER_WEB_ALLOWED_DOMAINS is mandatory'),
    SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(720),
    COOKIE_NAME: z.string().default('eh_session'),
    DEV_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
    DEV_AUTH_EMAILS: z.string().default(''),
    TRUST_PROXY: z.enum(['true', 'false']).default('false'),
    TRUSTED_PROXY_HEADER: z.string().default(''),
    RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(100000).default(300),
    BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(5_000_000).default(262_144),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ALLOWED_ORIGINS: z.string().default(''),
    MAIL_FROM_ADDRESS: z.string().optional(),
    SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID: z.string().optional()
  })
  .superRefine((value, ctx) => {
    const production = value.APP_ENV === 'PRODUCTION' || value.NODE_ENV === 'production';
    if (production && value.DEV_AUTH_ENABLED === 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_AUTH_ENABLED'],
        message: 'Development authentication fixtures cannot be enabled in production'
      });
    }
    if (production && !value.GOOGLE_CLIENT_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message: 'GOOGLE_CLIENT_ID is required in production'
      });
    }
    if (production && !value.DATABASE_URL && !value.PGHOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'A database connection is required in production'
      });
    }
    if (value.ALLOWED_ORIGINS.trim() === '*') {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'A wildcard CORS origin is refused'
      });
    }
  });

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  appEnv: 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';
  version: string;
  host: string;
  port: number;
  database: {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    max: number;
    ssl: boolean;
  };
  publicOrigin: string;
  googleClientId: string;
  allowedDomains: string[];
  sessionTtlMinutes: number;
  cookieName: string;
  devAuthEnabled: boolean;
  devAuthEmails: string[];
  trustProxy: boolean;
  trustedProxyHeader: string;
  rateLimitMax: number;
  bodyLimitBytes: number;
  logLevel: string;
  allowedOrigins: string[];
  production: boolean;
  mailConfigured: boolean;
  snapshotDestinationConfigured: boolean;
};

export function parseDomains(value: string): string[] {
  return value
    .split(/[,;\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    appEnv: value.APP_ENV,
    version: value.APP_VERSION,
    host: value.HOST,
    port: value.PORT,
    database: {
      connectionString: value.DATABASE_URL,
      host: value.PGHOST,
      port: value.PGPORT,
      user: value.PGUSER,
      password: value.PGPASSWORD,
      database: value.PGDATABASE,
      max: value.PG_POOL_MAX,
      ssl: value.PGSSL === 'true'
    },
    publicOrigin: value.PUBLIC_ORIGIN,
    googleClientId: value.GOOGLE_CLIENT_ID ?? '',
    allowedDomains: parseDomains(value.MANAGER_WEB_ALLOWED_DOMAINS),
    sessionTtlMinutes: value.SESSION_TTL_MINUTES,
    cookieName: value.COOKIE_NAME,
    devAuthEnabled: value.DEV_AUTH_ENABLED === 'true',
    devAuthEmails: parseDomains(value.DEV_AUTH_EMAILS),
    trustProxy: value.TRUST_PROXY === 'true',
    trustedProxyHeader: value.TRUSTED_PROXY_HEADER,
    rateLimitMax: value.RATE_LIMIT_MAX,
    bodyLimitBytes: value.BODY_LIMIT_BYTES,
    logLevel: value.LOG_LEVEL,
    allowedOrigins: value.ALLOWED_ORIGINS.split(',').map((entry) => entry.trim()).filter(Boolean),
    production: value.APP_ENV === 'PRODUCTION' || value.NODE_ENV === 'production',
    mailConfigured: !!value.MAIL_FROM_ADDRESS,
    snapshotDestinationConfigured: !!value.SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID
  };
}

/** A company address: the domain must be in the deployment allowlist. */
export function domainAllowed(config: AppConfig, email: string): boolean {
  const address = String(email ?? '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at <= 0) return false;
  const domain = address.slice(at + 1);
  return config.allowedDomains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}
