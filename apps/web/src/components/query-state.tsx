/**
 * One presentation for "what is this read doing right now".
 *
 * The states are deliberately distinct, because collapsing them is what produces a screen that
 * says "Loading…" forever, shows a zero total for a failed request, or presents a cached answer as
 * if it were live:
 *
 * - **initial loading** - a first read is in flight and there is nothing to show;
 * - **initial failure** - the first read failed, with an explicit Retry;
 * - **existing data + refresh warning** - an earlier payload is still shown while a background
 *   refresh failed, so the screen keeps working and says the numbers are older;
 * - **refreshing** - an earlier payload is shown while a newer read is in flight;
 * - **last updated** - when the displayed payload was last confirmed by the server.
 *
 * The announcement is one polite status region, not a stream of repeated messages.
 */
import type { ReactNode } from 'react';
import { formatTokyoClock } from '../state/format';
import { useI18n } from '../i18n';
import { ErrorBox } from './ui';

export type QueryLike<T> = {
  data?: T;
  error?: unknown;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number;
  refresh: () => void;
};

/**
 * Gates a read: nothing but a loading line while the first answer is pending, a Retry on an
 * initial failure, and the caller's content once data exists.
 *
 * A background refresh failure never replaces the content; `RefreshWarning` shows it beside the
 * data instead.
 */
export function QueryState<T>({
  query,
  children,
  loadingText
}: {
  query: QueryLike<T>;
  children: (data: T) => ReactNode;
  loadingText?: string;
}): JSX.Element {
  const { t } = useI18n();
  if (query.data === undefined) {
    if (query.error) return <ErrorBox error={query.error} onRetry={query.refresh} />;
    if (query.loading) {
      return (
        <p className="muted" role="status">
          {loadingText ?? t('state.loading')}
        </p>
      );
    }
    return <span />;
  }
  return <>{children(query.data)}</>;
}

/** A background refresh failed while an earlier payload is still on screen. */
export function RefreshWarning({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element | null {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <div className="banner warning" role="alert">
      <strong>{t('query.refreshFailedTitle')}</strong>
      <span>{t('query.refreshFailedHelp')}</span>
      {onRetry ? (
        <button type="button" className="link-button" onClick={onRetry}>
          {t('state.retry')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * "Last updated HH:mm" plus an explicit Refresh control.
 *
 * The label is a Tokyo wall-clock time, never a claim of continuous freshness: a cached response is
 * described as when it was last confirmed, not as live.
 */
export function FreshnessLine({
  updatedAt,
  refreshing = false,
  stale = false,
  snapshot = false,
  onRefresh
}: {
  updatedAt: number;
  refreshing?: boolean;
  stale?: boolean;
  snapshot?: boolean;
  onRefresh?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const time = updatedAt > 0 ? formatTokyoClock(new Date(updatedAt).toISOString()) : '';
  const text = snapshot
    ? t('freshness.snapshot')
    : refreshing
      ? t('query.updating')
      : time
        ? t('query.lastUpdated', { time })
        : t('query.notYetUpdated');
  return (
    <p className={`muted small query-freshness${stale && !snapshot ? ' stale' : ''}`}>
      <span aria-live="polite">{text}</span>
      {stale && !snapshot ? <span className="query-stale-note"> · {t('query.mayBeOutdated')}</span> : null}
      {onRefresh && !snapshot ? (
        <button type="button" className="link-button query-refresh" onClick={onRefresh} disabled={refreshing}>
          {t('query.refresh')}
        </button>
      ) : null}
    </p>
  );
}

/** The scope itself is empty: nothing is readable, which is different from "no records match". */
export function NoReadableScope(): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="empty-scope" role="status">
      <p>{t('query.noReadableScope')}</p>
      <p className="muted small">{t('query.noReadableScopeHelp')}</p>
    </div>
  );
}

/** Records exist for the scope, but the active filter matches none of them. */
export function NoMatches({ onClear }: { onClear?: () => void }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="empty" role="status">
      <p>{t('query.noMatches')}</p>
      <p className="muted small">{t('query.noMatchesHelp')}</p>
      {onClear ? (
        <button type="button" className="button secondary" onClick={onClear}>
          {t('query.clearFilters')}
        </button>
      ) : null}
    </div>
  );
}

/** The scope is readable and unfiltered, and there is simply nothing recorded yet. */
export function NoRecords({ action }: { action?: ReactNode }): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="empty" role="status">
      <p>{t('state.empty')}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
