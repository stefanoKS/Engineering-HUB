/**
 * PostgreSQL connection and per-request query context.
 *
 * The pool opens one connection per worker; every connection pins the business time zone so a
 * `now()` default cannot be read as UTC by a session started elsewhere. Query counting is
 * per request, which is what the API reports as `dbCalls` - never a global counter.
 */
import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';

// Keep calendar dates as `YYYY-MM-DD` and instants as ISO strings: a DATE must never become a
// local-midnight Date object, which would shift a deadline by one day on another host.
pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(1700, (value: string) => (value === null ? null : Number(value)));
pg.types.setTypeParser(1114, (value: string) => new Date(`${value}Z`).toISOString());
pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());

export type DbConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  max?: number;
  applicationName?: string;
  ssl?: boolean;
};

export function createPool(config: DbConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: config.max ?? 10,
    application_name: config.applicationName ?? 'engineering-hub',
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    statement_timeout: 15_000,
    idle_in_transaction_session_timeout: 10_000,
    connectionTimeoutMillis: 5_000
  });
  pool.on('connect', (client) => {
    void client.query("SET TIME ZONE 'Asia/Tokyo'");
  });
  pool.on('error', (error) => {
    process.stderr.write(`pg pool error: ${error.message}\n`);
  });
  return pool;
}

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
  one<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T | null>;
  many<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<T[]>;
}

export type DbCallCounter = { calls: number };

/** One request's database context: a pool handle, a call counter and transaction support. */
export class Database {
  readonly pool: pg.Pool;
  readonly counter: DbCallCounter;

  constructor(pool: pg.Pool, counter: DbCallCounter = { calls: 0 }) {
    this.pool = pool;
    this.counter = counter;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.counter.calls += 1;
    return this.pool.query<T>(text, params);
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async many<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  /** One logical operation is one transaction, including its audit and outbox rows. */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    this.counter.calls += 1;
    const tx = new Transaction(client, this.counter);
    try {
      await client.query('BEGIN');
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original failure is what the caller must see.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class Transaction implements Queryable {
  readonly client: PoolClient;
  readonly counter: DbCallCounter;

  constructor(client: PoolClient, counter: DbCallCounter) {
    this.client = client;
    this.counter = counter;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    this.counter.calls += 1;
    return this.client.query<T>(text, params);
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async many<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  /**
   * Targeted lock for a cross-record invariant (a hierarchy reparent). Scoped to one aggregate
   * key so unrelated writes never queue behind each other.
   */
  async advisoryLock(key: string): Promise<void> {
    await this.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  }
}

export function toDatabaseConfig(env: NodeJS.ProcessEnv): DbConfig {
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL, max: Number(env.PG_POOL_MAX ?? 10) };
  return {
    host: env.PGHOST ?? '127.0.0.1',
    port: Number(env.PGPORT ?? 5432),
    user: env.PGUSER ?? 'ehub',
    password: env.PGPASSWORD ?? '',
    database: env.PGDATABASE ?? 'engineering_hub',
    max: Number(env.PG_POOL_MAX ?? 10),
    ssl: env.PGSSL === 'true'
  };
}
