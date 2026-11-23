import { Pool, type PoolConfig } from 'pg';
import type { AppConfig } from '../config.js';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  readonly driver: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('subscription', 'manual')),
    url_enc TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    user_agent TEXT,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    node_count INTEGER NOT NULL DEFAULT 0,
    filtered_count INTEGER NOT NULL DEFAULT 0,
    upload_bytes BIGINT,
    download_bytes BIGINT,
    total_bytes BIGINT,
    expire_at BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    fingerprint TEXT NOT NULL,
    original_name TEXT NOT NULL,
    custom_name TEXT,
    protocol TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    config_enc TEXT NOT NULL,
    detected_region TEXT NOT NULL DEFAULT 'OTHER',
    region_override TEXT,
    multiplier DOUBLE PRECISION,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    latency_ms INTEGER,
    latency_tested_at TIMESTAMPTZ,
    latency_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_id, fingerprint)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_source_id ON nodes (source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_fingerprint ON nodes (fingerprint)`,
  `CREATE TABLE IF NOT EXISTS routing_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    preset TEXT NOT NULL DEFAULT 'standard',
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS export_channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    mode TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_enc TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    include_regions JSONB NOT NULL DEFAULT '[]'::jsonb,
    exclude_blocked BOOLEAN NOT NULL DEFAULT TRUE,
    custom_filename TEXT,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_accessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_export_channels_token_hash ON export_channels (token_hash)`,
];

class PgPoolClient implements DbClient {
  readonly driver = 'postgres' as const;
  private readonly pool: Pool;

  constructor(connectionString: string, sslMode: AppConfig['databaseSsl']) {
    const poolConfig: PoolConfig = {
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
    if (sslMode === 'require') {
      poolConfig.ssl = { rejectUnauthorized: true };
    } else if (sslMode === 'no-verify') {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
    this.pool = new Pool(poolConfig);
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const txClient: DbClient = {
      driver: 'postgres',
      query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
        const result = await client.query(sql, params);
        return {
          rows: result.rows as R[],
          rowCount: result.rowCount ?? result.rows.length,
        };
      },
      transaction: async <R>(nested: (inner: DbClient) => Promise<R>) => nested(txClient),
      ping: async () => {
        await client.query('SELECT 1');
        return true;
      },
      close: async () => undefined,
    };

    try {
      await client.query('BEGIN');
      const output = await fn(txClient);
      await client.query('COMMIT');
      return output;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

interface PGliteLike {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; affectedRows?: number }>;
  transaction<T>(callback: (tx: PGliteLike) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PGliteDbClient implements DbClient {
  readonly driver = 'pglite' as const;
  private readonly db: PGliteLike;
  private closed = false;

  constructor(db: PGliteLike) {
    this.db = db;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  }

  async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    return this.db.transaction(async (rawTx) => {
      const txClient: DbClient = {
        driver: 'pglite',
        query: async <R = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
          const res = await rawTx.query<R>(sql, params);
          return { rows: res.rows, rowCount: res.affectedRows ?? res.rows.length };
        },
        transaction: async <R>(nested: (inner: DbClient) => Promise<R>) => nested(txClient),
        ping: async () => {
          await rawTx.query('SELECT 1');
          return true;
        },
        close: async () => undefined,
      };
      return fn(txClient);
    });
  }

  async ping(): Promise<boolean> {
    await this.db.query('SELECT 1');
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.db.close();
  }
}

export async function createDbClient(config: Pick<AppConfig, 'databaseUrl' | 'databaseSsl'>): Promise<DbClient> {
  const url = config.databaseUrl.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (e.g. postgresql://tower:password@postgres:5432/tower). For local dev/testing without a Postgres daemon, set DATABASE_URL=pglite://memory.',
    );
  }

  let client: DbClient;
  if (url.startsWith('pglite://')) {
    const target = url.slice('pglite://'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    const instance =
      !target || target === 'memory'
        ? new PGlite()
        : new PGlite(target);
    client = new PGliteDbClient(instance as unknown as PGliteLike);
  } else if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    client = new PgPoolClient(url, config.databaseSsl);
  } else {
    throw new Error('DATABASE_URL must start with postgresql://, postgres://, or pglite://');
  }

  for (const statement of SCHEMA_STATEMENTS) {
    await client.query(statement);
  }

  return client;
}
