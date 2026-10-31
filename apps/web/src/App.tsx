/**
 * Application shell: session bootstrap, hash routing, navigation and the language switch.
 *
 * Sign-out and a lost session clear every cached private payload, so a shared workstation never
 * shows the previous manager's data.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Actor } from '@eh/contracts';
import { api, sessionEvents, setCsrfToken } from './api/client';
import { queryCache } from './state/cache';
import { useI18n } from './i18n';
import { LoginScreen } from './screens/Login';
import { OverviewScreen } from './screens/Overview';
import { ProjectsScreen } from './screens/Projects';
import { ProjectDetailScreen } from './screens/ProjectDetail';
import { TasksScreen } from './screens/Tasks';
import { TaskDetailScreen } from './screens/TaskDetail';
import { ResponsibilitiesScreen } from './screens/Responsibilities';
import { MembersScreen } from './screens/Members';
import { MemberProfileScreen } from './screens/MemberProfile';
import { SkillsScreen } from './screens/Skills';
import { RequestsScreen } from './screens/Requests';
import { WorkloadScreen } from './screens/Workload';
import { AutomationScreen } from './screens/Automation';
import { StatusScreen } from './screens/Status';
import { LanguageSwitch } from './components/ui';

export type Session = { actor: Actor; csrfToken: string; expiresAt: string };

export type Route = { path: string; segments: string[] };

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const path = hash.split('?')[0] ?? '';
  return { path: path || 'overview', segments: (path || 'overview').split('/').filter(Boolean) };
}

export function navigate(path: string): void {
  window.location.hash = `#/${path}`;
}

export function App(): JSX.Element {
  const { t, language, setLanguage } = useI18n();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(readRoute);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const onHash = (): void => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Session>('/api/session')
      .then((value) => {
        if (cancelled) return;
        setCsrfToken(value.csrfToken);
        setSession(value);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onLost = (): void => {
      queryCache.clear();
      setCsrfToken('');
      setSession(null);
      setNotice(t('state.sessionLost'));
    };
    sessionEvents.addEventListener('session-lost', onLost);
    return () => sessionEvents.removeEventListener('session-lost', onLost);
  }, [t]);

  const signOut = useCallback(async () => {
    try {
      await api.del('/api/session');
    } catch {
      // A failed sign-out still clears local state; the server session expires on its own.
    }
    queryCache.clear();
    setCsrfToken('');
    setSession(null);
  }, []);

  const signedIn = session ? session.actor : null;
  const isManager = !!signedIn && (signedIn.role === 'ADMIN' || signedIn.role === 'MANAGER');

  const nav = useMemo(
    () =>
      [
        { path: 'overview', label: t('nav.overview') },
        { path: 'projects', label: t('nav.projects') },
        { path: 'tasks', label: t('nav.tasks') },
        { path: 'responsibilities', label: t('nav.responsibilities') },
        { path: 'members', label: t('nav.members') },
        { path: 'skills', label: t('nav.skills') },
        { path: 'requests', label: t('nav.requests') },
        { path: 'workload', label: t('nav.workload') },
        { path: 'automation', label: t('nav.automation') },
        { path: 'status', label: t('nav.status') }
      ].filter((entry) => isManager || ['overview', 'projects', 'tasks'].includes(entry.path)),
    [t, isManager]
  );

  if (session === undefined) {
    return (
      <main className="loading-screen">
        <p>{t('state.loading')}</p>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen notice={notice} onSignedIn={(value) => {
      setCsrfToken(value.csrfToken);
      setSession(value);
      setNotice('');
    }} />;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>{t('app.name')}</h1>
          <p className="muted">{t('app.subtitle')}</p>
        </div>
        <div className="header-actions">
          <LanguageSwitch language={language} onChange={setLanguage} />
          <span className="identity" title={session.actor.email}>
            {session.actor.name}
            <span className="role-pill">{session.actor.role}</span>
          </span>
          <button type="button" className="link-button" onClick={() => void signOut()}>
            {t('nav.signOut')}
          </button>
        </div>
      </header>

      <nav className="app-nav" aria-label={t('app.name')}>
        {nav.map((entry) => (
          <a
            key={entry.path}
            href={`#/${entry.path}`}
            className={route.segments[0] === entry.path ? 'nav-link active' : 'nav-link'}
          >
            {entry.label}
          </a>
        ))}
      </nav>

      {notice ? (
        <div className="banner warning" role="status">
          {notice}
        </div>
      ) : null}

      <main className="app-main">
        {renderScreen(route, session.actor, isManager)}
      </main>
    </div>
  );
}

function renderScreen(route: Route, actor: Actor, isManager: boolean): JSX.Element {
  const [first, second] = route.segments;
  switch (first) {
    case 'overview':
      return <OverviewScreen actor={actor} />;
    case 'projects':
      return <ProjectsScreen actor={actor} />;
    case 'project':
      return second ? <ProjectDetailScreen actor={actor} projectId={second} /> : <ProjectsScreen actor={actor} />;
    case 'tasks':
      return <TasksScreen actor={actor} />;
    case 'task':
      return second ? <TaskDetailScreen actor={actor} taskId={second} /> : <TasksScreen actor={actor} />;
    case 'responsibilities':
      return isManager ? <ResponsibilitiesScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'members':
      return <MembersScreen actor={actor} />;
    case 'member':
      return second ? <MemberProfileScreen actor={actor} memberId={second} /> : <MembersScreen actor={actor} />;
    case 'skills':
      return isManager ? <SkillsScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'requests':
      return isManager ? <RequestsScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'workload':
      return isManager ? <WorkloadScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'automation':
      return isManager ? <AutomationScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    case 'status':
      return isManager ? <StatusScreen actor={actor} /> : <OverviewScreen actor={actor} />;
    default:
      return <OverviewScreen actor={actor} />;
  }
}
