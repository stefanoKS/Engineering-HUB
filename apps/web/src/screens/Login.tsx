/** Sign-in: company Google identity, with an explicitly development-only fixture form. */
import { useEffect, useRef, useState } from 'react';
import { PublicConfig } from '@eh/contracts';
import { api, ApiFailure, setCsrfToken } from '../api/client';
import { useI18n } from '../i18n';
import type { Session } from '../App';

type GoogleIdentity = {
  initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }
}

export function LoginScreen({
  notice,
  onSignedIn
}: {
  notice: string;
  onSignedIn: (session: Session) => void;
}): JSX.Element {
  const { t, language } = useI18n();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [email, setEmail] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const clientId = config?.googleClientId ?? '';

  useEffect(() => {
    let cancelled = false;
    api
      .get<unknown>('/api/public-config')
      .then((value) => {
        const parsed = PublicConfig.safeParse(value);
        if (cancelled) return;
        if (!parsed.success) {
          setConfigError(t('login.configError'));
          return;
        }
        setConfig(parsed.data);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setConfigError(
          failure instanceof ApiFailure && failure.code === 'NETWORK' ? failure.message : t('login.configError')
        );
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!clientId) return undefined;
    const existing = document.getElementById('gsi-script');
    const setup = (): void => {
      const identity = window.google?.accounts?.id;
      if (!identity || !buttonRef.current) return;
      identity.initialize({
        client_id: clientId,
        callback: (response) => {
          if (!response.credential) return;
          void signIn({ idToken: response.credential });
        }
      });
      identity.renderButton(buttonRef.current, { theme: 'outline', size: 'large', locale: language });
    };
    if (existing) {
      setup();
      return undefined;
    }
    const script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = setup;
    document.head.appendChild(script);
    return undefined;
  }, [language, clientId]);

  async function signIn(body: { idToken?: string; devEmail?: string; employeeId?: string; password?: string }): Promise<void> {
    setBusy(true);
    setError('');
    try {
      const session = await api.post<Session>('/api/session', body);
      setCsrfToken(session.csrfToken);
      onSignedIn(session);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : t('login.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-card">
        <h1>{t('app.name')}</h1>
        <p className="muted">{t(config?.authMode === 'local' ? 'local.intro' : 'login.domain')}</p>
        {notice ? <div className="banner warning">{notice}</div> : null}
        {configError ? <div className="banner danger">{configError}</div> : null}
        {config && !config.authConfigured && !config.devSignInEnabled ? (
          <div className="banner danger">{t('login.unconfigured')}</div>
        ) : null}
        {clientId ? <div ref={buttonRef} className="gsi-button" /> : null}
        {config?.authMode === 'local' && <form className="stack" onSubmit={event => { event.preventDefault(); if (!busy) void signIn({employeeId, password}); }}>
          <label className="field"><span>{t('local.employeeId')}</span><input value={employeeId} onChange={e=>setEmployeeId(e.target.value)} autoComplete="username" required maxLength={32} /></label>
          <label className="field"><span>{t('local.password')}</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required maxLength={128} /></label>
          <button className="button" disabled={busy}>{t('local.signIn')}</button>
        </form>}
        {config?.devSignInEnabled && config.authMode !== 'local' ? (
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void signIn({ devEmail: email });
            }}
          >
            <p className="banner info">{t('login.dev')}</p>
            <label className="field">
              <span className="field-label">{t('login.email')}</span>
              <input
                type="email"
                value={email}
                required
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
            </label>
            <button type="submit" className="button" disabled={busy}>
              {t('login.google')}
            </button>
          </form>
        ) : null}
        {error ? <div className="banner danger">{error}</div> : null}
      </div>
    </main>
  );
}
