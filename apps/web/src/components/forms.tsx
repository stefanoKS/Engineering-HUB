/** Form primitives and the save-state hook shared by every editor. */
import { useCallback, useState, type ReactNode } from 'react';
import { api, ApiFailure } from '../api/client';
import { useI18n } from '../i18n';
import { Modal } from './ui';

export type SaveStateValue = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict';

export function useSave(): {
  state: SaveStateValue;
  error: unknown;
  run: <T>(action: () => Promise<T>, options?: { onSuccess?: (value: T) => void }) => Promise<T | undefined>;
  reset: () => void;
} {
  const [state, setState] = useState<SaveStateValue>('idle');
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, options?: { onSuccess?: (value: T) => void }): Promise<T | undefined> => {
      setState('saving');
      setError(null);
      try {
        const value = await action();
        setState('saved');
        options?.onSuccess?.(value);
        return value;
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.isConflict) setState('conflict');
        else setState('failed');
        setError(failure);
        return undefined;
      }
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
  disabled
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
}): JSX.Element {
  return (
    <input
      type={type}
      value={value}
      required={required}
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

export function useIdempotencyKey(): string {
  const [key] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  return key;
}

export function invalidateAfterSave(prefixes: string[]): void {
  void api;
  return void prefixes;
}
