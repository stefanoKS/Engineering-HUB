import { describe, expect, it } from 'vitest';
import { hasRetiredResponsibilities, visibleResponsibilities } from '../src/state/responsibility-filter';

const items = [
  { responsibilityId: 'RSP-A', status: 'Active' as const },
  { responsibilityId: 'RSP-R', status: 'Retired' as const }
];

describe('responsibility list presentation', () => {
  it('shows only active areas by default', () => {
    expect(visibleResponsibilities(items, false).map((item) => item.responsibilityId)).toEqual(['RSP-A']);
  });

  it('shows active and retired areas when the manager asks for them', () => {
    expect(visibleResponsibilities(items, true).map((item) => item.responsibilityId)).toEqual(['RSP-A', 'RSP-R']);
  });

  it('never mutates the stored list while hiding a retired area', () => {
    const before = items.map((item) => item.responsibilityId);
    visibleResponsibilities(items, false);
    expect(items.map((item) => item.responsibilityId)).toEqual(before);
  });

  it('reports an empty default view when every area is retired', () => {
    const retiredOnly = [{ responsibilityId: 'RSP-R', status: 'Retired' as const }];
    expect(visibleResponsibilities(retiredOnly, false)).toEqual([]);
    expect(hasRetiredResponsibilities(retiredOnly)).toBe(true);
    expect(hasRetiredResponsibilities(items)).toBe(true);
  });
});
