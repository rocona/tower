export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  databaseSsl: 'disable' | 'require' | 'no-verify';
  adminPassword: string | null;
  encryptionKey: string | null;
  sessionSecret: string | null;
  allowPrivateFetch: boolean;
  publicBaseUrl: string | null;
  trustProxy: boolean;
  nodeEnv: string;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return /^(?:1|true|yes|on)$/i.test(value.trim());
}

function parseSslMode(value: string | undefined): 'disable' | 'require' | 'no-verify' {
  const normalized = (value ?? 'disable').trim().toLowerCase();
  if (normalized === 'require') return 'require';
  if (normalized === 'no-verify' || normalized === 'allow' || normalized === 'prefer') {
    return 'no-verify';
  }
  return 'disable';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portRaw = Number(env.PORT ?? '8080');
  const port = Number.isInteger(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : 8080;
  const host = (env.HOST ?? '0.0.0.0').trim() || '0.0.0.0';
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  const adminPassword = env.ADMIN_PASSWORD?.trim() ? env.ADMIN_PASSWORD.trim() : null;
  const encryptionKey = env.ENCRYPTION_KEY?.trim() ? env.ENCRYPTION_KEY.trim() : null;
  const sessionSecret = env.SESSION_SECRET?.trim() ? env.SESSION_SECRET.trim() : null;
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim()
    ? env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '')
    : null;

  return {
    port,
    host,
    databaseUrl,
    databaseSsl: parseSslMode(env.DATABASE_SSL),
    adminPassword,
    encryptionKey,
    sessionSecret,
    allowPrivateFetch: parseBool(env.ALLOW_PRIVATE_FETCH, false),
    publicBaseUrl,
    trustProxy: parseBool(env.TRUST_PROXY, true),
    nodeEnv: (env.NODE_ENV ?? 'development').trim(),
  };
}
