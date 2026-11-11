/**
 * Sign-in regression coverage, against real PostgreSQL.
 *
 * These cases exist because the running installation showed "サインイン設定を読み込めませんでした"
 * while `/api/public-config` worked without a cookie: the shared request hook resolved a division
 * scope - which needs the schema-12 tables - for an endpoint that needs no session and no division
 * at all. A database that still needs its reviewed migration must produce one clear readiness
 * failure instead of a broken sign-in screen, and the sign-in configuration must never depend on a
 * stale cookie, a session or a division membership.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { Database } from '@eh/db';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { NullInboxSource } from '../src/inbox';
import { hashPassword } from '../src/auth/password';
import { freshDatabase } from '../../../packages/db/test/support/db';

const password = 'Sign-in-test-password-123';
const COOKIE = 'eh_session';

let app: FastifyInstance;
let db: Database;
let pool: pg.Pool;
let hash: string;

beforeAll(async () => {
  hash = await hashPassword(password);
});

beforeEach(async () => {
  const context = await freshDatabase();
  db = context.db;
  pool = context.pool;
  await db.query(`
    INSERT INTO members(member_id,name,role,active) VALUES
      ('MEM-LOCAL','Local User','MANAGER',true),
      ('MEM-NOGRANT','No division','MEMBER',true)
  `);
  await db.query(
    `INSERT INTO local_accounts(member_id,employee_id,password_hash,must_change_password) VALUES
       ('MEM-LOCAL','1001',$1,false),('MEM-NOGRANT','1002',$1,false)`,
    [hash]
  );
  // The account with no division access: the sign-in configuration must still load for it.
  await db.query("DELETE FROM member_divisions WHERE member_id = 'MEM-NOGRANT'");
  app = await buildApp({
    db,
    inbox: new NullInboxSource(),
    logger: false,
    config: loadConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'local',
      PUBLIC_ORIGIN: 'http://localhost:8050'
    })
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await pool.end();
});

async function signIn(employeeId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { employeeId, password }
  });
  expect(response.statusCode, response.body).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
}

describe('public sign-in configuration', () => {
  it('answers without a session and exposes only the allowlisted fields', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/public-config' });
    expect(response.statusCode, response.body).toBe(200);
    expect(Object.keys(response.json().data as Record<string, unknown>).sort()).toEqual([
      'appVersion',
      'authConfigured',
      'authMode',
      'devSignInEnabled',
      'environment',
      'googleClientId'
    ]);
    expect(response.json().data.authMode).toBe('local');
    expect(response.json().data.googleClientId).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('still answers with a stale or unknown session cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/public-config',
      headers: { cookie: `${COOKIE}=not-a-real-session-token` }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.authMode).toBe('local');
  });

  it('does not require a division membership for an authenticated reader', async () => {
    const cookie = await signIn('1002');
    const response = await app.inject({
      method: 'GET',
      url: '/api/public-config',
      headers: { cookie }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.authMode).toBe('local');
    // The same account resolves an empty, fail-closed division scope.
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(session.statusCode, session.body).toBe(200);
    expect(session.json().data.divisions.readable).toEqual([]);
    expect(session.json().data.divisions.writable).toEqual([]);
  });

  it('signs in with a stale cookie present and keeps the intended mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { cookie: `${COOKIE}=stale-token`, origin: 'http://localhost:8050' },
      payload: { employeeId: '1001', password }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.authMode).toBe('local');
    expect(response.json().data.actor.role).toBe('MANAGER');
    expect(String(response.headers['set-cookie'])).toContain(COOKIE);
  });

  it('refuses a foreign origin on the sign-in mutation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { origin: 'http://evil.example' },
      payload: { employeeId: '1001', password }
    });
    expect(response.statusCode).toBe(403);
  });

  it('reports a schema that is behind this build as one readiness failure, not a sign-in error', async () => {
    const cookie = await signIn('1001');
    // Simulate the running installation: the build expects schema 12, the database has not been
    // migrated. Only the migration-owned tables disappear; nothing operational is touched.
    await db.query('ALTER TABLE member_divisions RENAME TO member_divisions_unmigrated');
    await db.query('ALTER TABLE divisions RENAME TO divisions_unmigrated');
    try {
      const config = await app.inject({ method: 'GET', url: '/api/public-config', headers: { cookie } });
      expect(config.statusCode, config.body).toBe(200);

      const session = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
      expect(session.statusCode).toBe(503);
      const body = session.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('DATABASE_MIGRATION_REQUIRED');
      // Safe wording: no table name, no database name, no connection detail.
      expect(body.error.message).not.toContain('member_divisions');
      expect(body.error.message).not.toContain('relation');

      const bootstrap = await app.inject({ method: 'GET', url: '/api/manager/bootstrap', headers: { cookie } });
      expect(bootstrap.statusCode).toBe(503);

      // Credential verification itself is untouched: the refusal names readiness, not the password,
      // and no session cookie is issued for a build that cannot serve one.
      const signInAgain = await app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { employeeId: '1001', password }
      });
      expect(signInAgain.statusCode, signInAgain.body).toBe(503);
      expect(signInAgain.json().error.code).toBe('DATABASE_MIGRATION_REQUIRED');
      expect(String(signInAgain.headers['set-cookie'] ?? '')).not.toContain(COOKIE);
      const wrongPassword = await app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { employeeId: '1001', password: 'definitely-wrong-password' }
      });
      expect(wrongPassword.json().error.code).toBe('UNAUTHENTICATED');
    } finally {
      await db.query('ALTER TABLE divisions_unmigrated RENAME TO divisions');
      await db.query('ALTER TABLE member_divisions_unmigrated RENAME TO member_divisions');
    }
  });

  it('keeps a google deployment reporting google mode and no employee form data', async () => {
    await app.close();
    app = await buildApp({
      db,
      inbox: new NullInboxSource(),
      logger: false,
      config: loadConfig({
        NODE_ENV: 'test',
        AUTH_MODE: 'google',
        PUBLIC_ORIGIN: 'https://hub.example.co.jp',
        GOOGLE_CLIENT_ID: 'public-client-id.apps.googleusercontent.com',
        MANAGER_WEB_ALLOWED_DOMAINS: 'example.co.jp'
      })
    });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/api/public-config' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data.authMode).toBe('google');
    expect(response.json().data.googleClientId).toBe('public-client-id.apps.googleusercontent.com');
    expect(response.json().data.authConfigured).toBe(true);
  });
});
