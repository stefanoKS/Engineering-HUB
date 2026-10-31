/**
 * Sign-in and session handling.
 *
 * A browser proves its company identity with a Google ID token. The server verifies signature,
 * issuer, audience, expiry and the company domain, then maps the verified address to an active
 * member row. The browser never supplies a role, a member ID or an owner.
 *
 * The session cookie is an opaque random token; only its SHA-256 hash is stored, so a database
 * reader cannot replay it. A per-session CSRF token is required on every mutation.
 */
import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { effectiveRole, type Identity } from '@eh/domain';
import { DomainError } from '@eh/domain';
import type { AppConfig } from '../config';
import { domainAllowed } from '../config';
import type { Database } from '@eh/db';
import { createSession, findSession, revokeMemberSessions, revokeSession, touchSession } from '@eh/db';
import { newToken } from '@eh/db';

export type SessionContext = {
  identity: Identity;
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type VerifiedClaims = { email: string; name: string; hostedDomain: string };

export class AuthService {
  readonly config: AppConfig;
  readonly db: Database;
  private readonly google: OAuth2Client | null;

  constructor(config: AppConfig, db: Database) {
    this.config = config;
    this.db = db;
    this.google = config.googleClientId ? new OAuth2Client(config.googleClientId) : null;
  }

  /** Verifies a Google ID token. Signature, issuer, audience and expiry come from the library. */
  async verifyGoogleIdToken(idToken: string): Promise<VerifiedClaims> {
    if (!this.google || !this.config.googleClientId) {
      throw new DomainError('NOT_CONFIGURED', 'Google sign-in is not configured for this deployment');
    }
    const ticket = await this.google.verifyIdToken({
      idToken,
      audience: this.config.googleClientId
    });
    const payload: TokenPayload | undefined = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new DomainError('UNAUTHENTICATED', 'The identity token carries no verified address');
    }
    if (payload.email_verified !== true) {
      throw new DomainError('UNAUTHENTICATED', 'The Google account address is not verified');
    }
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      throw new DomainError('UNAUTHENTICATED', 'Unexpected token issuer');
    }
    const hostedDomain = String(payload.hd ?? '');
    if (!domainAllowed(this.config, payload.email)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'This account is outside the company domain');
    }
    if (hostedDomain && !domainAllowed(this.config, `x@${hostedDomain}`)) {
      throw new DomainError('AUTHORIZATION_DENIED', 'This Workspace domain is not allowlisted');
    }
    return { email: payload.email, name: payload.name ?? '', hostedDomain };
  }

  /**
   * Development fixture. It requires NODE_ENV !== production (enforced by config validation), an
   * explicit DEV_AUTH_ENABLED flag and an explicit address allowlist, so it cannot appear by
   * accident and cannot be turned on in production.
   */
  verifyDeveloperIdentity(email: string): VerifiedClaims {
    if (!this.config.devAuthEnabled || this.config.production) {
      throw new DomainError('UNAUTHENTICATED', 'Development sign-in is not enabled');
    }
    const address = String(email ?? '').trim().toLowerCase();
    if (!address || !this.config.devAuthEmails.includes(address)) {
      throw new DomainError('UNAUTHENTICATED', 'This address is not in the development fixture allowlist');
    }
    return { email: address, name: address.split('@')[0] ?? address, hostedDomain: '' };
  }

  async startSession(claims: VerifiedClaims, userAgent: string): Promise<{
    token: string;
    csrfToken: string;
    expiresAt: string;
    identity: Identity;
  }> {
    const member = await this.db.one<{
      member_id: string;
      name: string;
      email: string;
      active: boolean;
      role: string | null;
    }>('SELECT member_id, name, email, active, role FROM members WHERE lower(email) = lower($1)', [
      claims.email
    ]);
    if (!member) {
      throw new DomainError(
        'AUTHORIZATION_DENIED',
        'No member record exists for this address. Ask an administrator to register you.'
      );
    }
    if (!member.active) {
      throw new DomainError('AUTHORIZATION_DENIED', 'This member account is inactive');
    }
    const token = newToken();
    const csrfToken = newToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlMinutes * 60_000).toISOString();
    await createSession(this.db, {
      tokenHash: hashToken(token),
      memberId: member.member_id,
      csrfToken,
      expiresAt: new Date(expiresAt),
      userAgentHash: createHash('sha256').update(userAgent).digest('hex')
    });
    return {
      token,
      csrfToken,
      expiresAt,
      identity: {
        memberId: member.member_id,
        name: member.name,
        email: member.email,
        role: effectiveRole(member.role),
        active: member.active,
        verified: true
      }
    };
  }

  async resolve(request: FastifyRequest): Promise<SessionContext | null> {
    const raw = request.cookies?.[this.config.cookieName];
    if (!raw) return null;
    const tokenHash = hashToken(raw);
    const session = await findSession(this.db, tokenHash);
    if (!session) return null;
    if (session.revoked_at) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) {
      await revokeSession(this.db, tokenHash);
      return null;
    }
    const member = await this.db.one<{
      member_id: string;
      name: string;
      email: string;
      active: boolean;
      role: string | null;
    }>('SELECT member_id, name, email, active, role FROM members WHERE member_id = $1', [session.member_id]);
    if (!member || !member.active) return null;
    await touchSession(this.db, tokenHash);
    return {
      identity: {
        memberId: member.member_id,
        name: member.name,
        email: member.email,
        role: effectiveRole(member.role),
        active: member.active,
        verified: true
      },
      tokenHash,
      csrfToken: session.csrf_token,
      expiresAt: session.expires_at
    };
  }

  async endSession(session: SessionContext | null): Promise<void> {
    if (session) await revokeSession(this.db, session.tokenHash);
  }

  async endAllMemberSessions(memberId: string): Promise<void> {
    await revokeMemberSessions(this.db, memberId);
  }
}
