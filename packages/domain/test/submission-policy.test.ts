/**
 * One policy for who may file a request and why a request is refused.
 *
 * The approved exception exists for COMPLETION_REPORT only: assignment is not required, but the
 * reporter still has to reach the work, and a deadline change keeps the assigned-MEMBER rule.
 */
import { describe, expect, it } from 'vitest';
import {
  canReportCompletion,
  canRequestDeadlineChange,
  submissionBlockReasons,
  submissionRefusal,
  type Identity
} from '../src/index';

const base: Identity = {
  memberId: 'MEM-1',
  name: 'Member',
  email: 'member@example.co.jp',
  role: 'MEMBER',
  active: true,
  verified: true
};

const as = (role: Identity['role'], overrides: Partial<Identity> = {}): Identity => ({ ...base, role, ...overrides });

const openTask = { status: 'In Progress', container: false, archived: false };

describe('who may report completion', () => {
  it('allows MEMBER, MANAGER and ADMIN and refuses a VIEWER', () => {
    expect(canReportCompletion(as('MEMBER'))).toBe(true);
    expect(canReportCompletion(as('MANAGER'))).toBe(true);
    expect(canReportCompletion(as('ADMIN'))).toBe(true);
    expect(canReportCompletion(as('VIEWER'))).toBe(false);
  });

  it('fails closed for an unverified or inactive account', () => {
    expect(canReportCompletion(as('MEMBER', { verified: false }))).toBe(false);
    expect(canReportCompletion(as('MEMBER', { active: false }))).toBe(false);
    expect(canReportCompletion(null)).toBe(false);
  });

  it('keeps a deadline change limited to the MEMBER role', () => {
    expect(canRequestDeadlineChange(as('MEMBER'))).toBe(true);
    expect(canRequestDeadlineChange(as('MANAGER'))).toBe(false);
    expect(canRequestDeadlineChange(as('ADMIN'))).toBe(false);
    expect(canRequestDeadlineChange(as('VIEWER'))).toBe(false);
  });
});

describe('submission block reasons', () => {
  const reportable = {
    requestType: 'COMPLETION_REPORT' as const,
    mayReportCompletion: true,
    mayRequestDeadlineChange: true,
    assigned: false,
    visible: true,
    submissionEnabled: true,
    pending: false,
    task: openTask
  };

  it('reports nothing for an accessible completion report, assigned or not', () => {
    expect(submissionBlockReasons(reportable)).toEqual([]);
    expect(submissionBlockReasons({ ...reportable, assigned: true })).toEqual([]);
  });

  it('lists every applicable refusal in a stable order', () => {
    const reasons = submissionBlockReasons({
      requestType: 'COMPLETION_REPORT',
      mayReportCompletion: false,
      mayRequestDeadlineChange: false,
      assigned: false,
      visible: false,
      submissionEnabled: false,
      pending: true,
      task: { status: 'Done', container: true, archived: true }
    });
    expect(reasons).toEqual([
      'ROLE',
      'NOT_VISIBLE',
      'ARCHIVED',
      'CONTAINER',
      'COMPLETED',
      'PENDING',
      'SUBMISSION_DISABLED'
    ]);
  });

  it('requires the assignment for a deadline change and for nothing else', () => {
    expect(
      submissionBlockReasons({
        ...reportable,
        requestType: 'DEADLINE_CHANGE',
        assigned: false
      })
    ).toEqual(['NOT_ASSIGNED']);
    expect(
      submissionBlockReasons({
        ...reportable,
        requestType: 'DEADLINE_CHANGE',
        assigned: true
      })
    ).toEqual([]);
  });

  it('maps each reason to the stable refusal code', () => {
    expect(submissionRefusal('ROLE').code).toBe('AUTHORIZATION_DENIED');
    expect(submissionRefusal('NOT_VISIBLE').code).toBe('AUTHORIZATION_DENIED');
    expect(submissionRefusal('NOT_ASSIGNED').code).toBe('AUTHORIZATION_DENIED');
    expect(submissionRefusal('CONTAINER').code).toBe('CONTAINER_NOT_COMPLETABLE');
    expect(submissionRefusal('SUBMISSION_DISABLED').code).toBe('REQUEST_SUBMISSION_CLOSED');
    expect(submissionRefusal('COMPLETED').code).toBe('INVALID_TRANSITION');
    expect(submissionRefusal('CANCELLED').code).toBe('INVALID_TRANSITION');
    expect(submissionRefusal('PENDING').code).toBe('INVALID_TRANSITION');
    expect(submissionRefusal('ARCHIVED').code).toBe('INVALID_TRANSITION');
  });
});
