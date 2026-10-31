/** Sign-in: company Google identity, with an explicitly development-only fixture form. */
import { useEffect, useRef, useState } from 'react';
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

const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';
const DEV_SIGN_IN = (import.meta.env.VITE_DEV_SIGN_IN as string | undefined) === 'true';

export function LoginScreen({
  notice,
  onSignedIn
}: {
  notice: string;
  onSignedIn: (session: Session) => void;
}): JSX.Element {
  const { t, language } = useI18n();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return undefined;
    const existing = document.getElementById('gsi-script');
    const setup = (): void => {
      const identity = window.google?.accounts?.id;
      if (!identity || !buttonRef.current) return;
      identity.initialize({
        client_id: CLIENT_ID,
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
  }, [language]);

  async function signIn(body: { idToken?: string; devEmail?: string }): Promise<void> {
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
        <p className="muted">{t('login.domain')}</p>
        {notice ? <div className="banner warning">{notice}</div> : null}
        {CLIENT_ID ? <div ref={buttonRef} className="gsi-button" /> : null}
        {DEV_SIGN_IN ? (
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
