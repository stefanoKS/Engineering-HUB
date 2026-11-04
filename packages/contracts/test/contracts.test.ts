import { describe, expect, it } from 'vitest';
import {
  AutomationSaveBody,
  CreateProjectBody,
  CreateSubprojectBody,
  CreateTaskBody,
  DecisionBody,
  PUBLISHED_HEADERS,
  PatchSubprojectBody,
  PublishedTaskRow,
  PatchProjectBody,
  SubmitRequestBody,
  WorkProject
} from '@eh/contracts';

describe('strict mutation bodies', () => {
  it('rejects a browser-supplied role or actor', () => {
    const base = {
      idempotencyKey: 'key-00000001',
      projectName: 'Project',
      responsibilityId: 'RSP-1'
    };
    expect(CreateProjectBody.safeParse(base).success).toBe(true);
    expect(CreateProjectBody.safeParse({ ...base, role: 'ADMIN' }).success).toBe(false);
    expect(CreateProjectBody.safeParse({ ...base, actor: 'someone' }).success).toBe(false);
    expect(CreateProjectBody.safeParse({ ...base, owner: 'MEM-X' }).success).toBe(false);
    expect(PatchProjectBody.safeParse({ revision: 1, projectName: 'X', confirmation: 'x' }).success).toBe(false);
  });

  it('requires the idempotency key, the decision and the confirmation', () => {
    expect(
      CreateTaskBody.safeParse({ projectId: 'P1', taskName: 'T', deadline: '2026-02-01' }).success
    ).toBe(false);
    expect(
      CreateTaskBody.safeParse({
        idempotencyKey: 'key-00000002',
        projectId: 'P1',
        taskName: 'T',
        deadline: '2026-02-01'
      }).success
    ).toBe(true);
    expect(DecisionBody.safeParse({ requestId: 'R1', decision: 'APPROVE', revision: 1 }).success).toBe(false);
    expect(SubmitRequestBody.safeParse({ clientRequestId: 'c-1', taskId: 'T1', requestType: 'DEADLINE_CHANGE' }).success).toBe(true);
    expect(
      SubmitRequestBody.safeParse({ clientRequestId: 'c-1', taskId: 'T1', requestType: 'OTHER' }).success
    ).toBe(false);
  });

  it('requires the exact automation confirmation shape but leaves the phrase to the server', () => {
    expect(
      AutomationSaveBody.safeParse({ revision: 'r1', changes: { EMAIL_MODE: 'LIVE' }, confirmed: true }).success
    ).toBe(true);
    expect(
      AutomationSaveBody.safeParse({ revision: 'r1', changes: {}, confirmed: false }).success
    ).toBe(false);
  });

  it('rejects an impossible calendar date', () => {
    const result = CreateTaskBody.safeParse({
      idempotencyKey: 'key-00000003',
      projectId: 'P1',
      taskName: 'T',
      deadline: '2026-02-31'
    });
    expect(result.success).toBe(false);
  });
});

describe('read-only member projection', () => {
  it('accepts an optional subproject description on create and patch and rejects an over-long one', () => {
    const base = { idempotencyKey: 'key-00000010', projectId: 'P1', subprojectName: 'Area' };
    expect(CreateSubprojectBody.safeParse(base).success).toBe(true);
    expect(CreateSubprojectBody.safeParse({ ...base, description: 'Line one\nLine two' }).success).toBe(true);
    expect(CreateSubprojectBody.safeParse({ ...base, description: 'x'.repeat(2001) }).success).toBe(false);
    expect(PatchSubprojectBody.safeParse({ revision: 1, description: 'Only the description' }).success).toBe(true);
    // A browser-supplied role or owner never rides along with a description.
    expect(PatchSubprojectBody.safeParse({ revision: 1, description: 'x', role: 'ADMIN' }).success).toBe(false);
  });

  it('requires the description and the TaskScope counts in the read-only project projection', () => {
    const base = {
      projectId: 'PRJ-1',
      projectName: 'Alpha',
      description: 'Overview',
      responsibilityName: 'Design',
      projectOwnerName: 'Owner',
      status: 'Active',
      priority: 'High',
      committedDeadline: null,
      progressPercent: 25,
      health: 'OK',
      activeTaskCount: 2,
      completedTaskCount: 1
    };
    expect(WorkProject.safeParse(base).success).toBe(true);
    expect(WorkProject.safeParse({ ...base, description: undefined }).success).toBe(false);
    expect(WorkProject.safeParse({ ...base, activeTaskCount: undefined }).success).toBe(false);
    // The projection has no field for a private project value at all.
    expect(Object.keys(WorkProject.shape)).not.toContain('dashboardSummary');
    expect(Object.keys(WorkProject.shape)).not.toContain('nextAction');
    expect(Object.keys(WorkProject.shape)).not.toContain('notificationEnabled');
  });
});

describe('published contract', () => {
  it('keeps an explicit ordered header row', () => {
    expect(PUBLISHED_HEADERS).toHaveLength(18);
    expect(PUBLISHED_HEADERS[0]).toBe('Task_ID');
    expect(PUBLISHED_HEADERS).toContain('Assignee_Names');
    expect(PUBLISHED_HEADERS).not.toContain('Email');
  });

  it('has no field for a private value', () => {
    const shape = PublishedTaskRow.shape;
    expect(Object.keys(shape)).not.toContain('email');
    expect(Object.keys(shape)).not.toContain('description');
    expect(Object.keys(shape)).not.toContain('acceptanceCriteria');
    expect(Object.keys(shape)).not.toContain('explanation');
    expect(Object.keys(shape)).not.toContain('memberId');
    expect(Object.keys(shape)).not.toContain('role');
  });
});
