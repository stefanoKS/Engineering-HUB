/**
 * Responsibility list presentation.
 *
 * The 分野 management table shows active areas by default. Retiring an area never removes or
 * rewrites anything - it only makes the row fall out of the default view until the manager turns
 * on 「廃止済みを表示」. The preference itself lives in route memory, not in the workbook.
 */
export type ResponsibilityStatusLike = { status: 'Active' | 'Retired' };

export function visibleResponsibilities<T extends ResponsibilityStatusLike>(
  items: readonly T[],
  showRetired: boolean
): T[] {
  return showRetired ? [...items] : items.filter((item) => item.status === 'Active');
}

export function hasRetiredResponsibilities(items: readonly ResponsibilityStatusLike[]): boolean {
  return items.some((item) => item.status === 'Retired');
}
