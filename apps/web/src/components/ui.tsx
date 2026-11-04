/** Shared presentational components. All stored text is rendered through React, never as HTML. */
import { useEffect, useRef, type ReactNode } from 'react';
import { projectColorVars } from '@eh/domain';
import { LANGUAGES, useI18n } from '../i18n';
import type { Language } from '@eh/i18n';
import { ApiFailure } from '../api/client';

export function LanguageSwitch({
  language,
  onChange
}: {
  language: Language;
  onChange: (language: Language) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <span className="lang-switch" role="group" aria-label={t('lang.group')}>
      {LANGUAGES.map((value, index) => (
        <span key={value}>
          {index > 0 ? <span aria-hidden="true"> | </span> : null}
          <button
            type="button"
            className={value === language ? 'lang active' : 'lang'}
            aria-pressed={value === language}
            onClick={() => onChange(value)}
          >
            {value === 'ja' ? '日本語' : 'English'}
          </button>
        </span>
      ))}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info';
}): JSX.Element {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function statusTone(status: string): 'neutral' | 'ok' | 'warn' | 'danger' | 'info' {
  switch (status) {
    case 'Done':
    case 'Completed':
    case 'APPROVED':
    case 'INTERNAL':
    case 'Active':
      return 'ok';
    case 'Blocked':
    case 'On Hold':
    case 'OVERDUE':
    case 'STALE':
    case 'DELIVERY_UNCERTAIN':
    case 'FAILED':
      return 'danger';
    case 'PENDING':
    case 'PROCESSING':
    case 'Due soon':
    case 'DUE_SOON':
      return 'warn';
    case 'In Progress':
      return 'info';
    default:
      return 'neutral';
  }
}

export function ProjectAccent({
  projectId,
  children,
  className = ''
}: {
  projectId: string;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={`project-accent ${className}`} style={projectColorVars(projectId)}>
      {children}
    </div>
  );
}

export function Section({
  title,
  actions,
  children
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="card">
      <header className="card-header">
        <h2>{title}</h2>
        <div className="card-actions">{actions}</div>
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ text }: { text?: string }): JSX.Element {
  const { t } = useI18n();
  return <p className="empty">{text ?? t('state.empty')}</p>;
}

/**
 * Breadcrumb trail. Every entry except the last is a hash link, so the existing SPA navigation
 * (and its smart Back behaviour) is preserved and no page reload happens.
 */
export function Breadcrumbs({
  items
}: {
  items: { label: string; href?: string }[];
}): JSX.Element {
  const { t } = useI18n();
  return (
    <nav className="breadcrumbs" aria-label={t('breadcrumb.label')}>
      {items.map((item, index) => (
        <span className="breadcrumb-item" key={`${item.label}:${index}`}>
          {index > 0 ? (
            <span className="breadcrumb-sep" aria-hidden="true">
              /
            </span>
          ) : null}
          {item.href ? (
            <a href={item.href}>{item.label}</a>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Plain multi-line text: line breaks are preserved and no markup is interpreted. */
export function DescriptionText({ text }: { text: string }): JSX.Element {
  const { t } = useI18n();
  const value = text.trim();
  return (
    <p className={value ? 'description-text' : 'description-text empty-description'}>
      {value || t('common.noDescription')}
    </p>
  );
}

/**
 * One readable error surface.
 *
 * The plain-language consequence comes first, the recovery help second, and the technical code
 * last. A conflict, an unobservable write and a refusal are never presented as a plain retry.
 */
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element {
  const { t } = useI18n();
  if (!error) return <span />;
  const failure = error instanceof ApiFailure ? error : null;
  const code = failure?.code ?? 'ERROR';
  const message = failure
    ? failure.code === 'NETWORK'
      ? t('state.failed')
      : failure.message
    : (error as Error).message;
  const conflict = failure?.isConflict === true || code === 'EDIT_CONFLICT';
  const unknown = code === 'NETWORK' || code === 'INVALID_RESPONSE';
  const denied = failure?.isDenied === true || code === 'AUTHORIZATION_DENIED';
  const title = conflict
    ? t('error.conflictTitle')
    : unknown
      ? t('error.unknownTitle')
      : denied
        ? t('error.deniedTitle')
        : failure?.retryable
          ? t('error.retryTitle')
          : t('error.title');
  const help = conflict
    ? t('error.conflictHelp')
    : unknown
      ? t('error.unknownHelp')
      : denied
        ? t('state.denied')
        : '';
  const tone = denied || conflict ? 'banner danger' : unknown || failure?.retryable ? 'banner warning' : 'banner danger';
  return (
    <div className={tone} role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
      {help ? <span className="error-help">{help}</span> : null}
      <span className="muted small error-technical">
        {t('error.codeLabel')}: {code}
        {failure?.correlationId ? ` · ${t('error.correlation')}: ${failure.correlationId}` : ''}
      </span>
      {onRetry && !conflict ? (
        <button type="button" className="link-button" onClick={onRetry}>
          {unknown ? t('error.reload') : t('state.retry')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A snapshot is never presented as live data; a live screen says so explicitly.
 */
export function DataFreshness({ snapshot }: { snapshot: boolean }): JSX.Element {
  const { t } = useI18n();
  return (
    <p className={`muted small freshness ${snapshot ? 'snapshot' : 'live'}`}>
      {snapshot ? t('freshness.snapshot') : t('freshness.live')}
    </p>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`);
  // A modal owns the keyboard while it is open and returns focus to its invoker on close.
  useEffect(() => {
    const dialog = ref.current;
    const invoker = (typeof document === 'undefined' ? null : document.activeElement) as HTMLElement | null;
    if (dialog && !dialog.open) {
      dialog.showModal();
      const first = dialog.querySelector<HTMLElement>(
        '[data-autofocus], input:not([type="hidden"]), select, textarea, button'
      );
      first?.focus();
    }
    return () => {
      if (invoker && typeof invoker.focus === 'function') invoker.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId.current}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="modal-header">
        <h2 id={titleId.current}>{title}</h2>
        <button type="button" className="link-button" onClick={onClose} aria-label={t('common.close')}>
          ×
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer ? <footer className="modal-footer">{footer}</footer> : null}
    </dialog>
  );
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unknown' }): JSX.Element {
  const { t } = useI18n();
  if (state === 'idle') return <span />;
  const text = {
    saving: t('state.saving'),
    saved: t('state.saved'),
    failed: t('state.failed'),
    unknown: t('state.unknown'),
    conflict: t('state.conflict'),
    idle: ''
  }[state];
  const tone = state === 'saved' ? 'ok' : state === 'saving' ? 'info' : state === 'conflict' ? 'warn' : 'danger';
  return <Badge tone={tone}>{text}</Badge>;
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <div className="pagination">
      <span className="muted">{t('pagination.total', { n: total })}</span>
      <button
        type="button"
        className="button secondary"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {t('action.previous')}
      </button>
      <span>
        {page} / {Math.max(totalPages, 1)}
      </span>
      <button
        type="button"
        className="button secondary"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        {t('action.next')}
      </button>
    </div>
  );
}

export function ProgressBar({ value }: { value: number | null }): JSX.Element {
  const { t } = useI18n();
  if (value === null || value === undefined) return <span className="muted">{t('common.unset')}</span>;
  return (
    <span className="progress">
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
      <span className="progress-value">{Math.round(value)}%</span>
    </span>
  );
}
