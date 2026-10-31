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

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }): JSX.Element {
  const { t } = useI18n();
  if (!error) return <span />;
  const failure = error instanceof ApiFailure ? error : null;
  const message = failure
    ? failure.code === 'NETWORK'
      ? t('state.failed')
      : failure.message
    : (error as Error).message;
  const tone = failure?.isDenied ? 'banner danger' : failure?.retryable ? 'banner warning' : 'banner danger';
  return (
    <div className={tone} role="alert">
      <strong>{failure?.code ?? 'ERROR'}</strong>
      <span>{message}</span>
      {failure?.correlationId ? (
        <span className="muted small">
          {t('error.correlation')}: {failure.correlationId}
        </span>
      ) : null}
      {onRetry ? (
        <button type="button" className="link-button" onClick={onRetry}>
          {t('state.retry')}
        </button>
      ) : null}
    </div>
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
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <header className="modal-header">
        <h2>{title}</h2>
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

export function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' | 'failed' | 'conflict' }): JSX.Element {
  const { t } = useI18n();
  if (state === 'idle') return <span />;
  const text = {
    saving: t('state.saving'),
    saved: t('state.saved'),
    failed: t('state.failed'),
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
