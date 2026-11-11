import { describe, expect, it, vi } from 'vitest';
import { TaskListQuery } from '@eh/contracts';
import { listTaskAssigneeOptions, listTaskTreeSummaries } from '../src/repo/tasks';
import type { Queryable } from '../src/pool';

describe('task assignee filter contract', () => {
  it('accepts empty or stable IDs and rejects arrays and oversized IDs', () => {
    expect(TaskListQuery.parse({}).assigneeMemberId).toBeUndefined();
    expect(TaskListQuery.parse({ assigneeMemberId: '' }).assigneeMemberId).toBe('');
    expect(TaskListQuery.parse({ assigneeMemberId: 'MEM-A' }).assigneeMemberId).toBe('MEM-A');
    expect(TaskListQuery.safeParse({ assigneeMemberId: ['MEM-A', 'MEM-B'] }).success).toBe(false);
    expect(TaskListQuery.safeParse({ assigneeMemberId: 'x'.repeat(65) }).success).toBe(false);
  });

  it('applies the relationship predicate to matching before hierarchy and paging', async () => {
    const one = vi.fn().mockResolvedValue({ count: '0', matched: '0' });
    const many = vi.fn().mockResolvedValue([]);
    const db: Queryable = { one, many, query: vi.fn() };
    const result = await listTaskTreeSummaries(db, {
      assigneeMemberId: 'MEM-A', projectId: 'PRJ-A', responsibilityId: 'RES-A',
      displayStatus: 'IN_PROGRESS', query: 'design', internalOnly: true
    }, 'TSK-PARENT', 2, 25);
    expect(result).toEqual({ items: [], total: 0, matchedTotal: 0 });
    const sql = String(many.mock.calls[0]![0]);
    expect(sql).toContain('assignment.removed_at IS NULL');
    expect(sql).toContain('t.owner_member_id =');
    expect(sql.indexOf('assignment.removed_at IS NULL')).toBeLessThan(sql.indexOf('ancestors AS'));
    expect(sql).toContain('AS context_only');
    expect(sql).toContain("p.dashboard_visibility = 'INTERNAL'");
    expect(many.mock.calls[0]![1]).toEqual(expect.arrayContaining(['MEM-A', 'PRJ-A', 'RES-A', '%design%', 'TSK-PARENT', 25, 25]));
  });

  it('selects minimal options from readable assignments without excluding inactive members', async () => {
    const one = vi.fn().mockResolvedValue({ count: '1' });
    const many = vi
      .fn()
      .mockResolvedValueOnce([{ member_id: 'MEM-A', name: 'Same', active: false, employee_id: null }])
      // The division-name read for duplicate-name disambiguation is a second bounded query.
      .mockResolvedValueOnce([]);
    const db: Queryable = { one, many, query: vi.fn() };
    expect(await listTaskAssigneeOptions(db, true, 'same', 1, 25)).toEqual({
      items: [{ memberId: 'MEM-A', name: 'Same', active: false, divisionNames: [] }], total: 1
    });
    const sql = String(many.mock.calls[0]![0]);
    expect(sql).toContain("p.dashboard_visibility = 'INTERNAL'");
    expect(sql).toContain('a.removed_at IS NULL');
    expect(sql).not.toContain('m.active = true');
    expect(sql).not.toContain('m.email');
    // An employee identifier is disclosed only when the caller may already see one.
    expect(sql).not.toContain('local_accounts');
  });
});
