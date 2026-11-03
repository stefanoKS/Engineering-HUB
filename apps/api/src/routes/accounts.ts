/**
 * Administrator account management.
 *
 * One member — one login. A new employee is created together with the login in one transaction,
 * or a login is attached to an existing member without touching that member's name, role,
 * assignments or history. The employee number is the login identifier (leading zeros preserved);
 * the internal member ID is never typed by an administrator when a searchable picker can choose
 * the actual record.
 *
 * Identity is always the verified session: the browser never supplies a role, an actor or an
 * owner as authority.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { CreateAccountBody, ResetAccountPasswordBody } from '@eh/contracts';
import { DomainError, effectiveRole, requireRole } from '@eh/domain';
import { listLinkableMembers, newId } from '@eh/db';
import { adminOf, ok, type AppDependencies } from '../http';
import { sendError } from '../errors';
import { runIdempotent } from '../services/common';
import { hashPassword } from '../auth/password';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  query: z.string().max(100).default('')
});

const linkableQuery = z.object({
  query: z.string().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export function registerAccountRoutes(app: FastifyInstance, deps: AppDependencies): void {
  const enabled = (): void => {
    if (deps.config.authMode !== 'local') {
      throw new DomainError('NOT_CONFIGURED', 'Local authentication is disabled');
    }
  };

  app.get('/api/admin/accounts', async (request, reply) => {
    try {
      enabled();
      adminOf(request);
      const query = listQuery.parse(request.query ?? {});
      const filter = `%${query.query.toLowerCase()}%`;
      const total = await deps.db.one<{ count: string }>(
        `SELECT count(*)::text AS count FROM local_accounts a JOIN members m USING(member_id)
          WHERE ($1 = '%%' OR lower(a.employee_id) LIKE $1 OR lower(m.name) LIKE $1)`,
        [filter]
      );
      const rows = await deps.db.many<{
        employeeId: string;
        memberId: string;
        name: string;
        role: string | null;
        active: boolean;
        mustChangePassword: boolean;
      }>(
        `SELECT a.employee_id AS "employeeId", m.member_id AS "memberId", m.name, m.role, m.active,
                a.must_change_password AS "mustChangePassword"
           FROM local_accounts a JOIN members m USING(member_id)
          WHERE ($1 = '%%' OR lower(a.employee_id) LIKE $1 OR lower(m.name) LIKE $1)
          ORDER BY a.employee_id ASC
          LIMIT $2 OFFSET $3`,
        [filter, query.pageSize, (query.page - 1) * query.pageSize]
      );
      const count = Number(total?.count ?? 0);
      return ok(reply, request, {
        items: rows.map((row) => ({ ...row, role: effectiveRole(row.role) })),
        total: count,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.max(1, Math.ceil(count / query.pageSize))
      });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  /** Existing active members without a login; the picker for linking a new account. */
  app.get('/api/admin/accounts/linkable', async (request, reply) => {
    try {
      enabled();
      adminOf(request);
      const query = linkableQuery.parse(request.query ?? {});
      const items = await listLinkableMembers(deps.db, { query: query.query, limit: query.limit });
      return ok(reply, request, { items, total: items.length });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/accounts', async (request, reply) => {
    try {
      enabled();
      const actor = adminOf(request);
      const body = CreateAccountBody.parse(request.body ?? {});
      const passwordHash = await hashPassword(body.password);
      const isLink = !!body.memberId;
      if (!isLink && !body.name) {
        throw new DomainError('VALIDATION_FAILED', 'An employee name is required for a new member');
      }
      const result = await runIdempotent(
        { db: deps.db, identity: actor, correlationId: request.state.correlationId },
        {
          scope: `local-account:${actor.memberId}`,
          key: body.idempotencyKey,
          request: {
            employeeId: body.employeeId,
            name: body.name,
            role: body.role,
            memberId: body.memberId
          }
        },
        async (tx) => {
          // The last-administrator rule and role changes share one lock; a stale session role is
          // re-read here so a role revoked a moment ago cannot create an account.
          await tx.advisoryLock('members:role-and-activation');
          const current = await tx.one<{ role: string; active: boolean }>(
            'SELECT role, active FROM members WHERE member_id = $1',
            [actor.memberId]
          );
          requireRole(
            { ...actor, role: effectiveRole(current?.role), active: !!current?.active },
            'ADMIN'
          );

          const taken = await tx.one<{ employee_id: string }>(
            'SELECT employee_id FROM local_accounts WHERE employee_id = $1',
            [body.employeeId]
          );
          if (taken) {
            throw new DomainError('VALIDATION_FAILED', 'This employee number already has a login', {
              employeeId: body.employeeId
            });
          }

          let memberId: string;
          if (isLink) {
            memberId = body.memberId!;
            // An existing member is used exactly as stored: no name, role or assignment is
            // overwritten by an arbitrary form value.
            const member = await tx.one<{ member_id: string; active: boolean }>(
              'SELECT member_id, active FROM members WHERE member_id = $1 FOR UPDATE',
              [memberId]
            );
            if (!member) throw new DomainError('NOT_FOUND', 'Member not found');
            if (!member.active) {
              throw new DomainError('VALIDATION_FAILED', 'An account cannot be linked to an inactive member');
            }
            const existing = await tx.one<{ member_id: string }>(
              'SELECT member_id FROM local_accounts WHERE member_id = $1',
              [memberId]
            );
            if (existing) {
              throw new DomainError('VALIDATION_FAILED', 'This member already has a login account');
            }
          } else {
            memberId = newId('MEM');
            await tx.query('INSERT INTO members(member_id, name, role) VALUES($1, $2, $3)', [
              memberId,
              body.name,
              body.role ?? 'MEMBER'
            ]);
          }

          await tx.query(
            'INSERT INTO local_accounts(member_id, employee_id, password_hash) VALUES($1, $2, $3)',
            [memberId, body.employeeId, passwordHash]
          );
          await tx.query(
            `INSERT INTO audit_log(entity_type, entity_id, action, actor_member_id, actor_email, new_value)
             VALUES('MEMBER', $1, $2, $3, $4, $5)`,
            [
              memberId,
              isLink ? 'LOCAL_ACCOUNT_LINKED' : 'LOCAL_ACCOUNT_CREATED',
              actor.memberId,
              actor.email,
              JSON.stringify({ employeeId: body.employeeId, linked: isLink })
            ]
          );
          return { memberId, linked: isLink };
        }
      );
      return ok(reply, request, result.data);
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });

  app.post('/api/admin/accounts/:memberId/reset-password', async (request, reply) => {
    try {
      enabled();
      const actor = adminOf(request);
      const { memberId } = z.object({ memberId: z.string().min(1).max(100) }).parse(request.params);
      if (memberId === actor.memberId) {
        throw new DomainError('VALIDATION_FAILED', 'Use change password for your own account');
      }
      const body = ResetAccountPasswordBody.parse(request.body ?? {});
      const hash = await hashPassword(body.password);
      await deps.db.transaction(async (tx) => {
        await tx.advisoryLock('members:role-and-activation');
        const current = await tx.one<{ role: string; active: boolean }>(
          'SELECT role, active FROM members WHERE member_id = $1',
          [actor.memberId]
        );
        requireRole(
          { ...actor, role: effectiveRole(current?.role), active: !!current?.active },
          'ADMIN'
        );
        const changed = await tx.one(
          `UPDATE local_accounts
              SET password_hash = $2, must_change_password = true,
                  password_version = password_version + 1,
                  failed_attempts = 0, locked_until = NULL, updated_at = now()
            WHERE member_id = $1
            RETURNING member_id`,
          [memberId, hash]
        );
        if (!changed) throw new DomainError('NOT_FOUND', 'Local account not found');
        await tx.query('UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL', [
          memberId
        ]);
        await tx.query(
          `INSERT INTO audit_log(entity_type, entity_id, action, actor_member_id, actor_email)
           VALUES('MEMBER', $1, 'PASSWORD_RESET', $2, $3)`,
          [memberId, actor.memberId, actor.email]
        );
      });
      return ok(reply, request, { reset: true });
    } catch (error) {
      return sendError(reply, request.state, error);
    }
  });
}
