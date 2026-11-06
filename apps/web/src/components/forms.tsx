/** Form primitives and the save-state hook shared by every editor. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiFailure } from '../api/client';
import { useI18n } from '../i18n';
import { useQuery } from '../state/cache';
import { ErrorBox, Modal } from './ui';

export type SaveStateValue = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unknown';

export function useSave(): {
  state: SaveStateValue;
  error: unknown;
  run: <T>(action: () => Promise<T>, options?: { onSuccess?: (value: T) => void }) => Promise<T | undefined>;
  reset: () => void;
} {
  const [state, setState] = useState<SaveStateValue>('idle');
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, options?: { onSuccess?: (value: T) => void }): Promise<T | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setState('saving');
      setError(null);
      try {
        const value = await action();
        if (!mounted.current) return value;
        setState('saved');
        options?.onSuccess?.(value);
        return value;
      } catch (failure) {
        if (!mounted.current) return undefined;
        if (failure instanceof ApiFailure && failure.isConflict) setState('conflict');
        else if (failure instanceof ApiFailure && ['NETWORK', 'INVALID_RESPONSE'].includes(failure.code)) setState('unknown');
        else setState('failed');
        setError(failure);
        return undefined;
      } finally { busy.current = false; }
    },
    []
  );

  return { state, error, run, reset: () => setState('idle') };
}

export function ConfirmDialog({
  title,
  message,
  confirmText,
  reasonRequired,
  destructive,
  onCancel,
  onConfirm
}: {
  title: string;
  message: ReactNode;
  confirmText?: string;
  reasonRequired?: boolean;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (input: { confirmation: string; reason: string }) => Promise<void> | void;
}): JSX.Element {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  const canConfirm = (!confirmText || typed.trim() === confirmText) && (!reasonRequired || reason.trim().length > 0);

  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className={destructive ? 'button danger' : 'button'}
            disabled={!canConfirm || busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await onConfirm({ confirmation: typed.trim(), reason: reason.trim() });
              } catch (failure) {
                setError(failure instanceof ApiFailure ? failure.message : (failure as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('action.confirm')}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{message}</div>
        {reasonRequired ? (
          <label className="field">
            <span className="field-label">{t('confirm.deleteReason')}</span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
          </label>
        ) : null}
        {confirmText ? (
          <label className="field">
            <span className="field-label">{t('confirm.type', { text: confirmText })}</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
          </label>
        ) : null}
        {error ? <div className="banner danger">{error}</div> : null}
      </div>
    </Modal>
  );
}

export function TextInput({
  value,
  onChange,
  type = 'text',
  required,
  min,
  max,
  step,
  placeholder,
  disabled,
  id,
  autoFocus,
  ariaLabel
}: {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number' | 'email' | 'password';
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  autoFocus?: boolean;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <input
      type={type}
      id={id}
      value={value}
      required={required}
      aria-required={required || undefined}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      data-autofocus={autoFocus ? '' : undefined}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  allowEmpty
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allowEmpty?: string;
}): JSX.Element {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {allowEmpty !== undefined ? <option value="">{allowEmpty}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * A bounded search filter in front of a select.
 *
 * The option list is always the one already authorized for this form; only the visible subset
 * changes. The current selection stays visible while the search results change, so a filter can
 * never silently clear a stored value.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  allowEmpty,
  searchLabel,
  selectLabel,
  threshold = 8,
  disabled
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allowEmpty?: string;
  searchLabel: string;
  /** The accessible name of the select itself: a <label> wrapping a search box labels that box. */
  selectLabel: string;
  threshold?: number;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const matches = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  const selected = options.find((option) => option.value === value);
  const showSearch = options.length > threshold;
  const keepSelected = !!value && !matches.some((option) => option.value === value);
  return (
    <div className="search-select stack">
      {showSearch ? (
        <input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={filter}
          disabled={disabled}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      <select value={value} aria-label={selectLabel} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {allowEmpty !== undefined ? <option value="">{allowEmpty}</option> : null}
        {keepSelected ? <option value={value}>{selected ? selected.label : value}</option> : null}
        {matches.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {showSearch && needle && matches.length === 0 ? (
        <span className="muted small">{t('myWork.noMatches')}</span>
      ) : null}
    </div>
  );
}

/**
 * A bounded, server-searched option list.
 *
 * The list is never a truncated local slice: search, paging and the honest total come from one
 * authorized endpoint, the debounced query is discarded when it is stale, and the selected value
 * stays visible and selected while the visible page changes.
 */
export type RemoteOption = { value: string; label: string };

export type RemoteOptionPage = {
  page: number;
  total: number;
  totalPages: number;
  items: RemoteOption[];
  selected: RemoteOption | null;
};

export function RemoteSelect({
  value,
  onChange,
  optionsKey,
  load,
  allowEmpty,
  searchLabel,
  selectLabel,
  emptyHint,
  disabled,
  enabled = true
}: {
  value: string;
  onChange: (value: string) => void;
  /** Reset the search and the page whenever the surrounding scope changes. */
  optionsKey: string;
  load: (input: { query: string; page: number }) => Promise<RemoteOptionPage>;
  allowEmpty?: string;
  searchLabel: string;
  selectLabel: string;
  emptyHint?: string;
  disabled?: boolean;
  /** A scope that cannot be searched yet (for example no project chosen) issues no request. */
  enabled?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    setSearch('');
    setQuery('');
    setPage(1);
  }, [optionsKey]);
  useEffect(() => {
    if (search === query) return undefined;
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const list = useQuery<RemoteOptionPage>(`${optionsKey}:${query}:${page}`, () => load({ query, page }), {
    enabled: !disabled && enabled
  });
  const options = list.data?.items ?? [];
  const selected = list.data?.selected ?? null;
  const keepsValue = !!value && !options.some((option) => option.value === value);
  return (
    <div className="search-select stack">
      <input
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={search}
        disabled={disabled}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        aria-label={selectLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {allowEmpty !== undefined ? <option value="">{allowEmpty}</option> : null}
        {keepsValue ? <option value={value}>{selected ? selected.label : value}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {disabled ? null : (
        <div className="inline-actions remote-select-footer">
          {list.data ? (
            <span className="muted small">{t('common.optionCount', { n: list.data.total })}</span>
          ) : (
            <span className="muted small">{t('state.loading')}</span>
          )}
          {list.data && list.data.totalPages > 1 ? (
            <>
              <button
                type="button"
                className="link-button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('local.previous')}
              </button>
              <span className="muted small">
                {t('taskForm.parentPage', { page, pages: list.data.totalPages })}
              </span>
              <button
                type="button"
                className="link-button"
                disabled={page >= list.data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                {t('local.next')}
              </button>
            </>
          ) : null}
        </div>
      )}
      {!list.loading && !list.error && options.length === 0 && emptyHint ? (
        <span className="muted small">{emptyHint}</span>
      ) : null}
      <ErrorBox error={list.error} onRetry={() => list.refresh()} />
    </div>
  );
}

/** Marks a field that the server will reject when it is empty. */export function RequiredTag(): JSX.Element {
  const { t } = useI18n();
  return <span className="field-required">{t('common.required')}</span>;
}

/** Lists the concrete reasons the primary action is disabled, so a user is never left guessing. */
export function BlockedReasons({ reasons }: { reasons: string[] }): JSX.Element {
  const { t } = useI18n();
  if (reasons.length === 0) return <span />;
  // An untouched editor has nothing to submit. That is a neutral state, not a refusal, so it is
  // stated quietly instead of under the "cannot be submitted" heading.
  const onlyNoChanges = reasons.length === 1 && reasons[0] === t('form.noChanges');
  if (onlyNoChanges) return <p className="muted small">{t('form.noChanges')}</p>;
  return (
    <div className="validation-summary" role="status">
      <strong>{t('form.blockedReasons')}</strong>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}

export function createIdempotencyKey(): string {
  return (
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function useIdempotencyKey(): string {
  const [key] = useState(createIdempotencyKey);
  return key;
}

export function invalidateAfterSave(prefixes: string[]): void {
  void api;
  return void prefixes;
}
