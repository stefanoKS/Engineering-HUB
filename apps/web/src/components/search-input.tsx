/**
 * The one server-backed search box.
 *
 * It keeps the visible text separate from the applied query, waits for the debounce (and for a
 * Japanese IME composition to finish), and tells assistive technology that a search is running.
 * The caller owns the applied query - it belongs in the request and in the cache key - so an
 * obsolete answer can never paint over a newer one.
 */
import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { useDebouncedSearch, SEARCH_DEBOUNCE_MS } from '../state/search';

export function DebouncedSearchInput({
  value,
  onApplied,
  label,
  className = '',
  delay = SEARCH_DEBOUNCE_MS
}: {
  /** The applied query, restored when the screen is revisited. */
  value: string;
  onApplied: (query: string) => void;
  label: string;
  className?: string;
  delay?: number;
}): JSX.Element {
  const { t } = useI18n();
  const search = useDebouncedSearch(value, delay);
  const { applied, onCompositionEnd } = search;
  const onAppliedRef = { current: onApplied };
  onAppliedRef.current = onApplied;
  useEffect(() => {
    if (applied === value) return;
    onAppliedRef.current(applied);
    // Only a settled query is applied; the caller resets its own page position.
  }, [applied]);

  return (
    <label className={`field grow search-field ${className}`.trim()}>
      <span className="field-label">{label}</span>
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={search.input}
        onChange={(event) => search.onChange(event.target.value)}
        onCompositionStart={search.onCompositionStart}
        onCompositionEnd={(event) => onCompositionEnd((event.target as HTMLInputElement).value)}
      />
      <span className="search-status muted small" role="status" aria-live="polite">
        {search.updating ? t('search.updating') : ''}
      </span>
    </label>
  );
}
